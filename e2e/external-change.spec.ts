import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, makeWorkspace, type AppHarness, type PageHooks } from './helpers'

let harness: AppHarness

test.beforeEach(async () => {
  harness = await launchApp()
})

test.afterEach(async () => {
  await harness.dispose()
})

test('文件被外部程序修改后,确认重新载入并同步新内容', async () => {
  const { win } = harness
  const file = join(makeWorkspace({ '外部.md': '第一行\n' }), '外部.md')

  await win.evaluate((p: string) => (window as unknown as PageHooks).__actions.openPath(p), file)
  await expect.poll(() => win.evaluate(() => (window as unknown as PageHooks).__doc.name)).toBe(
    '外部.md'
  )

  // 重新载入前会弹 window.confirm,以脚本代答「确定」
  await win.evaluate(() => {
    window.confirm = () => true
  })

  appendFileSync(file, '第二行\n', 'utf-8')

  // 监听器通知 → 确认 → 重新载入,编辑器内容应包含外部新增的行
  await expect
    .poll(() => win.evaluate(() => (window as unknown as PageHooks).__editor.getMarkdown()), {
      timeout: 15_000
    })
    .toContain('第二行')

  // 重新载入后基准已刷新,不应残留未保存标记
  expect(await win.evaluate(() => (window as unknown as PageHooks).__doc.dirty)).toBe(false)
})
