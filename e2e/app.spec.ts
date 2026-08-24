import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { delay, launchApp, makeWorkspace, type AppHarness, type PageHooks } from './helpers'

/**
 * 零差异 fixture:与单元测试的「完整文档」用例一致,
 * 已经过 parse→ProseMirror→stringify 完整回路验证为恒等形。
 */
const ZERO_DIFF_FIXTURE =
  '# 标题\n\n- 项一\n- 项二\n  - 嵌套项\n\n正文 **粗体** 与 *斜体*。\n\n| 里程碑 | 内容   | 状态 |\n| ------ | ------ | ---- |\n| M1     | 脚手架 | 完成 |\n'

// 允许为空:launchApp 失败时不能让 afterEach 拿着上一轮的陈旧 harness 再 dispose 一次,
// 那样会抛 "Cannot read properties of undefined",把真正的失败原因盖掉。
let harness: AppHarness | undefined

test.beforeEach(async () => {
  harness = await launchApp()
})

test.afterEach(async () => {
  const current = harness
  harness = undefined
  if (current) await current.dispose()
})

test('启动后展示语法帮助,标题与状态栏就绪', async () => {
  const { win, app } = harness!
  // 原生标题栏由主进程 setTitle 驱动,页面 document.title 恒为 mdEdit,须向主进程取
  const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? '')
  expect(title).toBe('语法帮助 — mdEdit')
  expect(await win.locator('#status-path').textContent()).toContain('语法帮助')
  expect(await win.locator('#status-count').textContent()).not.toBe('—')
})

test('打开→直接保存零改动(核心卖点)', async () => {
  const { win } = harness!
  const file = join(makeWorkspace({ '稳定.md': ZERO_DIFF_FIXTURE }), '稳定.md')

  await win.evaluate((p: string) => (window as unknown as PageHooks).__actions.openPath(p), file)
  await expect.poll(() => win.evaluate(() => (window as unknown as PageHooks).__doc.name)).toBe(
    '稳定.md'
  )

  // 打开后不应产生未保存标记
  expect(await win.evaluate(() => (window as unknown as PageHooks).__doc.dirty)).toBe(false)

  const saved = await win.evaluate(() => (window as unknown as PageHooks).__actions.save(false))
  expect(saved).toBe(true)
  expect(readFileSync(file, 'utf-8')).toBe(ZERO_DIFF_FIXTURE)
})

/**
 * 关窗行为拆成两个用例,各自使用独立实例。
 * 原因:拦截时弹出的是原生模态框,脚本无法关掉它;而 GTK 下模态框会阻止
 * 后续对父窗口的 close(),Windows 则不会。若在同一实例里先测拦截再测放行,
 * 那个敞着的对话框会让「保存后可关闭」在 Linux 上必然超时。
 */
test('编辑后标题出现 ● 标记,未保存时关窗被拦截', async () => {
  const { win, app } = harness!
  const file = join(makeWorkspace({ '草稿.md': '原文\n' }), '草稿.md')

  await win.evaluate((p: string) => (window as unknown as PageHooks).__actions.openPath(p), file)
  await expect.poll(() => win.evaluate(() => (window as unknown as PageHooks).__doc.name)).toBe(
    '草稿.md'
  )

  await win.evaluate(() => (window as unknown as PageHooks).__editor.setMarkdown('改过的内容\n'))
  await expect.poll(() => win.evaluate(() => (window as unknown as PageHooks).__doc.dirty)).toBe(true)
  // 标题栏由主进程 setTitle 驱动,经 IPC 更新,向主进程轮询原生标题
  await expect
    .poll(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? '')))
    .toContain('●')

  // 关闭被拦下,窗口不销毁。此后实例里留着一个脚本关不掉的原生对话框,
  // 故本用例到此为止,由 afterEach 强杀进程收尾。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await delay(1000)
  const afterIntercept = await app.evaluate(({ BrowserWindow }) => ({
    count: BrowserWindow.getAllWindows().length,
    destroyed: BrowserWindow.getAllWindows()[0]?.isDestroyed() ?? null
  }))
  expect(afterIntercept).toEqual({ count: 1, destroyed: false })
  expect(win.isClosed()).toBe(false)
})

test('保存后关窗不再被拦截,内容已落盘', async () => {
  const { win, app } = harness!
  const file = join(makeWorkspace({ '草稿.md': '原文\n' }), '草稿.md')

  await win.evaluate((p: string) => (window as unknown as PageHooks).__actions.openPath(p), file)
  await expect.poll(() => win.evaluate(() => (window as unknown as PageHooks).__doc.name)).toBe(
    '草稿.md'
  )

  await win.evaluate(() => (window as unknown as PageHooks).__editor.setMarkdown('改过的内容\n'))
  await expect.poll(() => win.evaluate(() => (window as unknown as PageHooks).__doc.dirty)).toBe(true)

  // 先存盘让脏标记归零,close 就不会触发拦截,也就不会弹出模态框
  expect(await win.evaluate(() => (window as unknown as PageHooks).__actions.save(false))).toBe(true)
  expect(await win.evaluate(() => (window as unknown as PageHooks).__doc.dirty)).toBe(false)

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await expect.poll(() => win.isClosed()).toBe(true)
  expect(readFileSync(file, 'utf-8')).toBe('改过的内容\n')
})

test('停止输入 2 秒后自动落盘', async () => {
  const { win } = harness!
  const file = join(makeWorkspace({ '自动.md': '原内容\n' }), '自动.md')

  await win.evaluate((p: string) => (window as unknown as PageHooks).__actions.openPath(p), file)
  await expect.poll(() => win.evaluate(() => (window as unknown as PageHooks).__doc.name)).toBe(
    '自动.md'
  )

  await win.evaluate(() => (window as unknown as PageHooks).__editor.setMarkdown('自动保存内容\n'))
  await expect
    .poll(() => readFileSync(file, 'utf-8'), { timeout: 10_000 })
    .toBe('自动保存内容\n')
})
