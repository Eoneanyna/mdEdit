import { Crepe } from '@milkdown/crepe'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx
} from '@milkdown/kit/core'
import { remarkPreserveEmptyLinePlugin } from '@milkdown/kit/preset/commonmark'
import { remarkGFMPlugin } from '@milkdown/kit/preset/gfm'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { replaceAll } from '@milkdown/kit/utils'
import { displayWidth } from './display-width'
import type { AiSource } from '@shared/ipc'
import { revealCitation, type CitationMatch } from './citation'
import {
  clearSearch,
  moveMatch,
  replaceAll as replaceAllMatches,
  replaceCurrent,
  type SearchSnapshot,
  searchPlugin,
  setQuery
} from '../search/search-plugin'
import { createMoveDragProps } from './drag-move'
import {
  createFormatPainterPlugin,
  FORMAT_PAINTER_ICON,
  isFormatPainterActive,
  PROGRAMMATIC_SELECTION,
  toggleFormatPainter
} from './format-painter'
import { attachTableContextMenu } from './table-menu'

/** 编辑器内容变化的回调 */
export type MarkdownChangeHandler = (markdown: string) => void

/**
 * 序列化器总会在文档末尾补换行,数量与原文未必一致。
 * 统一收敛为单个换行,避免「打开后直接保存」也把文件改掉。
 */
function normalizeTail(markdown: string): string {
  return markdown.replace(/\n+$/, '\n')
}

export interface EditorSearch {
  setQuery: (query: string) => SearchSnapshot
  next: () => SearchSnapshot
  prev: () => SearchSnapshot
  replaceCurrent: (replacement: string) => SearchSnapshot
  /** 返回替换次数 */
  replaceAll: (replacement: string) => number
  clear: () => void
}

export interface EditorHandle {
  /** 取当前文档的 Markdown 源码 */
  getMarkdown: () => string
  getSelection: () => { text: string; from: number; to: number }
  revealSource: (source: AiSource) => CitationMatch
  /** 查找替换 */
  search: EditorSearch
  /** 整篇替换内容,用于切换文件与大纲拖动 */
  setMarkdown: (markdown: string) => void
  /** 订阅内容变化 */
  onChange: (handler: MarkdownChangeHandler) => void
  /** 让编辑区取得焦点 */
  focus: () => void
  /** 当前光标偏移,用于保存阅读进度 */
  getCursor: () => number
  /** 恢复光标位置:只改选区,不滚动、不触发格式刷 */
  setCursor: (pos: number) => void
  /** 订阅格式刷的激活状态,供状态栏给出提示 */
  onFormatPainterChange: (handler: (active: boolean) => void) => void
  /** 释放编辑器 */
  destroy: () => Promise<void>
}

/**
 * 创建所见即所得编辑器。
 *
 * 关闭的特性:
 * - 内置 AI:由本项目独立的知识库问答面板替代
 * - Latex:公式渲染属于第二层功能,留到后续里程碑再开
 */
export async function createEditor(
  root: HTMLElement,
  defaultValue: string
): Promise<EditorHandle> {
  let painterListener: (active: boolean) => void = () => {}
  // 编辑器内部拖动一律按「剪切」处理
  const moveDrag = createMoveDragProps()

  const crepe = new Crepe({
    root,
    defaultValue,
    features: {
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.Latex]: false
    },
    featureConfigs: {
      // 浮动工具栏补一个格式刷:选中源文字 -> 点刷子 -> 选中目标文字即应用
      [Crepe.Feature.Toolbar]: {
        buildToolbar: (builder) => {
          builder.getGroup('formatting').addItem('format-painter', {
            icon: FORMAT_PAINTER_ICON,
            label: '格式刷',
            active: (ctx) => isFormatPainterActive(ctx.get(editorViewCtx)),
            onRun: (ctx) => toggleFormatPainter(ctx.get(editorViewCtx))
          })
        }
      }
    }
  })

  // 保存时尽量不改写用户原有的书写风格:
  // 1) 列表符号沿用更常见的 "-",而不是 remark-stringify 默认的 "*"
  crepe.editor.config((ctx) => {
    ctx.set(remarkStringifyOptionsCtx, {
      ...ctx.get(remarkStringifyOptionsCtx),
      bullet: '-'
    })

    // 表格列宽默认按字符个数算,中文因此对不齐;改用等宽字体下的实际列数
    ctx.set(remarkGFMPlugin.options.key, {
      ...ctx.get(remarkGFMPlugin.options.key),
      stringLength: displayWidth
    })

    // 放在 DirectEditorProps 上而非插件 props 里,优先级高于各插件的
    // handleDrop,确保内部文本拖放一定走剪切分支。
    ctx.update(editorViewOptionsCtx, (prev) => ({
      ...prev,
      ...moveDrag,
      handleDOMEvents: { ...prev.handleDOMEvents, ...moveDrag.handleDOMEvents }
    }))
  })

  // 2) 该插件会把空段落序列化成 <br />,导致 HTML 标签混进 Markdown 源码,移除之
  await crepe.editor.remove(remarkPreserveEmptyLinePlugin)

  // 查找高亮与格式刷以 ProseMirror 插件实现,须在创建前注册
  crepe.editor.use(searchPlugin)
  crepe.editor.use(createFormatPainterPlugin((active) => painterListener(active)))

  await crepe.create()

  const ctx: Ctx = crepe.editor.action((c) => c)
  const view = ctx.get(editorViewCtx)
  const detachTableMenu = attachTableContextMenu(view, () => ctx)

  const withView = <T,>(fn: (view: EditorView) => T): T =>
    crepe.editor.action((c) => fn(c.get(editorViewCtx)))

  return {
    getMarkdown: () => normalizeTail(crepe.getMarkdown()),
    getSelection: () => withView(currentView => {
      const { from, to } = currentView.state.selection
      return { from, to, text: currentView.state.doc.textBetween(from, to, '\n') }
    }),
    revealSource: source => withView(currentView => revealCitation(currentView, normalizeTail(crepe.getMarkdown()), source)),

    search: {
      setQuery: (query) => withView((currentView) => setQuery(currentView, query)),
      next: () => withView((currentView) => moveMatch(currentView, 1)),
      prev: () => withView((currentView) => moveMatch(currentView, -1)),
      replaceCurrent: (replacement) => withView((currentView) => replaceCurrent(currentView, replacement)),
      replaceAll: (replacement) => withView((currentView) => replaceAllMatches(currentView, replacement)),
      clear: () => withView((currentView) => clearSearch(currentView))
    },

    setMarkdown: (markdown) => {
      crepe.editor.action(replaceAll(markdown))
    },

    onChange: (handler) => {
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => handler(markdown))
      })
    },

    focus: () => {
      root.querySelector<HTMLElement>('.ProseMirror')?.focus()
    },

    getCursor: () => withView(currentView => currentView.state.selection.head),

    setCursor: (pos) => withView(currentView => {
      const max = currentView.state.doc.content.size
      const safe = Math.max(0, Math.min(pos, max))
      const selection = TextSelection.near(currentView.state.doc.resolve(safe))
      currentView.dispatch(
        currentView.state.tr.setSelection(selection).setMeta(PROGRAMMATIC_SELECTION, true)
      )
    }),

    onFormatPainterChange: (handler) => {
      painterListener = handler
    },

    destroy: async () => {
      detachTableMenu()
      await crepe.destroy()
    }
  }
}
