import type { AiDocumentContext, AiSource } from '@shared/ipc'
import { chunkDocument } from './document-chunks'
import { keywords } from './search-local'

export function contextSources(context: AiDocumentContext, question: string): AiSource[] {
  const terms = keywords(question)
  const chunks = chunkDocument(context.content, context.content.length <= 12000 ? 12000 : 1400)
  const ranked = chunks.map((chunk, index) => ({ chunk, index,
    score: terms.filter(term => (chunk.snippet + (chunk.heading || '')).toLowerCase().includes(term)).length }))
  const summary = /总结|概括|摘要|梳理|全文|summary|summarize/i.test(question)
  const chosen = summary || !ranked.some(r => r.score)
    ? Array.from({ length: Math.min(6, ranked.length) }, (_, i) => ranked[Math.floor(i * ranked.length / Math.min(6, ranked.length))])
    : ranked.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 6)
  return chosen.sort((a, b) => a.index - b.index).map(({ chunk }, index) => ({
    id: index + 1, type: 'context', title: context.name, path: context.path || undefined,
    ...chunk, contextKind: context.kind, documentHash: context.documentHash, dirty: context.dirty,
    ...(context.kind === 'selection' ? { selectionFrom: context.selectionFrom, selectionTo: context.selectionTo, startLine: undefined, endLine: undefined } : {})
  }))
}
