import type { AiQueryRequest } from '@shared/ipc'

export async function callOpenAICompat(req: AiQueryRequest, systemPrompt: string, userPrompt: string): Promise<string> {
  let baseUrl = req.baseUrl
  if (!baseUrl) {
    if (req.provider === 'openrouter') baseUrl = 'https://openrouter.ai/api/v1'
    else if (req.provider === 'siliconcloud') baseUrl = 'https://api.siliconflow.cn/v1'
    else if (req.provider === 'ollama') baseUrl = 'http://localhost:11434/v1'
    else baseUrl = 'https://api.openrouter.ai/api/v1'
  }
  // 确保以 /chat/completions 结尾
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions'
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (req.apiKey && req.apiKey.trim()) {
    headers['Authorization'] = 'Bearer ' + req.apiKey.trim()
  }
  if (req.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/Eoneanyna/mdEdit'
    headers['X-Title'] = 'mdEdit'
  }
  const body = {
    model: req.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    max_tokens: 2048
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API 错误 ${res.status}: ${text.slice(0, 200)}`)
  }
  const data: any = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('API 返回空内容')
  return content
}
