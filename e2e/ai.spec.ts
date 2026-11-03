import { createServer, type Server } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, makeWorkspace, type AppHarness } from './helpers'

let harness: AppHarness | undefined
let server: Server
let baseUrl: string
let calls: Array<{ messages: Array<{ role: string; content: string }> }>
let hold = false
let streaming = false
let finishStream: (() => void) | undefined
let ragHealth: Record<string, unknown> | undefined

test.beforeEach(async () => {
  calls = []
  hold = false
  streaming = false
  finishStream = undefined
  ragHealth = undefined
  server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/index') {
      res.writeHead(ragHealth && req.url === '/health' ? 200 : 503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(ragHealth || { ok: false }))
      return
    }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const data = JSON.parse(body)
      calls.push(data)
      if (hold) return
      const prompt = data.messages.at(-1).content
      const rewriting = data.messages[0].content.includes('改写器')
      const answer = rewriting ? '青岚项目负责人是谁' : prompt.includes('陈小川') ? '负责人：陈小川 [1]' : '负责人：林知远 [1]'
      if (streaming && data.stream && !rewriting) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(': processing\n\n')
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '## 项目答复\n\n**已生成**第一部分\n\n' } }] }) + '\n\n')
        finishStream = () => {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '| 列 | 值 |\n|---|---|\n| 甲 | 乙 |\n\n~~~ts\nconst x = 1\n~~~\n\n![图片](https://example.test/tracker.png)\n\n[1]' }, finish_reason: 'stop' }] }) + '\n\n')
          res.end('data: [DONE]\n\n')
        }
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1'
  harness = await launchApp({ env: { MDEDIT_RAG_URL: baseUrl.replace('/v1', '') } })
})

test.afterEach(async () => {
  await harness?.dispose()
  harness = undefined
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
})

async function configure(workspace: string): Promise<void> {
  const { win, app } = harness!
  await win.evaluate(async ({ workspace, baseUrl }) => {
    await window.api.setLastWorkspace(workspace)
    await window.api.setAiConfig({ provider: 'custom', model: 'test-model', apiKey: '', baseUrl, useLocal: true, useWeb: false })
  }, { workspace, baseUrl })
  // 重新加载验证配置持久化和工作区恢复。
  await win.reload()
  await win.waitForFunction(() => !!(window as any).__actions)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:ai-toggle')
  })
  await expect(win.locator('#ai-send')).toBeEnabled()
}

test('本地多轮问答、文件更新、来源打开、会话恢复和新对话', async () => {
  const { win } = harness!
  const workspace = makeWorkspace({ '青岚项目.md': '# 青岚项目\n负责人：林知远\n' })
  await configure(workspace)
  await win.locator('#ai-question').fill('青岚项目负责人是谁？')
  await win.locator('#ai-send').click()
  await expect(win.locator('.ai-msg--ai')).toContainText('林知远')
  await win.locator('.ai-turn-sources summary').click()
  await win.locator('.ai-source-item').click()
  await expect.poll(() => win.evaluate(() => (window as any).__doc.name)).toBe('青岚项目.md')
  await expect.poll(() => win.evaluate(() => (window as any).__editor.getSelection().text)).toContain('林知远')
  await expect(win.locator('.ai-source-item')).toContainText('L1')

  writeFileSync(join(workspace, '青岚项目.md'), '# 青岚项目\n负责人：陈小川\n', 'utf8')
  await win.locator('#ai-question').fill('他现在是谁？')
  await win.locator('#ai-question').press('Enter')
  await expect(win.locator('.ai-msg--ai').last()).toContainText('陈小川')
  await expect(win.locator('#ai-send')).toBeEnabled()
  expect(calls).toHaveLength(3)
  expect(calls[2].messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
  expect(calls[2].messages.at(-1)!.content).toContain('陈小川')
  expect(await win.locator('.ai-turn-sources').count()).toBe(2)

  await win.reload()
  await win.waitForFunction(() => !!(window as any).__actions)
  await harness!.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('menu:ai-toggle') })
  await expect(win.locator('.ai-msg--ai')).toHaveCount(2)
  await win.locator('#ai-clear').click()
  await expect(win.locator('.ai-msg')).toHaveCount(0)
  await win.locator('#ai-question').fill('青岚项目负责人是谁？')
  await win.locator('#ai-send').click()
  await expect(win.locator('.ai-msg--ai')).toHaveCount(1)
  expect(calls.at(-1)!.messages).toHaveLength(2)
})

