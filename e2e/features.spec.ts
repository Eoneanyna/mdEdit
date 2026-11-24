/**
 * 本次功能改动的回归用例:表格右键编辑、格式刷、大纲整节拖动、阅读进度。
 * 走真实打包产物,验证 ProseMirror / Crepe 的运行时行为,而非仅纯函数。
 */
import { basename, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, makeWorkspace, type AppHarness, type PageHooks } from './helpers'

let harness: AppHarness | undefined

test.beforeEach(async () => {
  harness = await launchApp()
})

test.afterEach(async () => {
  const current = harness
  harness = undefined
  if (current) await current.dispose()
})

test('表格右键可插入与删除行列', async () => {
  const { win } = harness!
  const source = '| A | B |\n| --- | --- |\n| 1 | 2 |\n'
  const file = join(makeWorkspace({ '表.md': source }), '表.md')
  await win.evaluate((p: string) => (window as unknown as PageHooks).__actions.openPath(p), file)
  await expect.poll(() => win.locator('.ProseMirror td').count()).toBeGreaterThan(0)

  const markdown = (): Promise<string> =>
    win.evaluate(() => (window as unknown as PageHooks).__editor.getMarkdown())
  const rowCount = async (): Promise<number> =>
    (await markdown()).split('\n').filter((line) => line.startsWith('|')).length

  expect(await rowCount()).toBe(3)

  // 在第一个单元格上右键,菜单由本项目接管
  await win.locator('.ProseMirror td').first().click({ button: 'right' })
  const insert = win.locator('.popup__item', { hasText: '在下方插入行' })
  await expect(insert).toBeVisible()
  await insert.click()
  await expect.poll(rowCount).toBe(4)

  // 再删掉刚插入的行,验证删除路径同样作用在右键所在的行
  await win.locator('.ProseMirror td').first().click({ button: 'right' })
  const remove = win.locator('.popup__item', { hasText: '删除当前行' })
  await expect(remove).toBeVisible()
  await remove.click()
  await expect.poll(rowCount).toBe(3)
})

test('浮动工具栏提供格式刷,拾取后进入待应用状态', async () => {
  const { win } = harness!
  await win.evaluate(() =>
    (window as unknown as PageHooks).__editor.setMarkdown('**加粗** 普通文字\n')
  )
  await expect.poll(() => win.locator('.ProseMirror strong').count()).toBe(1)

  const brush = win.locator('button[data-toolbar-item="format-painter"]')
  expect(await brush.count()).toBe(1)
  expect(await brush.getAttribute('aria-label')).toBe('格式刷')

  // 用真实鼠标拖选源文字,浮动工具栏随之出现
  const box = await win.locator('.ProseMirror strong').first().boundingBox()
  expect(box).not.toBeNull()
  await win.mouse.move(box!.x + 2, box!.y + box!.height / 2)
  await win.mouse.down()
  await win.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2, { steps: 6 })
  await win.mouse.up()

  await expect(brush).toBeVisible()
  await brush.click()
  await expect(win.locator('.ProseMirror.mdedit-painter-active')).toBeVisible()
})

test('大纲拖动把标题连同子标题与正文一起搬走', async () => {
  const { win } = harness!
  const source = '# a\n\n## b\n\n### c\n\n正文 c\n\n# 另一节\n\n结尾\n'
  const file = join(makeWorkspace({ '大纲.md': source }), '大纲.md')
  await win.evaluate((p: string) => (window as unknown as PageHooks).__actions.openPath(p), file)
  await win.evaluate(() => (window as unknown as PageHooks).__actions.setTab('outline'))
  await expect.poll(() => win.locator('.outline__item').count()).toBe(4)

  // 把 "b"(第 2 项)拖到 "a"(第 1 项)之前
  await win.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('.outline__item')]
    const data = new DataTransfer()
    rows[1]!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }))
    const rect = rows[0]!.getBoundingClientRect()
    const point = { bubbles: true, dataTransfer: data, clientY: rect.top + 2, clientX: rect.left + 4 }
    rows[0]!.dispatchEvent(new DragEvent('dragover', point))
    rows[0]!.dispatchEvent(new DragEvent('drop', point))
  })

  await expect
    .poll(() => win.evaluate(() => (window as unknown as PageHooks).__editor.getMarkdown()))
    .toMatch(/^## b[\s\S]*### c[\s\S]*正文 c[\s\S]*# a/)
})

test('重新打开同一文件时回到上次的阅读位置', async () => {
  const { win } = harness!
  const long = Array.from({ length: 120 }, (_, i) => `第 ${i + 1} 行内容`).join('\n\n') + '\n'
  const dir = makeWorkspace({ '长文.md': long, '另一篇.md': '短文档\n' })
  const longFile = join(dir, '长文.md')
  const otherFile = join(dir, '另一篇.md')

  await win.evaluate((p: string) => (window as unknown as PageHooks).__actions.openPath(p), longFile)
  await expect.poll(() => win.locator('.ProseMirror p').count()).toBeGreaterThan(100)

  await win.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.editor-pane')!
    pane.scrollTop = Math.round((pane.scrollHeight - pane.clientHeight) * 0.6)
  })
  // 滚动进度在停止滚动 500ms 后落盘
  await win.waitForTimeout(800)

  await win.evaluate((p: string) => (window as unknown as PageHooks).__actions.openPath(p), otherFile)
  await win.evaluate((p: string) => (window as unknown as PageHooks).__actions.openPath(p), longFile)

  await expect
    .poll(() =>
      win.evaluate(() => document.querySelector<HTMLElement>('.editor-pane')!.scrollTop)
    )
    .toBeGreaterThan(100)
})

test('双击文件冷启动时,文件树以该文件所在目录为根', async () => {
  const dir = makeWorkspace({ '目标.md': '正文\n', '邻居.md': '另一个文件\n' })
  const file = join(dir, '目标.md')

  // 文档路径必须在冷启动时作为命令行参数传入,故换掉默认实例
  await harness!.dispose()
  harness = await launchApp({ args: [file] })
  const { win } = harness

  await expect
    .poll(() => win.evaluate(() => (window as unknown as PageHooks).__doc.name))
    .toBe('目标.md')
  expect(await win.locator('#workspace-name').textContent()).toBe(basename(dir))
  await expect(win.locator('.tree__row', { hasText: '邻居.md' })).toBeVisible()
})
