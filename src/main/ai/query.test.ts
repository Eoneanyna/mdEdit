import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiQueryRequest } from '@shared/ipc'
vi.mock('./providers/openai-compat', () => ({ callOpenAICompat: vi.fn() }))
vi.mock('./search-rag', () => ({ ragSearch: vi.fn() }))
vi.mock('./search-local', () => ({ searchLocalMd: vi.fn() }))
vi.mock('./search-web', () => ({ searchWeb: vi.fn() }))
import { callOpenAICompat } from './providers/openai-compat'
import { ragSearch } from './search-rag'
import { searchLocalMd } from './search-local'
import { queryAi } from './query'

const req: AiQueryRequest = { question: '它的负责人是谁', provider: 'ollama', model: 'test', useLocal: true, useWeb: false,
  history: [{ question: '青岚项目什么时候验收', answer: '12月8日', sources: [] }] }
beforeEach(() => { vi.mocked(ragSearch).mockResolvedValue(null); vi.mocked(searchLocalMd).mockResolvedValue([]) })
afterEach(() => vi.resetAllMocks())
describe('retrieval augmented follow-ups', () => {
  it('rewrites follow-ups and generates using fresh numbered evidence and history', async () => {
    vi.mocked(callOpenAICompat).mockResolvedValueOnce('青岚项目负责人是谁').mockResolvedValueOnce('林知远 [1]')
    vi.mocked(ragSearch).mockResolvedValue([{ path: '/docs/project.md', rel: 'project.md', snippet: '负责人：林知远', score: 1 }])
    const result = await queryAi(req, '/docs')
    expect(ragSearch).toHaveBeenCalledWith('青岚项目负责人是谁', '/docs', 6, undefined)
    expect(result.sources[0].id).toBe(1)
    expect(result.retrievalMode).toBe('rag')
    const answerCall = vi.mocked(callOpenAICompat).mock.calls[1]
    expect(answerCall[0].history).toHaveLength(1)
    expect(answerCall[2]).toContain('负责人：林知远')
  })
  it('uses keyword fallback even if RAG returns an empty array', async () => {
    vi.mocked(callOpenAICompat).mockResolvedValueOnce('改写').mockResolvedValueOnce('无资料')
    vi.mocked(ragSearch).mockResolvedValue([])
    const result = await queryAi(req, '/docs')
    expect(searchLocalMd).toHaveBeenCalled()
    expect(result.notices.join('')).toContain('未检索到')
  })
  it('retains previous topic if query rewrite fails', async () => {
    vi.mocked(callOpenAICompat).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce('答')
    const result = await queryAi(req, '/docs')
    expect(result.retrievalQuery).toContain('青岚项目')
    expect(result.notices.join('')).toContain('改写未成功')
  })
  it('never starts inference after cancellation', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(queryAi(req, '/docs', controller.signal)).rejects.toThrow()
    expect(callOpenAICompat).not.toHaveBeenCalled()
  })
  it('reports missing or invalid citation numbers without inventing attribution', async () => {
    vi.mocked(ragSearch).mockResolvedValue([{ path: '/docs/a.md', rel: 'a.md', snippet: '资料', score: 1 }])
    vi.mocked(callOpenAICompat).mockResolvedValueOnce('回答没有编号').mockResolvedValueOnce('回答 [99]')
    const missing = await queryAi({ ...req, history: [] }, '/docs')
    expect(missing.answer).toBe('回答没有编号')
    expect(missing.notices.join('')).toContain('未标注有效引用')
    const invalid = await queryAi({ ...req, history: [] }, '/docs')
    expect(invalid.notices.join('')).toContain('无效引用编号')
  })
  it('emits scoped stages, sources and deltas in order', async () => {
    vi.mocked(ragSearch).mockResolvedValue([{ path: '/docs/a.md', rel: 'a.md', snippet: '资料', score: 1 }])
    vi.mocked(callOpenAICompat).mockImplementation(async (_req, _system, _prompt, _signal, onDelta) => {
      onDelta?.('答案 [1]')
      return '答案 [1]'
    })
    const events: import('@shared/ipc').AiQueryEvent[] = []
    await queryAi({ ...req, requestId: 'test-stream', history: [] }, '/docs', undefined, event => events.push(event))
    expect(events.map(e => e.type)).toEqual(['stage', 'sources', 'stage', 'delta'])
    expect(events.every(e => e.requestId === 'test-stream')).toBe(true)
    expect(events.at(-1)).toEqual({ requestId: 'test-stream', type: 'delta', text: '答案 [1]' })
  })
})
