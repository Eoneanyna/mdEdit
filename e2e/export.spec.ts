import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { type AppHarness, launchApp, makeWorkspace, type PageHooks } from './helpers'

let harness: AppHarness | undefined

test.beforeEach(async () => {
  harness = await launchApp()
})

test.afterEach(async () => {
  const current = harness
  harness = undefined
  if (current) await current.dispose()
})

/**
 * 让保存对话框直接返回指定路径。
 * 导出必经原生对话框,Playwright 点不到它,只能在主进程替换实现。
 */
async function stubSaveDialog(app: AppHarness['app'], target: string): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    Object.assign(dialog, {
      showSaveDialog: async () => ({ canceled: false, filePath })
    })
  }, target)
}

/** 触发菜单项,走的是与真实点击相同的 IPC 通道 */
async function clickMenu(app: AppHarness['app'], channel: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, name) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send(name)
  }, channel)
}

test('导出为纯文本:剥掉标记,标题带层级编号', async () => {
  const { app, win } = harness!
  const dir = makeWorkspace({})
  const out = join(dir, '导出.txt')
  await stubSaveDialog(app, out)

  await win.evaluate(() =>
    (window as unknown as PageHooks).__editor.setMarkdown(
      '# 概述\n\n这是 **粗体** 文字。\n\n## 细节\n\n- 甲\n- 乙\n'
    )
  )

  await clickMenu(app, 'menu:export-text')
  await expect.poll(() => existsSync(out), { timeout: 10_000 }).toBe(true)

  const text = readFileSync(out, 'utf-8')
  expect(text).toContain('1 概述')
  expect(text).toContain('1.1 细节')
  // 行内标记被剥除,文字保留
  expect(text).toContain('这是 粗体 文字。')
  expect(text).not.toContain('**')
  expect(text).toContain('- 甲')
})

test('转换为 Markdown:纯文本里的短行升级成标题', async () => {
  const { app, win } = harness!
  const dir = makeWorkspace({})
  const out = join(dir, '转换.md')
  await stubSaveDialog(app, out)

  await win.evaluate(() =>
    (window as unknown as PageHooks).__editor.setMarkdown(
      '会议纪要\n\n讨论了排期问题。\n\n后续事项\n\n下周复盘。\n'
    )
  )

  await clickMenu(app, 'menu:export-markdown')
  await expect.poll(() => existsSync(out), { timeout: 10_000 }).toBe(true)

  const md = readFileSync(out, 'utf-8')
  expect(md).toContain('# 会议纪要')
  expect(md).toContain('## 后续事项')
  expect(md).toContain('讨论了排期问题。')
})

test('导出不接管当前文档,原文件与脏标记不受影响', async () => {
  const { app, win } = harness!
  const dir = makeWorkspace({ 'source.md': '# 原文\n' })
  const source = join(dir, 'source.md')
  const out = join(dir, '副本.txt')

  await win.evaluate((p: string) => (window as unknown as PageHooks).__actions.openPath(p), source)
  await expect.poll(() => win.evaluate(() => (window as unknown as PageHooks).__doc.name)).toBe(
    'source.md'
  )

  await stubSaveDialog(app, out)
  await clickMenu(app, 'menu:export-text')
  await expect.poll(() => existsSync(out), { timeout: 10_000 }).toBe(true)

  // 仍在编辑原文件:路径没被导出目标顶替,也没被标脏
  expect(await win.evaluate(() => (window as unknown as PageHooks).__doc.path)).toBe(source)
  expect(await win.evaluate(() => (window as unknown as PageHooks).__doc.dirty)).toBe(false)
  // 原文件内容原封不动
  expect(readFileSync(source, 'utf-8')).toBe('# 原文\n')
})

test('文件菜单里确实挂着导出子菜单', async () => {
  const { app } = harness!
  // 上面的用例直接发 IPC,绕过了菜单本身;这里确认用户点得到入口
  const labels = await app.evaluate(({ Menu }) => {
    const fileMenu = Menu.getApplicationMenu()?.items.find((item) => item.label === '文件')
    const exportItem = fileMenu?.submenu?.items.find((item) => item.label === '导出')
    return exportItem?.submenu?.items.map((item) => item.label) ?? []
  })
  expect(labels).toEqual(['导出为纯文本…', '转换为 Markdown…'])
})
