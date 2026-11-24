/**
 * 格式刷:把一段文字的行内格式(粗体、斜体、删除线、行内代码、链接)
 * 复制到之后选中的另一段文字上。
 *
 * 交互与 Word 一致:选中源文字 -> 点格式刷 -> 选中目标文字即自动应用并收起。
 * 期间按 Esc 可取消。实现为 ProseMirror 插件,键盘与鼠标选区都能触发。
 */
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { Mark } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/** 允许复制的行内标记。块级样式(标题/列表)不属于「字体格式」 */
const PAINTABLE = new Set(['strong', 'emphasis', 'strikethrough', 'inlineCode', 'link'])

/** 由代码发起的选区变更(如恢复阅读进度)不应触发格式刷 */
export const PROGRAMMATIC_SELECTION = 'mdedit-programmatic-selection'

interface Range {
  from: number
  to: number
}

interface PainterState {
  marks: Mark[] | null
  /** 激活时的选区,防止格式立刻刷回源文字 */
  armed: Range | null
  /** 连续模式下记录上次应用过的选区,避免重复派发 */
  lastApplied: Range | null
  /** 是否连续使用(暂由调用方决定是否开启) */
  sticky: boolean
}

type PainterMeta =
  | { type: 'activate'; marks: Mark[]; armed: Range; sticky: boolean }
  | { type: 'cancel' }
  | { type: 'applied'; range: Range }
  | { type: 'consume' }

const EMPTY: PainterState = { marks: null, armed: null, lastApplied: null, sticky: false }

export const formatPainterKey = new PluginKey<PainterState>('mdedit-format-painter')

function paintMark(state: EditorState): Mark[] {
  return (state.storedMarks ?? state.selection.$from.marks()).filter((mark) =>
    PAINTABLE.has(mark.type.name)
  )
}

/** 取选区内各文本节点格式的交集,混合格式时以共同部分为准 */
export function collectPainterMarks(state: EditorState): Mark[] {
  const { from, to, empty } = state.selection
  if (empty) return paintMark(state)

  let common: Mark[] | null = null
  let sawText = false
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return
    sawText = true
    const marks = node.marks.filter((mark) => PAINTABLE.has(mark.type.name))
    const next = common === null ? marks : common.filter((mark) => marks.some((m) => m.eq(mark)))
    common = next
    return next.length === 0 ? false : undefined
  })
  return sawText ? (common ?? []) : paintMark(state)
}

function stateOf(view: EditorView): PainterState {
  return formatPainterKey.getState(view.state) ?? EMPTY
}

export function isFormatPainterActive(view: EditorView): boolean {
  return stateOf(view).marks !== null
}

/** 拾取当前选区(或光标处)的格式并进入待应用状态 */
export function captureFormatPainter(view: EditorView, sticky = false): void {
  const { from, to } = view.state.selection
  view.dispatch(
    view.state.tr.setMeta(formatPainterKey, {
      type: 'activate',
      marks: collectPainterMarks(view.state),
      armed: { from, to },
      sticky
    } satisfies PainterMeta)
  )
}

export function cancelFormatPainter(view: EditorView): void {
  if (!isFormatPainterActive(view)) return
  view.dispatch(view.state.tr.setMeta(formatPainterKey, { type: 'cancel' } satisfies PainterMeta))
}

/** 工具栏按钮:再点一次即取消 */
export function toggleFormatPainter(view: EditorView): void {
  if (isFormatPainterActive(view)) cancelFormatPainter(view)
  else captureFormatPainter(view)
}

/** 选区内先清空可复制标记,再统一刷上源格式 */
export function applyPainterMarks(tr: EditorState['tr'], marks: Mark[], range: Range): void {
  for (const name of PAINTABLE) {
    const type = tr.doc.type.schema.marks[name]
    if (type) tr.removeMark(range.from, range.to, type)
  }
  for (const mark of marks) {
    if (tr.doc.type.schema.marks[mark.type.name]) tr.addMark(range.from, range.to, mark)
  }
}

export function createFormatPainterPlugin(onActiveChange?: (active: boolean) => void) {
  // appendTransaction 只负责识别「用户改了选区」,真正的应用交给 view 里的防抖回调。
  // 鼠标拖选会连续派发多个 selectionSet,若当场应用,格式只会刷到拖到一半的选区上。
  const runtime = { userSelectionPending: false }

  return $prose(
    () =>
      new Plugin<PainterState>({
        key: formatPainterKey,
        state: {
          init: () => EMPTY,
          apply(tr, value) {
            const meta = tr.getMeta(formatPainterKey) as PainterMeta | undefined
            if (!meta) return tr.docChanged ? { ...value, lastApplied: null } : value
            switch (meta.type) {
              case 'activate':
                return { marks: meta.marks, armed: meta.armed, lastApplied: null, sticky: meta.sticky }
              case 'cancel':
              case 'consume':
                return EMPTY
              case 'applied':
                return { ...value, lastApplied: meta.range }
            }
          }
        },
        appendTransaction(transactions) {
          const userSelection = transactions.some(
            (tr) =>
              tr.selectionSet &&
              !tr.docChanged &&
              !tr.getMeta(formatPainterKey) &&
              !tr.getMeta(PROGRAMMATIC_SELECTION)
          )
          if (userSelection) runtime.userSelectionPending = true
          // 不在这里改文档:等选区稳定后由 view 的防抖回调统一应用
          return null
        },
        props: {
          handleKeyDown(view, event) {
            if (event.key !== 'Escape' || !isFormatPainterActive(view)) return false
            cancelFormatPainter(view)
            return true
          }
        },
        view(view) {
          let timer: number | undefined

          const apply = (): void => {
            runtime.userSelectionPending = false
            const painter = formatPainterKey.getState(view.state)
            if (!painter?.marks) return
            const selection = view.state.selection
            if (!(selection instanceof TextSelection) || selection.empty) return

            const range = { from: selection.from, to: selection.to }
            const sameAsSource =
              painter.armed && range.from === painter.armed.from && range.to === painter.armed.to
            const alreadyApplied =
              painter.lastApplied &&
              range.from === painter.lastApplied.from &&
              range.to === painter.lastApplied.to
            if (sameAsSource || alreadyApplied) return

            const tr = view.state.tr
            applyPainterMarks(tr, painter.marks, range)
            const meta: PainterMeta = painter.sticky
              ? { type: 'applied', range }
              : { type: 'consume' }
            tr.setMeta(formatPainterKey, meta)
            view.dispatch(tr)
          }

          const sync = (active: boolean): void => {
            view.dom.classList.toggle('mdedit-painter-active', active)
            onActiveChange?.(active)
            if (!active) {
              window.clearTimeout(timer)
              runtime.userSelectionPending = false
            }
          }

          sync(isFormatPainterActive(view))
          return {
            update(next) {
              sync(isFormatPainterActive(next))
              if (!runtime.userSelectionPending) return
              // 拖选途中每次选区变化都重新计时,松手(或停止连按)后才刷一次
              window.clearTimeout(timer)
              timer = window.setTimeout(apply, 160)
            },
            destroy() {
              window.clearTimeout(timer)
            }
          }
        }
      })
  )
}

/** 选中文字时浮出的工具栏按钮图标 */
export const FORMAT_PAINTER_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
     fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14.5 3.5 20.5 9.5 11 19H5v-6z" />
  <path d="M12.5 5.5 18.5 11.5" />
  <path d="M4 21h8" />
</svg>`
