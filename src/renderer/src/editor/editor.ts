import { Crepe } from '@milkdown/crepe'
import { editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { remarkPreserveEmptyLinePlugin } from '@milkdown/kit/preset/commonmark'
import { remarkGFMPlugin } from '@milkdown/kit/preset/gfm'
import type { EditorView } from '@milkdown/kit/prose/view'
import { replaceAll } from '@milkdown/kit/utils'
import { displayWidth } from './display-width'
import {
  clearSearch,
  moveMatch,
  replaceAll as replaceAllMatches,
  replaceCurrent,
  type SearchSnapshot,
  searchPlugin,
  setQuery
} from '../search/search-plugin'

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
  /** 查找替换 */
  search: EditorSearch
  /** 整篇替换内容,用于切换文件 */
  setMarkdown: (markdown: string) => void
  /** 订阅内容变化 */
  onChange: (handler: MarkdownChangeHandler) => void
  /** 让编辑区取得焦点 */
  focus: () => void
  /** 释放编辑器 */
  destroy: () => Promise<void>
}

/**
 * 创建所见即所得编辑器。
 *
 * 关闭的特性:
 * - AI:依赖远程模型服务,本项目明确不联网
 * - Latex:公式渲染属于第二层功能,留到后续里程碑再开
 */
export async function createEditor(
  root: HTMLElement,
  defaultValue: string
): Promise<EditorHandle> {
  const crepe = new Crepe({
    root,
    defaultValue,
    features: {
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.Latex]: false
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
  })

  // 2) 该插件会把空段落序列化成 <br />,导致 HTML 标签混进 Markdown 源码,移除之
  await crepe.editor.remove(remarkPreserveEmptyLinePlugin)

  // 查找高亮以 ProseMirror decoration 实现,须在创建前注册
  crepe.editor.use(searchPlugin)

  await crepe.create()

  const withView = <T,>(fn: (view: EditorView) => T): T =>
    crepe.editor.action((ctx) => fn(ctx.get(editorViewCtx)))

  return {
    getMarkdown: () => normalizeTail(crepe.getMarkdown()),

    search: {
      setQuery: (query) => withView((view) => setQuery(view, query)),
      next: () => withView((view) => moveMatch(view, 1)),
      prev: () => withView((view) => moveMatch(view, -1)),
      replaceCurrent: (replacement) => withView((view) => replaceCurrent(view, replacement)),
      replaceAll: (replacement) => withView((view) => replaceAllMatches(view, replacement)),
      clear: () => withView((view) => clearSearch(view))
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

    destroy: async () => {
      await crepe.destroy()
    }
  }
}
