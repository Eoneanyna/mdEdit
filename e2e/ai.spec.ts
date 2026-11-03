import { createServer, type Server } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, makeWorkspace, type AppHarness } from './helpers'

let harness: AppHarness | undefined
let server: Server
let baseUrl: string
let calls: Array<{ messages: Array<{ role: string; content: string }> }>
let hold = false

test.beforeEach(async () => {
  calls = []
  hold = false
  server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const data = JSON.parse(body)
      calls.push(data)
      if (hold) return
      const prompt = data.messages.at(-1).content
      const rewriting = data.messages[0].content.includes('改写器')
      const answer = rewriting ? '青岚项目负责人是谁' : prompt.includes('陈小川') ? '负责人：陈小川 [1]' : '负责人：林知远 [1]'
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1'
  harness = await launchApp({ env: { MDEDIT_RAG_URL: 'http://127.0.0.1:1' } })
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

  writeFileSync(join(workspace, '青岚项目.md'), '# 青岚项目\n负责人：陈小川\n', 'utf8')
  await win.locator('#ai-question').fill('他现在是谁？')
  await win.locator('#ai-question').press('Enter')
  await expect(win.locator('.ai-msg--ai').last()).toContainText('陈小川')
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
