import { existsSync } from 'node:fs'
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

test('文件树加载工作区,右键新建文件落盘并打开', async () => {
  const { win } = harness
  const dir = makeWorkspace({ 'notes.md': '已有内容\n' })

  await win.evaluate((d: string) => void (window as unknown as PageHooks).__tree.setRoot(d), dir)
  const existing = win.locator('.tree__row', { hasText: 'notes.md' })
  await expect(existing).toBeVisible()

  // 右键行 → 上下文菜单 → 新建 Markdown 文件 → 输入框填写 → 确定
  await existing.click({ button: 'right' })
  await win.locator('.popup__item', { hasText: '新建 Markdown 文件' }).click()

  const prompt = win.locator('.prompt')
  await expect(prompt).toBeVisible()
  await prompt.locator('.prompt__input').fill('new-note.md')
  await prompt.locator('[data-act="ok"]').click()
  await expect(prompt).toBeHidden()

  const created = join(dir, 'new-note.md')
  expect(existsSync(created)).toBe(true)
  await expect(win.locator('.tree__row', { hasText: 'new-note.md' })).toBeVisible()

  // 新建成功后会自动打开该文件
  await expect
    .poll(() => win.evaluate(() => (window as unknown as PageHooks).__doc.name))
    .toBe('new-note.md')
})
