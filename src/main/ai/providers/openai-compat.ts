import type { AiQueryRequest } from '@shared/ipc'
import { boundedHistory } from '../conversation'
import { readCompletionStream } from './sse'

export const PROVIDER_URLS = {
  openrouter: 'https://openrouter.ai/api/v1',
  siliconcloud: 'https://api.siliconflow.cn/v1',
  ollama: 'http://localhost:11434/v1'
}

export async function callOpenAICompat(
  req: AiQueryRequest, systemPrompt: string, userPrompt: string, signal?: AbortSignal,
  onDelta?: (text: string) => void
): Promise<string> {
  const baseUrl = req.baseUrl?.trim() || (req.provider === 'custom' ? '' : PROVIDER_URLS[req.provider])
  if (!baseUrl) throw new Error('自定义供应商需要填写 Base URL')
  const parsed = new URL(baseUrl)
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Base URL 必须使用 HTTP 或 HTTPS')
  const base = baseUrl.replace(/\/+$/, '')
  const url = base.endsWith('/chat/completions') ? base : base + '/chat/completions'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (req.apiKey?.trim()) headers.Authorization = 'Bearer ' + req.apiKey.trim()
  if (req.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/Eoneanyna/mdEdit'
    headers['X-Title'] = 'mdEdit'
  }
  const messages = [
    { role: 'system', content: systemPrompt },
    ...boundedHistory(req.history).flatMap((turn) => [
      { role: 'user', content: turn.question },
      { role: 'assistant', content: turn.answer }
    ]),
    { role: 'user', content: userPrompt }
  ]
  try {
    const res = await fetch(url, {
      method: 'POST', headers, redirect: 'error',
      body: JSON.stringify({ model: req.model, messages, temperature: 0.2, max_tokens: 2048, ...(onDelta ? { stream: true } : {}) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000)
    })
    if (!res.ok) {
      const hints: Record<number, string> = {
        401: 'API Key 无效或已过期', 402: '账户额度不足', 403: '请求被供应商拒绝',
        404: '模型或接口不存在，请检查模型名称和 Base URL', 429: '请求过于频繁，请稍后重试'
      }
      // 不回显供应商原始错误，避免凭据意外进入界面和日志。
      throw new Error(`模型请求失败 (${res.status})：${hints[res.status] || '供应商暂时不可用，请稍后重试'}`)
    }
    if (onDelta && res.headers.get('content-type')?.includes('text/event-stream')) {
      return await readCompletionStream(res, onDelta)
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('模型返回空内容，请重试或更换模型')
    onDelta?.(content)
    return content.trim()
  } catch (error) {
    if (signal?.aborted) throw new Error('已停止生成')
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('模型请求超时，请稍后重试')
    if (error instanceof TypeError) throw new Error('无法连接模型服务，请检查网络和 Base URL')
    throw error
  }
}
