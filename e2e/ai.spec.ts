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
let modelStatus = 200
let finishStream: (() => void) | undefined
let ragHealth: Record<string, unknown> | undefined

test.beforeEach(async () => {
  calls = []
  hold = false
  streaming = false
  modelStatus = 200
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
      if (modelStatus !== 200) { res.writeHead(modelStatus); res.end('secret-upstream-body'); return }
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

test('连接测试不发送笔记历史偏好、不改会话或配置，失败时可重试', async () => {
  const { win } = harness!
  await configure(makeWorkspace({ '项目.md': '青岚项目负责人：林知远' }))
  await win.locator('#ai-question').fill('青岚项目负责人是谁？'); await win.locator('#ai-send').click()
  await expect(win.locator('#ai-send')).toBeEnabled()
  const profile = await win.evaluate(() => window.api.getAiProfile())
  await win.evaluate(async profile => { await window.api.saveAiPreferences(profile.markdown + '\n偏好秘密：测试内容', profile.revision) }, profile)
  const revision = (await win.evaluate(() => window.api.getAiProfile())).revision
  await win.locator('#ai-config-toggle').click()
  await win.locator('#ai-model').fill('unsaved-test-model')
  await win.locator('#ai-test-connection').click()
  await expect(win.locator('#ai-connection-status')).toContainText('连接成功：unsaved-test-model')
  expect(calls).toHaveLength(2)
  expect(calls[1].messages).toHaveLength(2)
  expect(JSON.stringify(calls[1])).not.toMatch(/林知远|偏好秘密|青岚项目/)
  expect((await win.evaluate(() => window.api.getAiConfig())).model).toBe('test-model')
  expect((await win.evaluate(() => window.api.getAiProfile())).revision).toBe(revision)
  await expect(win.locator('.ai-msg--ai')).toHaveCount(1)
  modelStatus = 401
  await win.locator('#ai-test-connection').click()
  await expect(win.locator('#ai-connection-status')).toContainText('API Key 无效')
  await expect(win.locator('#ai-connection-status')).not.toContainText('secret-upstream-body')
  modelStatus = 200
  await win.locator('#ai-test-connection').click()
  await expect(win.locator('#ai-connection-status')).toContainText('连接成功')
})

test('连接测试可停止，停止后可以重新测试且保留输入问题', async () => {
  const { win } = harness!
  await configure(makeWorkspace({ '项目.md': '青岚项目负责人：林知远' }))
  await win.locator('#ai-config-toggle').click()
  await win.locator('#ai-question').fill('尚未发送的问题')
  hold = true
  await win.locator('#ai-test-connection').click()
  await expect.poll(() => calls.length).toBe(1)
  await expect(win.locator('#ai-model')).toBeDisabled()
  await win.locator('#ai-stop').click()
  await expect(win.locator('#ai-connection-status')).toContainText('已停止')
  await expect(win.locator('#ai-test-connection')).toBeEnabled()
  await expect(win.locator('#ai-question')).toHaveValue('尚未发送的问题')
  hold = false
  await win.locator('#ai-test-connection').click()
  await expect(win.locator('#ai-connection-status')).toContainText('连接成功')
  await expect(win.locator('.ai-msg')).toHaveCount(0)
})

test('个人偏好自动学习、下一轮使用、撤销及关闭学习', async () => {
  const { win } = harness!
  await configure(makeWorkspace({ '项目.md': '青岚项目负责人：林知远' }))
  await win.locator('#ai-mode').selectOption('general')
  await win.locator('#ai-question').fill('请以后简洁回答。青岚项目负责人是谁？')
  await win.locator('#ai-send').click()
  await expect(win.locator('#ai-status')).toContainText('已更新个人偏好')
  await win.locator('.ai-profile-panel summary').click()
  await expect(win.locator('#ai-preferences-editor')).toHaveValue(/回答长度：简洁/)
  await win.locator('#ai-question').fill('继续解释')
  await win.locator('#ai-send').click()
  await expect(win.locator('#ai-send')).toBeEnabled()
  expect(calls.at(-1)!.messages[0].content).toContain('回答长度：简洁')
  expect(calls).toHaveLength(2) // 自动学习不调用额外模型。
  await win.locator('#ai-preferences-undo').click()
  await expect(win.locator('#ai-preferences-editor')).not.toHaveValue(/回答长度：简洁/)
  await win.locator('#ai-auto-learn').uncheck()
  await expect(win.locator('#ai-profile-status')).toHaveText('隐私设置已保存')
  await win.locator('#ai-question').fill('以后用英文回答')
  await win.locator('#ai-send').click()
  await expect(win.locator('#ai-send')).toBeEnabled()
  expect((await win.evaluate(() => window.api.getAiProfile())).markdown).not.toContain('回答语言：英文')
})

test('多会话切换、改名、关闭保存和清除本机历史', async () => {
  const { win, app } = harness!
  await configure(makeWorkspace({ '项目.md': '青岚项目负责人：林知远' }))
  await win.locator('#ai-question').fill('青岚项目负责人是谁？'); await win.locator('#ai-send').click()
  await expect(win.locator('#ai-send')).toBeEnabled()
  const first = await win.locator('#ai-session').inputValue()
  await win.locator('#ai-clear').click()
  await expect(win.locator('.ai-msg')).toHaveCount(0)
  await win.locator('#ai-session').selectOption(first)
  await expect(win.locator('.ai-msg--ai')).toHaveCount(1)
  await win.locator('#ai-session-rename').click()
  await win.locator('.prompt__input').fill('项目问答')
  await win.locator('[data-act="ok"]').click()
  await expect(win.locator('#ai-session option:checked')).toHaveText('项目问答')
  await win.locator('.ai-profile-panel summary').click()
  await win.locator('#ai-persist-history').uncheck()
  await expect(win.locator('#ai-profile-status')).toHaveText('隐私设置已保存')
  const disk = await win.evaluate(() => JSON.stringify(localStorage))
  await win.locator('#ai-question').fill('他是谁？'); await win.locator('#ai-send').click()
  await expect(win.locator('.ai-msg--ai')).toHaveCount(2)
  expect(await win.evaluate(() => JSON.stringify(localStorage))).toBe(disk)
  win.once('dialog', dialog => dialog.accept())
  await win.locator('#ai-session-delete').click()
  expect(await win.evaluate(() => JSON.stringify(localStorage))).not.toContain('项目问答')
  await win.reload(); await win.waitForFunction(() => !!(window as any).__actions)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:ai-toggle'))
  await expect(win.locator('.ai-msg')).toHaveCount(0)
  await win.locator('.ai-profile-panel summary').click()
  win.once('dialog', dialog => dialog.accept())
  await win.locator('#ai-history-clear-all').click()
  expect(await win.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('mdedit.ai.session')))).toEqual([])
})

