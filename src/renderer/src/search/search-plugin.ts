import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export interface SearchMatch {
  from: number
  to: number
}

/** 供界面展示的计数,index 从 1 开始,无匹配时为 0 */
export interface SearchSnapshot {
  total: number
  index: number
}

interface SearchState {
  query: string
  matches: SearchMatch[]
  /** 当前命中的下标,从 0 开始 */
  index: number
  decorations: DecorationSet
}

interface SearchMeta {
  query?: string
  index?: number
}

const EMPTY: SearchState = {
  query: '',
  matches: [],
  index: 0,
  decorations: DecorationSet.empty
}

export const searchKey = new PluginKey<SearchState>('mdedit-search')

/**
 * 在文档中查找。
 * 局限:逐个文本节点扫描,因此跨样式边界的词(例如"重**点**")不会被匹配到 ——
 * 这类文本在文档模型里本就是分开的两个节点。
 */
function findMatches(doc: ProseNode, query: string): SearchMatch[] {
  if (!query) return []
  const needle = query.toLowerCase()
  const matches: SearchMatch[] = []

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const haystack = node.text.toLowerCase()
    let at = haystack.indexOf(needle)
    while (at !== -1) {
      matches.push({ from: pos + at, to: pos + at + query.length })
      at = haystack.indexOf(needle, at + needle.length)
    }
  })

  return matches
}

function decorate(doc: ProseNode, matches: SearchMatch[], index: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty
  return DecorationSet.create(
    doc,
    matches.map((match, i) =>
      Decoration.inline(match.from, match.to, {
        class: i === index ? 'search-hit search-hit--current' : 'search-hit'
      })
    )
  )
}

function build(doc: ProseNode, query: string, rawIndex: number): SearchState {
  const matches = findMatches(doc, query)
  // 下标环绕,便于「下一个」在末尾回到开头
  const index =
    matches.length === 0 ? 0 : ((rawIndex % matches.length) + matches.length) % matches.length
  return { query, matches, index, decorations: decorate(doc, matches, index) }
}

export const searchPlugin = $prose(
  () =>
    new Plugin<SearchState>({
      key: searchKey,
      state: {
        init: () => EMPTY,
        apply(tr, value) {
          const meta = tr.getMeta(searchKey) as SearchMeta | undefined
          if (meta) {
            return build(tr.doc, meta.query ?? value.query, meta.index ?? value.index)
          }
          // 文档变动后位置会失效,需按新内容重新定位
          if (tr.docChanged && value.query) return build(tr.doc, value.query, value.index)
          return value
        }
      },
      props: {
        decorations: (state) => searchKey.getState(state)?.decorations ?? DecorationSet.empty
      }
    })
)

function stateOf(view: EditorView): SearchState {
  return searchKey.getState(view.state) ?? EMPTY
}

function snapshot(state: SearchState): SearchSnapshot {
  return { total: state.matches.length, index: state.matches.length === 0 ? 0 : state.index + 1 }
}

/** 选中当前命中并滚动到可见区域 */
function revealCurrent(view: EditorView): void {
  const state = stateOf(view)
  const match = state.matches[state.index]
  if (!match) return
  const selection = TextSelection.create(view.state.doc, match.from, match.to)
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
}

export function getSnapshot(view: EditorView): SearchSnapshot {
  return snapshot(stateOf(view))
}

export function setQuery(view: EditorView, query: string): SearchSnapshot {
  view.dispatch(view.state.tr.setMeta(searchKey, { query, index: 0 }))
  revealCurrent(view)
  return getSnapshot(view)
}

/** delta 为 +1/-1,越界自动环绕 */
export function moveMatch(view: EditorView, delta: number): SearchSnapshot {
  const state = stateOf(view)
  if (state.matches.length === 0) return snapshot(state)
  view.dispatch(view.state.tr.setMeta(searchKey, { index: state.index + delta }))
  revealCurrent(view)
  return getSnapshot(view)
}

export function replaceCurrent(view: EditorView, replacement: string): SearchSnapshot {
  const state = stateOf(view)
  const match = state.matches[state.index]
  if (!match) return snapshot(state)

  const tr = view.state.tr.insertText(replacement, match.from, match.to)
  // 替换后原地重算,下标保持不变即可指向下一处
  tr.setMeta(searchKey, { index: state.index })
  view.dispatch(tr)
  revealCurrent(view)
  return getSnapshot(view)
}

/** 返回实际替换的次数 */
export function replaceAll(view: EditorView, replacement: string): number {
  const state = stateOf(view)
  if (state.matches.length === 0) return 0

  const tr = view.state.tr
  // 自后向前替换,避免前面的改动使后面的位置发生偏移
  for (let i = state.matches.length - 1; i >= 0; i--) {
    const match = state.matches[i]!
    tr.insertText(replacement, match.from, match.to)
  }
  tr.setMeta(searchKey, { index: 0 })
  view.dispatch(tr)
  return state.matches.length
}

export function clearSearch(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(searchKey, { query: '', index: 0 }))
}
