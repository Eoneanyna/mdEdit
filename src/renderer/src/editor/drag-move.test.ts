import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { describe, expect, it } from 'vitest'
import { createMoveDragProps } from './drag-move'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' }
  }
})

const TEXT = 'abcdefghij'

/** 构造一个最小的 EditorView:只提供拖放处理器实际用到的能力 */
function makeView() {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text(TEXT)])])
  const from = 3
  const to = 6
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, from, to) })
  const dom = document.createElement('div')
  const view = {
    get state() {
      return state
    },
    dom,
    posAtCoords: () => ({ pos: 10, inside: 0 }),
    dispatch: (tr: Transaction) => {
      state = state.apply(tr)
    }
  } as unknown as EditorView

  return { view, dom, from, to, getState: () => state }
}

function dragStartEvent(dom: HTMLElement): DragEvent {
  return {
    target: dom,
    dataTransfer: { effectAllowed: '', files: [] }
  } as unknown as DragEvent
}

function dropEvent(): DragEvent {
  return {
    clientX: 10,
    clientY: 10,
    dataTransfer: { files: [] },
    preventDefault: () => {}
  } as unknown as DragEvent
}

describe('编辑器内文本拖放', () => {
  it('把源选区剪切到落点,原位置内容消失且总长度不变', () => {
    const { view, dom, from, to, getState } = makeView()
    const props = createMoveDragProps()

    props.handleDOMEvents.dragstart(view, dragStartEvent(dom))
    const slice = getState().doc.slice(from, to)
    expect(props.handleDrop(view, dropEvent(), slice, false)).toBe(true)

    const text = getState().doc.textContent
    expect(text).toHaveLength(TEXT.length)
    expect(text.match(/cde/g)).toHaveLength(1)
    // 原文 cde 位于下标 2,移动后应出现在更靠后的位置
    expect(text.indexOf('cde')).toBeGreaterThan(2)
    expect(text).not.toBe(TEXT)
  })

  it('拖回源选区内部视为取消,不修改文档', () => {
    const { view, dom, from, to, getState } = makeView()
    const props = createMoveDragProps()
    props.handleDOMEvents.dragstart(view, dragStartEvent(dom))

    // 落点落在源选区范围内
    const viewInside = Object.assign({}, view, { posAtCoords: () => ({ pos: 4, inside: 0 }) }) as EditorView
    props.handleDOMEvents.dragstart(viewInside, dragStartEvent(dom))
    expect(props.handleDrop(viewInside, dropEvent(), getState().doc.slice(from, to), false)).toBe(true)
    expect(getState().doc.textContent).toBe(TEXT)
  })

  it('没有内部拖动源时不接管(文件拖入交给上传插件)', () => {
    const { view, from, to, getState } = makeView()
    const props = createMoveDragProps()
    expect(props.handleDrop(view, dropEvent(), getState().doc.slice(from, to), false)).toBe(false)
    expect(getState().doc.textContent).toBe(TEXT)
  })

  it('明确声明这是移动而非复制拖动', () => {
    expect(createMoveDragProps().dragCopies(dropEvent())).toBe(false)
  })
})
