// @vitest-environment node
import { expect, it } from 'vitest'
import { selectEvidence } from './select-evidence'
import type { AiSource } from '@shared/ipc'
it('keeps both document and web evidence within a shared budget with consecutive ids', () => {
  const local: AiSource[] = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, type: 'local', path: '/notes/' + i, title: 'RAG 笔记', snippet: 'RAG 的学习记录 ' + i }))
  const web: AiSource[] = Array.from({ length: 3 }, (_, i) => ({ id: i + 7, type: 'web', title: 'RAG 定义', snippet: 'RAG 公共知识', url: 'https://example.com/' + i }))
  const selected = selectEvidence([...local, ...web], 'RAG 定义')
  expect(selected).toHaveLength(8)
  expect(selected.filter(s => s.type === 'web')).toHaveLength(3)
  expect(selected.filter(s => s.type === 'local')).toHaveLength(5)
  expect(selected.map(s => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
})
it('removes repeated document fragments and tracking-url duplicates without merging distinct query pages', () => {
  const source: AiSource = { id: 1, type: 'local', path: '/a.md', title: '记录', snippet: '同一片段' }
  const web: AiSource = { id: 2, type: 'web', title: '网页', url: 'https://example.com/rag?a=1', snippet: '资料' }
  const result = selectEvidence([source, { ...source, id: 2 }, web, { ...web, url: web.url + '&utm_source=test#fragment' }, { ...web, url: 'https://example.com/rag?a=2' }], '资料')
  expect(result).toHaveLength(3)
})
it('ranks more relevant fragments ahead of loosely matching fragments', () => {
  const a: AiSource = { id: 1, type: 'local', title: '其他主题', snippet: '其他', path: '/a' }
  const b: AiSource = { id: 2, type: 'local', title: 'RAG definition', snippet: 'retrieval', path: '/b' }
  expect(selectEvidence([a, b], 'RAG definition')[0].path).toBe('/b')
})
