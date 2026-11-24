import { beforeEach, expect, it, vi } from 'vitest'
import type { AiQueryRequest } from '@shared/ipc'
vi.mock('./providers/openai-compat', () => ({ callOpenAICompat: vi.fn() }))
vi.mock('./search-rag', () => ({ ragSearch: vi.fn() }))
vi.mock('./search-local', () => ({ searchLocalMd: vi.fn() }))
vi.mock('./search-web', () => ({ searchWeb: vi.fn(), extractWebText: vi.fn() }))
import { callOpenAICompat } from './providers/openai-compat'
import { ragSearch } from './search-rag'
import { runAgent } from './agent-loop'
const req: AiQueryRequest = { provider: 'ollama', model: 'test', question: '123号零件用于哪些产品', mode: 'auto', useLocal: true, useWeb: false }
const call = (name: string, args: unknown) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } })
function plan(batches: ReturnType<typeof call>[][]): void {
  vi.mocked(callOpenAICompat).mockImplementation(async (_r, _s, _u, _signal, delta, options) => {
    if (options?.onMessage) { options.onMessage({ tool_calls: batches.shift() || [call('finish', {})] }); return '' }
    delta?.('产品甲 [1]'); return '产品甲 [1]'
  })
}
beforeEach(() => vi.resetAllMocks())
it('returns a direct learning roadmap without discarding it or requiring local references', async () => {
  const roadmap = '通用学习建议：先学模型调用与提示词，再学习检索和多轮会话，最后用一个问答项目练习。'
  vi.mocked(callOpenAICompat).mockImplementation(async (_r, system, _u, _signal, _delta, options) => {
    expect(system || JSON.stringify(options?.messages)).toContain('学习路线')
    options?.onMessage?.({ content: roadmap })
    return roadmap
  })
  const events: unknown[] = []
  const result = await runAgent({ ...req, question: '学习langchain应该从哪些方面学习？' }, '/docs', undefined, e => events.push(e))
  expect(result.answer).toBe(roadmap)
  expect(result.sources).toEqual([])
  expect(callOpenAICompat).toHaveBeenCalledTimes(1)
  expect(ragSearch).not.toHaveBeenCalled()
  expect(events).toContainEqual({ type: 'delta', text: roadmap })
})
it('uses learning guidance rather than strict notes restrictions after local retrieval', async () => {
  plan([[call('search_local', { query: 'LangChain 学习' })], [call('finish', {})]])
  vi.mocked(ragSearch).mockResolvedValue([{ path: '/docs/learning.md', rel: 'learning.md', snippet: '我已学过Python基础', score: 1 }])
  await runAgent({ ...req, question: '学习langchain应该从哪些方面学习？' }, '/docs', undefined, () => {})
  const final = vi.mocked(callOpenAICompat).mock.calls.at(-1)!
  expect(final[1]).toContain('不是通用问题的回答边界')
  expect(final[1]).toContain('专属事实必须有本轮本地资料依据')
  expect(final[1]).not.toContain('只有用户明确要求通用建议时')
  expect(final[2]).toContain('我已学过Python基础')
})
it('rejects an empty direct message instead of silently making a second request', async () => {
  vi.mocked(callOpenAICompat).mockImplementation(async (_r, _s, _u, _signal, _delta, options) => {
    options?.onMessage?.({ content: null }); return ''
  })
  await expect(runAgent(req, null, undefined, () => {})).rejects.toThrow('模型返回空内容')
  expect(callOpenAICompat).toHaveBeenCalledTimes(1)
})
it('searches again using intermediate evidence and keeps stable citations', async () => {
  plan([[call('search_local', { query: '123号零件' })], [call('search_local', { query: '产品甲 BOM' })], [call('finish', {})]])
  vi.mocked(ragSearch).mockResolvedValue([{ path: '/docs/a.md', rel: 'a.md', snippet: '123号零件用于产品甲', score: 1 }])
  const events: unknown[] = []
  const result = await runAgent(req, '/docs', undefined, e => events.push(e))
  expect(ragSearch).toHaveBeenCalledTimes(2)
  expect(result.sources).toHaveLength(1)
  expect(result.answer).toBe('产品甲 [1]')
  expect(events).toContainEqual({ type: 'tool', name: 'search_local', state: 'done' })
})
it('returns a clarification without inventing a manufacturer or generating an answer', async () => {
  plan([[call('ask_user', { question: '请提供厂商及完整型号？' })]])
  const result = await runAgent(req, null, undefined, () => {})
  expect(result.answer).toBe('请提供厂商及完整型号？')
  expect(callOpenAICompat).toHaveBeenCalledTimes(1)
})
it('does not expose web tools when disabled and refuses invented tool calls', async () => {
  plan([[call('search_web', { query: 'secret' })], [call('finish', {})]])
  const events: unknown[] = []
  await runAgent(req, null, undefined, e => events.push(e))
  const tools = vi.mocked(callOpenAICompat).mock.calls[0][5]?.tools
  expect(JSON.stringify(tools)).not.toContain('search_web')
  expect(events).toContainEqual({ type: 'tool', name: 'search_web', state: 'error' })
})
it('bounds repeated calls and still produces a final answer', async () => {
  plan(Array.from({ length: 20 }, () => [call('unknown', {})]))
  const result = await runAgent(req, null, undefined, () => {})
  expect(result.notices.join('')).toContain('循环上限')
  expect(callOpenAICompat).toHaveBeenCalledTimes(7)
})
it('cancels before making any model request', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(runAgent(req, null, controller.signal, () => {})).rejects.toThrow()
  expect(callOpenAICompat).not.toHaveBeenCalled()
})
