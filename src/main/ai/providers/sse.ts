/** 解析 Chat Completions SSE，兼容 UTF-8 分包、CRLF、注释和 usage 帧。 */
export async function readCompletionStream(response: Response, onDelta: (text: string) => void): Promise<string> {
  if (!response.body) throw new Error('模型未返回响应流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let dataLines: string[] = []
  let answer = ''
  let finished = false
  let doneEvent = false
  function dispatch(): void {
    if (!dataLines.length) return
    const payload = dataLines.join('\n')
    dataLines = []
    if (payload === '[DONE]') { finished = true; doneEvent = true; return }
    let data: { error?: unknown; choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string | null }> }
    try { data = JSON.parse(payload) } catch { throw new Error('模型响应流格式无效，请重试') }
    const choice = data.choices?.[0]
    if (data.error || choice?.finish_reason === 'error') throw new Error('模型生成中断，请重试')
    const text = choice?.delta?.content
    if (typeof text === 'string' && text) { answer += text; onDelta(text) }
    if (choice?.finish_reason === 'length') throw new Error('回答达到模型长度限制，请缩小问题后重试')
    if (choice?.finish_reason === 'stop') finished = true
  }
  function line(value: string): void {
    if (!value) { dispatch(); return }
    if (value.startsWith('data:')) dataLines.push(value.slice(5).replace(/^ /, ''))
  }
  try {
    while (!doneEvent) {
      const { value, done } = await reader.read()
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = pending.indexOf('\n')) !== -1) {
        line(pending.slice(0, newline).replace(/\r$/, ''))
        pending = pending.slice(newline + 1)
        if (doneEvent) break
      }
      if (done) { if (pending) line(pending.replace(/\r$/, '')); dispatch(); break }
      if (pending.length > 1_000_000) throw new Error('模型响应流数据过大')
    }
    if (!finished) throw new Error('模型连接提前断开，回答尚未完成')
    if (!answer.trim()) throw new Error('模型返回空内容，请重试或更换模型')
    return answer.trim()
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
