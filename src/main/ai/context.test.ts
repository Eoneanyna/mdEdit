// @vitest-environment node
import { expect, it } from 'vitest'
import { chunkDocument } from './document-chunks'
import { contextSources } from './context'
import { validateRequest } from './conversation'
import type { AiDocumentContext, AiQueryRequest } from '@shared/ipc'

const context: AiDocumentContext = { kind: 'document', name: '笔记.md', path: null, content: '# 项目\n\n负责人：林知远\n',
  documentHash: 'a'.repeat(64), dirty: true, allowUnsaved: true }
const req: AiQueryRequest = { question: '负责人', provider: 'ollama', model: 'test', useLocal: false, useWeb: false, context }
it('requires explicit permission to include unsaved content and validates selection bounds', () => {
  expect(() => validateRequest({ ...req, context: { ...context, allowUnsaved: false } })).toThrow('显式勾选')
  expect(() => validateRequest({ ...req, context: { ...context, kind: 'selection', selectionFrom: 10, selectionTo: 1 } })).toThrow('范围无效')
  expect(() => validateRequest({ ...req, context: { ...context, kind: 'selection', content: '字'.repeat(12001), selectionFrom: 1, selectionTo: 12002 } })).toThrow('12000')
})
it('keeps exact snapshots, metadata and full small documents', () => {
  const sources = contextSources(context, '负责人')
  expect(sources).toHaveLength(1)
  expect(sources[0]).toMatchObject({ type: 'context', documentHash: context.documentHash, dirty: true, snippet: context.content, startLine: 1, endLine: 3 })
})
it('keeps line numbers through CRLF and ignores headings in fenced code', () => {
  const chunks = chunkDocument('# 真标题\r\n\r\n~~~text\r\n# 代码中的标题\r\n~~~\r\n正文', 25, 5)
  expect(chunks[0].heading).toBe('真标题')
  expect(chunks.every(c => c.heading !== '代码中的标题')).toBe(true)
  expect(chunks[1].startLine).toBeGreaterThan(1)
})
