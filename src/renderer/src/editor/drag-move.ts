/**
 * 编辑器内部的文本拖动 = 剪切(移动),而不是复制。
 *
 * ProseMirror 默认虽然支持 move,但只要中途 `view.dragging` 丢失(多插件协作、
 * NodeView 重绘等),drop 就会退化成只插入不删除。这里显式接管编辑器内部的
 * 文本选区拖放:记录源选区 -> 删除源 -> 在落点插入,行为确定且不依赖内部状态。
 * 文件拖入、块级拖动柄仍交回原有处理器。
 */
import type { Slice } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { dropPoint } from '@milkdown/kit/prose/transform'
import type { EditorView } from '@milkdown/kit/prose/view'

interface DragSource {
  from: number
  to: number
}

type DomeHandler = (view: EditorView, event: Event) => boolean

export interface MoveDragProps {
  handleDOMEvents: Record<string, DomeHandler>
  dragCopies: (event: DragEvent) => boolean
  handleDrop: (view: EditorView, event: DragEvent, slice: Slice, move: boolean) => boolean
}

export function createMoveDragProps(): MoveDragProps {
  let pending: DragSource | null = null

  return {
    handleDOMEvents: {
      dragstart: (view, event): boolean => {
        const drag = event as DragEvent
        pending = null
        const target = drag.target
        // 块级拖动柄挂在编辑器 DOM 之外,由它自己的逻辑负责移动
        if (!(target instanceof Node) || !view.dom.contains(target)) return false
        const selection = view.state.selection
        if (!(selection instanceof TextSelection) || selection.empty) return false

        pending = { from: selection.from, to: selection.to }
        if (drag.dataTransfer) drag.dataTransfer.effectAllowed = 'move'
        return false
      },
      dragover: (_view, event): boolean => {
        const drag = event as DragEvent
        if (pending && drag.dataTransfer) drag.dataTransfer.dropEffect = 'move'
        return false
      },
      dragend: (): boolean => {
        // drop 可能排在 dragend 之后,延迟清空以免丢掉源范围
        window.setTimeout(() => {
          pending = null
        }, 100)
        return false
      }
    },

    // 明确告知 ProseMirror 这不是复制拖动,光标也会显示为移动
    dragCopies: (): boolean => false,

    handleDrop: (view, event, slice): boolean => {
      const source = pending
      pending = null
      if (!source || !slice || slice.content.size === 0) return false
      // 图片等文件拖入交给上传插件
      if (event.dataTransfer && event.dataTransfer.files.length > 0) return false

      const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (!coords) return false
      event.preventDefault()

      // 拖回源选区内部视为取消,不产生任何改动
      if (coords.pos >= source.from && coords.pos <= source.to) return true

      const before = view.state.doc
      const tr = view.state.tr
      tr.delete(source.from, source.to)
      let insertAt = tr.mapping.map(coords.pos)
      const point = dropPoint(tr.doc, insertAt, slice)
      if (point !== null) insertAt = point
      tr.replaceRange(insertAt, insertAt, slice)
      if (tr.doc.eq(before)) return true

      const end = Math.min(insertAt + slice.content.size, tr.doc.content.size)
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, end))))
      view.dispatch(tr)
      return true
    }
  }
}