test('仅本机模式在主进程拒绝云端请求和网页搜索', async () => {
  const { win } = harness!
  await configure(makeWorkspace({ '项目.md': '青岚项目负责人：林知远' }))
  await win.locator('.ai-profile-panel summary').click()
  await win.locator('#ai-local-only').check()
  await expect(win.locator('#ai-profile-status')).toHaveText('隐私设置已保存')
  const result = await win.evaluate(() => window.api.aiQuery({ provider: 'custom', model: 'test', baseUrl: 'https://example.com', question: '你好', mode: 'general', useLocal: false, useWeb: false }))
  expect(result.ok).toBe(false)
  await win.locator('#ai-mode').selectOption('notes-web')
  await win.locator('#ai-question').fill('RAG 的定义？'); await win.locator('#ai-send').click()
  await expect(win.locator('#ai-status')).toContainText('仅本机模式')
  expect(calls).toHaveLength(0)
})

test('内置检索自动启动、建立索引和手动重启', async () => {
  await harness!.dispose()
  harness = await launchApp({ env: { MDEDIT_RAG_URL: '' } })
  const { win } = harness
  await configure(makeWorkspace({ '项目.md': '青岚项目负责人：林知远' }))
  await expect.poll(async () => (await win.evaluate(() => window.api.getRagStatus())).serviceState).toBe('running')
  await win.locator('#ai-question').fill('青岚项目负责人是谁？'); await win.locator('#ai-send').click()
  await expect(win.locator('.ai-msg--ai')).toContainText('林知远')
  const state = await win.evaluate(() => window.api.getRagStatus())
  expect(state.managed).toBe(true); expect(state.embedder).toBe('hash'); expect(state.indexed).toBe(true)
  expect(await win.evaluate(() => window.api.restartRag())).toEqual({ ok: true, value: null })
  expect((await win.evaluate(() => window.api.getRagStatus())).serviceState).toBe('running')
})

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
