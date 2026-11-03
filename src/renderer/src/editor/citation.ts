import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Nodes } from 'mdast'
import type { AiSource } from '@shared/ipc'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'

const parser = unified().use(remarkParse).use(remarkGfm)
const compact = (text: string): string => text.replace(/\s/g, '')

function plain(markdown: string): string {
  function text(node: Nodes): string {
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') return node.value
    return 'children' in node ? node.children.map(child => text(child)).join('') : ''
  }
  return text(parser.parse(markdown))
}

export async function documentHash(markdown: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(markdown))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export type CitationMatch = 'exact' | 'partial' | 'missing'

/** 将 Markdown 引用映射到 ProseMirror 文本位置，跨强调/链接等样式边界定位。 */
export function revealCitation(view: EditorView, markdown: string, source: AiSource): CitationMatch {
  const doc = view.state.doc
  const choose = (from: number, to: number): void => {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, from, to)).scrollIntoView())
    view.focus()
  }
  if (source.contextKind === 'selection' && Number.isInteger(source.selectionFrom) && Number.isInteger(source.selectionTo)) {
    const from = source.selectionFrom!, to = source.selectionTo!
    if (from >= 1 && to > from && to < doc.content.size && compact(doc.textBetween(from, to, '\n')) === compact(source.snippet)) {
      choose(from, to)
      return 'exact'
    }
  }
  let rendered = ''
  const positions: number[] = []
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return
    for (let i = 0; i < node.text.length; i++) {
      if (/\s/.test(node.text[i])) continue
      rendered += node.text[i]
      positions.push(position + i)
    }
  })
  let expected = source.startLine ? compact(plain(markdown.split('\n').slice(0, source.startLine - 1).join('\n'))).length : 0
  if (source.heading) {
    const title = compact(plain(source.heading.split(' > ').at(-1)!))
    const headings: number[] = []
    doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && compact(node.textContent) === title) {
        const index = positions.findIndex(position => position >= pos)
        if (index >= 0) headings.push(index)
      }
    })
    if (headings.length) expected = headings.sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected))[0]
  }
  function find(quote: string): boolean {
    if (!quote) return false
    const matches: number[] = []
    let cursor = rendered.indexOf(quote)
    while (cursor >= 0) { matches.push(cursor); cursor = rendered.indexOf(quote, cursor + 1) }
    if (!matches.length) return false
    const best = matches.sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected))[0]
    choose(positions[best], positions[best + quote.length - 1] + 1)
    return true
  }
  const quote = compact(source.contextKind === 'selection' ? source.snippet : plain(source.snippet))
  if (find(quote)) return 'exact'
  // 内容已变化时只定位仍匹配的长句，并向用户明确报告部分匹配。
  const lines = source.snippet.split('\n').map(line => compact(plain(line))).filter(line => line.length >= 8).sort((a, b) => b.length - a.length)
  for (const line of lines.slice(0, 20)) if (find(line)) return 'partial'
  return 'missing'
}