test('流式内容在完成前展示，完成后正确渲染 Markdown', async () => {
  const { win } = harness!
  await configure(makeWorkspace({ '项目.md': '青岚项目负责人：林知远' }))
  streaming = true
  await win.locator('#ai-question').fill('青岚项目负责人是谁？')
  await win.locator('#ai-send').click()
  await expect(win.locator('.ai-answer h2')).toHaveText('项目答复')
  await expect(win.locator('.ai-answer strong')).toHaveText('已生成')
  await expect(win.locator('#ai-send')).toBeDisabled()
  await harness!.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('ai:event', { requestId: 'old-request', type: 'delta', text: '过期消息' })
  })
  await expect(win.locator('.ai-answer')).not.toContainText('过期消息')
  expect(finishStream).toBeDefined()
  finishStream!()
  await expect(win.locator('#ai-send')).toBeEnabled()
  await expect(win.locator('.ai-answer table td')).toHaveCount(2)
  await expect(win.locator('.ai-answer pre code')).toHaveText('const x = 1')
  await expect(win.locator('.ai-answer img')).toHaveCount(0)
  await win.screenshot({ path: test.info().outputPath('ai-stream.png') })
})

test('取消后保留部分回答，但下次请求不携带未完成内容', async () => {
  const { win } = harness!
  await configure(makeWorkspace({ '项目.md': '青岚项目负责人：林知远' }))
  streaming = true
  await win.locator('#ai-question').fill('青岚项目负责人是谁？')
  await win.locator('#ai-send').click()
  await expect(win.locator('.ai-answer strong')).toHaveText('已生成')
  await win.locator('#ai-stop').click()
  await expect(win.locator('.ai-msg--incomplete')).toContainText('未加入后续上下文')
  await expect(win.locator('#ai-send')).toBeEnabled()
  streaming = false
  await win.locator('#ai-question').fill('青岚项目负责人是谁？')
  await win.locator('#ai-send').click()
  await expect(win.locator('#ai-send')).toBeEnabled()
  expect(calls.at(-1)!.messages).toHaveLength(2)
  await expect(win.locator('.ai-msg--ai')).toHaveCount(2)
})

test('状态面板显示真实进度、嵌入器和断开后的降级原因', async () => {
  const { win } = harness!
  const workspace = makeWorkspace({ '项目.md': '青岚项目' })
  await configure(workspace)
  await win.locator('#ai-rag-summary').click()
  await expect(win.locator('#ai-rag-info')).toContainText('返回错误')
  ragHealth = { ok: true, protocol: 2, indexed: false, building: true, phase: 'embedding', completed: 4, total: 10, embedder: 'hash', workspace }
  await win.locator('#ai-rag-refresh').click()
  await expect(win.locator('#ai-rag-summary')).toContainText('构建向量索引')
  await expect(win.locator('#ai-rag-info')).toContainText('4/10')
  await expect(win.locator('#ai-rag-info')).toContainText('语义模型未启用')
  ragHealth = { ...ragHealth, building: false, indexed: true, chunks: 10, phase: 'idle' }
  await win.locator('#ai-rag-refresh').click()
  await expect(win.locator('#ai-rag-info')).toContainText('10 个文档块')
  ragHealth = undefined
  await win.locator('#ai-rag-refresh').click()
  await expect(win.locator('#ai-rag-summary')).toContainText('关键词模式')
})

