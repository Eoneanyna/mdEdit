// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import type { AiConfig } from '@shared/ipc'
import { DEFAULT_PRIVACY } from './profile'
vi.mock('./providers/openai-compat', () => ({ callOpenAICompat: vi.fn() }))
import { callOpenAICompat } from './providers/openai-compat'
import { testAiConnection } from './connection'
const config: AiConfig = { provider: 'custom', model: 'local-model', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', useLocal: true, useWeb: true }
afterEach(() => vi.resetAllMocks())
it('sends only a short fixed request, ignoring injected history, context or question fields', async () => {
  vi.mocked(callOpenAICompat).mockResolvedValue('OK')
  const result = await testAiConnection({ ...config, question: 'secret-question', history: [{ question: 'secret-history' }], context: { content: 'secret-document' } } as any, DEFAULT_PRIVACY)
  expect(result.model).toBe(config.model); expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  const call = vi.mocked(callOpenAICompat).mock.calls[0]
  expect(call[0]).toMatchObject({ question: '请只回复 OK。', history: [], mode: 'general', useLocal: false, useWeb: false })
  expect(call[0].context).toBeUndefined()
  expect(call[5]).toEqual({ timeoutMs: 15000, maxTokens: 16 })
  expect(JSON.stringify(call)).not.toContain('secret-')
})
it('rejects cloud endpoints before making a request when local-only is enabled', async () => {
  await expect(testAiConnection({ ...config, baseUrl: 'https://example.com/v1' }, { ...DEFAULT_PRIVACY, localOnly: true })).rejects.toThrow('仅本机模式')
  expect(callOpenAICompat).not.toHaveBeenCalled()
})
it('validates missing cloud credentials without sending a request', async () => {
  await expect(testAiConnection({ ...config, provider: 'openrouter' }, DEFAULT_PRIVACY)).rejects.toThrow('API Key')
  expect(callOpenAICompat).not.toHaveBeenCalled()
})
it('does not start or report success after cancellation', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(testAiConnection(config, DEFAULT_PRIVACY, controller.signal)).rejects.toThrow()
  expect(callOpenAICompat).not.toHaveBeenCalled()
  const during = new AbortController()
  vi.mocked(callOpenAICompat).mockImplementation(async () => { during.abort(); return 'OK' })
  await expect(testAiConnection(config, DEFAULT_PRIVACY, during.signal)).rejects.toThrow()
})
