import { describe, expect, it } from 'vitest'
import { ALL_KINDS, isEditableKind, kindOf } from './ipc'

describe('kindOf', () => {
  it('识别全部 Markdown 扩展名', () => {
    for (const ext of ['md', 'markdown', 'mdown', 'mkd']) {
      expect(kindOf(`文档.${ext}`)).toBe('markdown')
    }
  })

  it('识别文本 / Word / Excel 类别', () => {
    expect(kindOf('a.txt')).toBe('text')
    expect(kindOf('a.doc')).toBe('word')
    expect(kindOf('a.docx')).toBe('word')
    expect(kindOf('a.xls')).toBe('excel')
    expect(kindOf('a.xlsx')).toBe('excel')
    expect(kindOf('a.csv')).toBe('excel')
  })

  it('扩展名大小写不敏感', () => {
    expect(kindOf('a.MD')).toBe('markdown')
    expect(kindOf('a.Txt')).toBe('text')
  })

  it('无扩展名或不受支持时返回 null', () => {
    expect(kindOf('README')).toBeNull()
    expect(kindOf('a.pdf')).toBeNull()
    expect(kindOf('a.js')).toBeNull()
  })

  it('取最后一个点作为扩展名起点', () => {
    expect(kindOf('我的 笔记.v2.md')).toBe('markdown')
  })
})

describe('isEditableKind', () => {
  it('仅 markdown 与 text 可在应用内编辑', () => {
    for (const kind of ALL_KINDS) {
      expect(isEditableKind(kind)).toBe(kind === 'markdown' || kind === 'text')
    }
  })

  it('null 不可编辑', () => {
    expect(isEditableKind(null)).toBe(false)
  })
})
