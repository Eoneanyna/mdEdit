import type { OpenedDocument } from '@shared/ipc'
import { describe, expect, it, vi } from 'vitest'
import type { EditorHandle, EditorSearch, MarkdownChangeHandler } from '../editor/editor'
import { DocumentState } from './document'

/** 测试替身:记录内容,模拟编辑器序列化即回显的行为 */
class FakeEditor implements EditorHandle {
  content: string
  private handlers: MarkdownChangeHandler[] = []

  constructor(initial = '') {
    this.content = initial
  }

  getMarkdown(): string {
    return this.content
  }

  setMarkdown(markdown: string): void {
    this.content = markdown
    for (const handler of this.handlers) handler(markdown)
  }

  onChange(handler: MarkdownChangeHandler): void {
    this.handlers.push(handler)
  }

  focus(): void {}

  destroy(): Promise<void> {
    return Promise.resolve()
  }

  search: EditorSearch = {
    setQuery: () => ({ total: 0, index: 0 }),
    next: () => ({ total: 0, index: 0 }),
    prev: () => ({ total: 0, index: 0 }),
    replaceCurrent: () => ({ total: 0, index: 0 }),
    replaceAll: () => 0,
    clear: () => undefined
  }
}

const openDoc = (content: string): OpenedDocument => ({
  path: '/tmp/demo/笔记.md',
  name: '笔记.md',
  content,
  kind: 'markdown'
})

describe('DocumentState', () => {
  it('初始为空白未命名文档,不脏', () => {
    const editor = new FakeEditor()
    const doc = new DocumentState(editor)
    expect(doc.path).toBeNull()
    expect(doc.name).toBe('未命名.md')
    expect(doc.dirty).toBe(false)
  })

  it('支持自定义初始名(首屏语法帮助)', () => {
    const doc = new DocumentState(new FakeEditor(), '语法帮助')
    expect(doc.name).toBe('语法帮助')
  })

  it('订阅时立即收到当前快照', () => {
    const listener = vi.fn()
    new DocumentState(new FakeEditor()).subscribe(listener)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith({ path: null, name: '未命名.md', dirty: false })
  })

  it('内容变化触发脏标记,改回保存内容则变干净', () => {
    const editor = new FakeEditor('基线')
    const doc = new DocumentState(editor)
    const seen: boolean[] = []
    doc.subscribe((snap) => seen.push(snap.dirty))

    editor.setMarkdown('改动')
    expect(doc.dirty).toBe(true)

    editor.setMarkdown('基线')
    expect(doc.dirty).toBe(false)

    expect(seen).toEqual([false, true, false])
  })

  it('脏标记未变化时不重复派发', () => {
    const editor = new FakeEditor('基线')
    const doc = new DocumentState(editor)
    const seen: boolean[] = []
    doc.subscribe((snap) => seen.push(snap.dirty))

    editor.setMarkdown('改动一')
    editor.setMarkdown('改动二')
    expect(seen).toEqual([false, true])
  })

  it('open 以规范化后的内容为基准,打开即不脏', () => {
    const editor = new FakeEditor('旧文档')
    const doc = new DocumentState(editor)

    doc.open(openDoc('* 星号列表'))

    expect(doc.path).toBe('/tmp/demo/笔记.md')
    expect(doc.name).toBe('笔记.md')
    expect(doc.dirty).toBe(false)
    expect(editor.getMarkdown()).toBe('* 星号列表')
  })

  it('markSaved 刷新基准:保存后相同内容不再脏', () => {
    const editor = new FakeEditor('基线')
    const doc = new DocumentState(editor)

    editor.setMarkdown('改动')
    expect(doc.dirty).toBe(true)

    doc.markSaved('/tmp/demo/笔记.md', '笔记.md', '改动')
    expect(doc.dirty).toBe(false)

    editor.setMarkdown('改动')
    expect(doc.dirty).toBe(false)

    editor.setMarkdown('再改')
    expect(doc.dirty).toBe(true)
  })

  it('reset 回到空白未命名文档', () => {
    const editor = new FakeEditor('任意')
    const doc = new DocumentState(editor)
    doc.open(openDoc('内容'))

    doc.reset('模板')

    expect(doc.path).toBeNull()
    expect(doc.name).toBe('未命名.md')
    expect(doc.dirty).toBe(false)
    expect(editor.getMarkdown()).toBe('模板')
  })

  it('renamed 只更新路径与名称,不动内容', () => {
    const editor = new FakeEditor('未保存的改动')
    const doc = new DocumentState(editor)
    doc.open(openDoc('旧内容'))
    editor.setMarkdown('未保存的改动')
    expect(doc.dirty).toBe(true)

    doc.renamed('/tmp/demo/新名.md', '新名.md')

    expect(doc.path).toBe('/tmp/demo/新名.md')
    expect(doc.name).toBe('新名.md')
    expect(doc.dirty).toBe(true)
    expect(editor.getMarkdown()).toBe('未保存的改动')
  })

  it('renamed 对未落盘文档是空操作', () => {
    const doc = new DocumentState(new FakeEditor())
    doc.renamed('/tmp/x.md', 'x.md')
    expect(doc.path).toBeNull()
  })
})
