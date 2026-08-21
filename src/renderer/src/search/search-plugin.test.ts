import { describe, expect, it } from 'vitest'
import { withCrepeEditor } from '../test-utils'

describe('查找替换', () => {
  const DOC = '苹果 香蕉 苹果 梨 苹果\n'

  it('统计全部命中,当前项从 1 开始', async () => {
    await withCrepeEditor(DOC, (editor) => {
      const snap = editor.search.setQuery('苹果')
      expect(snap.total).toBe(3)
      expect(snap.index).toBe(1)
    })
  })

  it('查找大小写不敏感', async () => {
    await withCrepeEditor('Hello hello HELLO\n', (editor) => {
      expect(editor.search.setQuery('hello').total).toBe(3)
    })
  })

  it('无命中时 total 与 index 均为 0,移动无副作用', async () => {
    await withCrepeEditor(DOC, (editor) => {
      const snap = editor.search.setQuery('不存在')
      expect(snap).toEqual({ total: 0, index: 0 })
      expect(editor.search.next()).toEqual({ total: 0, index: 0 })
      expect(editor.search.prev()).toEqual({ total: 0, index: 0 })
    })
  })

  it('next 在末尾环绕回开头', async () => {
    await withCrepeEditor(DOC, (editor) => {
      editor.search.setQuery('苹果')
      expect(editor.search.next().index).toBe(2)
      expect(editor.search.next().index).toBe(3)
      expect(editor.search.next().index).toBe(1)
    })
  })

  it('prev 在开头环绕回末尾', async () => {
    await withCrepeEditor(DOC, (editor) => {
      editor.search.setQuery('苹果')
      expect(editor.search.prev().index).toBe(3)
    })
  })

  it('替换当前项:命中数减一,当前项指向下一命中', async () => {
    await withCrepeEditor(DOC, (editor) => {
      editor.search.setQuery('苹果')
      const snap = editor.search.replaceCurrent('橘子')
      expect(snap.total).toBe(2)
      expect(editor.getMarkdown()).toBe('橘子 香蕉 苹果 梨 苹果\n')
    })
  })

  it('全部替换:返回替换次数,替换后无残留命中', async () => {
    await withCrepeEditor(DOC, (editor) => {
      editor.search.setQuery('苹果')
      const count = editor.search.replaceAll('橘子')
      expect(editor.getMarkdown()).toBe('橘子 香蕉 橘子 梨 橘子\n')
      expect(editor.search.setQuery('苹果').total).toBe(0)
    })
  })

  it('clear 清空查询', async () => {
    await withCrepeEditor(DOC, (editor) => {
      editor.search.setQuery('苹果')
      editor.search.clear()
      expect(editor.search.setQuery('苹果').total).toBe(3) // 文档未变,仅状态清空
    })
  })

  it('支持中文与部分词命中', async () => {
    await withCrepeEditor('重点内容\n重点内容\n', (editor) => {
      expect(editor.search.setQuery('重点').total).toBe(2)
    })
  })
})