test('Enter 不重复提交，停止的轮次不进入历史', async () => {
  const { win } = harness!
  await configure(makeWorkspace({ '项目.md': '青岚项目负责人：林知远' }))
  hold = true
  await win.locator('#ai-question').fill('青岚项目负责人是谁？')
  await win.locator('#ai-send').click()
  await expect.poll(() => calls.length).toBe(1)
  await win.locator('#ai-question').fill('重复问题')
  await win.locator('#ai-question').press('Enter')
  expect(calls).toHaveLength(1)
  await win.locator('#ai-stop').click()
  await expect(win.locator('#ai-status')).toContainText('已停止')
  await expect(win.locator('#ai-send')).toBeEnabled()
  hold = false
  await win.locator('#ai-question').fill('青岚项目负责人是谁？')
  await win.locator('#ai-send').click()
  await expect(win.locator('.ai-msg--ai')).toHaveCount(1)
  expect(calls.at(-1)!.messages).toHaveLength(2)
})

test('当前文档的未保存内容需明确勾选，引用定位不写回文件，旧快照会提示失效', async () => {
  const { win } = harness!
  const workspace = makeWorkspace({ '青岚项目.md': '# 青岚项目\n\n负责人：林知远\n' })
  const file = join(workspace, '青岚项目.md')
  await configure(workspace)
  await win.evaluate(async file => {
    const hooks = window as any
    hooks.__actions.setAutoSave(false)
    await hooks.__actions.openPath(file)
    hooks.__editor.setMarkdown('# 青岚项目\n\n负责人：陈小川\n')
  }, file)
  await win.locator('#ai-scope').selectOption('document')
  await win.locator('#ai-question').fill('负责人是谁？')
  await win.locator('#ai-send').click()
  await expect(win.locator('#ai-status')).toContainText('先保存')
  expect(calls).toHaveLength(0)
  await win.locator('#ai-unsaved').check()
  await win.locator('#ai-send').click()
  await expect(win.locator('#ai-send')).toBeEnabled()
  await expect(win.locator('.ai-msg--ai')).toContainText('陈小川')
  expect(calls[0].messages.at(-1)!.content).toContain('陈小川')
  expect(readFileSync(file, 'utf8')).toContain('林知远')
  await win.locator('.ai-citation-link').click()
  await expect.poll(() => win.evaluate(() => (window as any).__editor.getSelection().text)).toContain('陈小川')
  await expect.poll(() => win.evaluate(() => (window as any).__doc.dirty)).toBe(true)
  await win.screenshot({ path: test.info().outputPath('ai-context.png') })
  await win.evaluate(() => (window as any).__editor.setMarkdown('# 青岚项目\n\n文档已更新\n'))
  await win.locator('.ai-citation-link').click()
  await expect(win.locator('#ai-status')).toContainText('快照')
})

test('选区问答只发送选中文字，未命中工作区时不调用模型', async () => {
  const { win } = harness!
  const workspace = makeWorkspace({ '青岚项目.md': '# 青岚项目\n\n负责人：林知远\n\n验收日期：2026年12月8日\n' })
  await configure(workspace)
  await win.evaluate(async file => {
    const hooks = window as any
    await hooks.__actions.openPath(file)
    hooks.__editor.revealSource({ id: 1, type: 'local', title: '青岚项目.md', snippet: '负责人：林知远' })
  }, join(workspace, '青岚项目.md'))
  await win.locator('#ai-scope').selectOption('selection')
  await win.locator('#ai-question').fill('解释所选内容')
  await win.locator('#ai-send').click()
  await expect(win.locator('#ai-send')).toBeEnabled()
  expect(calls).toHaveLength(1)
  expect(calls[0].messages.at(-1)!.content).toContain('负责人：林知远')
  expect(calls[0].messages.at(-1)!.content).not.toContain('验收日期')
  await win.locator('#ai-clear').click()
  await win.locator('#ai-scope').selectOption('workspace')
  await win.locator('#ai-question').fill('蓝鲸的妊娠周期有几个月')
  await win.locator('#ai-send').click()
  await expect(win.locator('.ai-msg--ai')).toContainText('未在本轮资料中找到足够依据')
  expect(calls).toHaveLength(1)
})
