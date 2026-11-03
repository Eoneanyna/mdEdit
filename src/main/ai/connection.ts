import type { AiConfig, AiPrivacySettings } from '@shared/ipc'
import { validateRequest } from './conversation'
import { enforceLocalPrivacy } from './profile'
import { callOpenAICompat } from './providers/openai-compat'

/** 固定的最小生成请求，不读取工作区、历史、偏好，也不保存配置。 */
export async function testAiConnection(config: AiConfig, privacy: AiPrivacySettings, signal?: AbortSignal): Promise<{ model: string; latencyMs: number }> {
  const request = validateRequest({ ...config, question: '请只回复 OK。', history: [], context: undefined,
    mode: 'general', useLocal: false, useWeb: false })
  enforceLocalPrivacy(request, privacy)
  signal?.throwIfAborted()
  const start = performance.now()
  await callOpenAICompat(request, '你正在进行连接测试。只回复 OK，不执行其他任务。', request.question, signal, undefined,
    { timeoutMs: 15000, maxTokens: 16 })
  signal?.throwIfAborted()
  return { model: request.model, latencyMs: Math.round(performance.now() - start) }
}
