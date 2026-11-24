import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'
import { applyPainterMarks, collectPainterMarks } from './format-painter'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' }
  },
  marks: {
    strong: {},
    emphasis: {},
    strikethrough: {},
    inlineCode: {},
    link: { attrs: { href: {} } }
  }
})

function markNames(state: EditorState, pos: number): string[] {
  return (state.doc.nodeAt(pos)?.marks ?? []).map((mark) => mark.type.name)
}

function makeDoc(): EditorState['doc'] {
  return schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('粗斜文字', [schema.mark('strong'), schema.mark('emphasis')]),
      schema.text('普通文字')
    ])
  ])
}

describe('格式刷', () => {
  it('从选区拾取字体格式', () => {
    const doc = makeDoc()
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 5) })
    expect(collectPainterMarks(state).map((mark) => mark.type.name)).toEqual([
      'strong',
      'emphasis'
    ])
  })

  it('把拾取的格式刷到新选区,并清掉目标原有格式', () => {
    const doc = makeDoc()
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 5) })
    const marks = collectPainterMarks(state)

    // 目标文字原本带删除线
    const marked = state.tr.addMark(5, 9, schema.mark('strikethrough'))
    const target = state.apply(marked)
    expect(markNames(target, 5)).toContain('strikethrough')

    const tr = target.tr
    applyPainterMarks(tr, marks, { from: 5, to: 9 })
    const result = target.apply(tr)

    expect(markNames(result, 5)).toEqual(['strong', 'emphasis'])
    expect(markNames(result, 5)).not.toContain('strikethrough')
    expect(result.doc.textContent).toBe('粗斜文字普通文字')
  })

  it('空选区(仅光标)取光标处的待输入格式', () => {
    const doc = makeDoc()
    const state = EditorState.create({ doc })
    const withStored = state.apply(state.tr.setStoredMarks([schema.mark('strong')]))
    expect(collectPainterMarks(withStored).map((mark) => mark.type.name)).toEqual(['strong'])
  })
})
