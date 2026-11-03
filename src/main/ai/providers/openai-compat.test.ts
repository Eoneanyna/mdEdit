import { afterEach, describe, expect, it, vi } from 'vitest'
import { callOpenAICompat } from './openai-compat'
import type { AiQueryRequest } from '@shared/ipc'

const req: AiQueryRequest = { question: '追问', provider: 'openrouter', model: 'openrouter/free', apiKey: 'test-placeholder', useLocal: true, useWeb: false }
afterEach(() => vi.unstubAllGlobals())
describe('OpenAI compatible requests', () => {
  it('uses the small generation budget and short timeout for a connection test', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })))
    vi.stubGlobal('fetch', fetcher)
    await callOpenAICompat(req, 'test', 'OK', undefined, undefined, { timeoutMs: 15000, maxTokens: 16 })
    expect(JSON.parse(fetcher.mock.calls[0][1].body).max_tokens).toBe(16)
    expect(fetcher.mock.calls[0][1].redirect).toBe('error')
  })
  it('sends ordered multi-turn messages, auth and the current evidence', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '答案' } }] })))
    vi.stubGlobal('fetch', fetcher)
    await callOpenAICompat({ ...req, baseUrl: 'https://example.test/v1/chat/completions/', history: [{ question: '前问', answer: '前答', sources: [] }] }, 'system', '本轮新资料')
    expect(fetcher.mock.calls[0][0]).toBe('https://example.test/v1/chat/completions')
    const options = fetcher.mock.calls[0][1]
    expect(JSON.parse(options.body).messages).toEqual([
      { role: 'system', content: 'system' }, { role: 'user', content: '前问' },
      { role: 'assistant', content: '前答' }, { role: 'user', content: '本轮新资料' }
    ])
    expect(options.headers.Authorization).toBe('Bearer test-placeholder')
    expect(options.signal).toBeDefined()
  })
  it('reports authentication errors without echoing upstream secrets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-upstream-body', { status: 401 })))
    await expect(callOpenAICompat(req, '', '')).rejects.toThrow('API Key 无效')
    await expect(callOpenAICompat(req, '', '')).rejects.not.toThrow('secret-upstream-body')
  })
  it('normalizes cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')))
    await expect(callOpenAICompat(req, '', '', controller.signal)).rejects.toThrow('已停止')
  })
  it('requests SSE when a delta handler is present and parses the answer', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"流式答案"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetcher)
    const onDelta = vi.fn()
    expect(await callOpenAICompat(req, '', '', undefined, onDelta)).toBe('流式答案')
    expect(JSON.parse(fetcher.mock.calls[0][1].body).stream).toBe(true)
    expect(onDelta).toHaveBeenCalledWith('流式答案')
  })
})
