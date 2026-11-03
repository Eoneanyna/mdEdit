import { expect, it } from 'vitest'
import { withCrepeEditor } from '../test-utils'

it('locates a citation across Markdown emphasis without changing document content', async () => {
  await withCrepeEditor('# 项目\n\n负责人：**林知远**，验收日期待定。\n', editor => {
    const before = editor.getMarkdown()
    expect(editor.revealSource({ id: 1, type: 'local', title: '项目.md', snippet: '负责人：**林知远**，验收日期待定。', startLine: 3, endLine: 3 })).toBe('exact')
    expect(editor.getSelection().text).toBe('负责人：林知远，验收日期待定。')
    expect(editor.getMarkdown()).toBe(before)
    expect(editor.revealSource({ id: 1, type: 'local', title: '项目.md', snippet: '已经删除的句子' })).toBe('missing')
  })
})
it('uses line hints to select the correct repeated passage', async () => {
  await withCrepeEditor('# 甲\n\n重复内容：负责人待定。\n\n# 乙\n\n重复内容：负责人待定。\n', editor => {
    const source = { id: 1, type: 'local' as const, title: '项目.md', snippet: '重复内容：负责人待定。' }
    editor.revealSource({ ...source, startLine: 3 })
    const first = editor.getSelection().from
    editor.revealSource({ ...source, startLine: 7 })
    expect(editor.getSelection().from).toBeGreaterThan(first)
  })
})
it('reports partial matches when the original passage has changed', async () => {
  await withCrepeEditor('第一行内容已经改动。\n\n第二行原始内容仍然存在。\n', editor => {
    expect(editor.revealSource({ id: 1, type: 'local', title: '项目.md', snippet: '第一行原来是其他内容。\n第二行原始内容仍然存在。' })).toBe('partial')
    expect(editor.getSelection().text).toBe('第二行原始内容仍然存在。')
  })
})
