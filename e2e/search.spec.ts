import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, makeWorkspace, type AppHarness, type PageHooks } from './helpers'

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

test('查找替换走真实 UI:计数、跳转、全部替换后落盘', async () => {
  const { win } = harness!
  const file = join(makeWorkspace({ '查找.md': 'alpha beta alpha gamma alpha\n' }), '查找.md')

  await win.evaluate((p: string) => (window as unknown as PageHooks).__actions.openPath(p), file)
  await expect.poll(() => win.evaluate(() => (window as unknown as PageHooks).__doc.name)).toBe(
    '查找.md'
  )

  await win.evaluate(() => (window as unknown as PageHooks).__search.open())
  const bar = win.locator('.search-bar')
  const count = bar.locator('[data-role="count"]')

  await bar.locator('[data-role="query"]').fill('alpha')
  await expect(count).toHaveText('1/3')

  await bar.locator('[data-act="next"]').click()
  await expect(count).toHaveText('2/3')

  await bar.locator('[data-role="replace"]').fill('omega')
  await bar.locator('[data-act="replace-all"]').click()
  await expect(count).toHaveText('0/0')

  await win.evaluate(() => (window as unknown as PageHooks).__search.close())
  expect(await win.evaluate(() => (window as unknown as PageHooks).__actions.save(false))).toBe(true)
  expect(readFileSync(file, 'utf-8')).toBe('omega beta omega gamma omega\n')
})
