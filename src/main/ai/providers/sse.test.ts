// @vitest-environment node
import { expect, it } from 'vitest'
import { readCompletionStream } from './sse'

function response(text: string, size = 1): Response {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size))
      controller.close()
    }
  }), { headers: { 'content-type': 'text/event-stream' } })
}
it('decodes Chinese split across packets, comments, CRLF and usage frames', async () => {
  const chunks: string[] = []
  const stream = ': processing\r\n\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\n' +
    'data: {"choices":[{"delta":{"content":"世界"},"finish_reason":"stop"}]}\n\n' +
    'data: {"choices":[],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n'
  expect(await readCompletionStream(response(stream), value => chunks.push(value))).toBe('你好世界')
  expect(chunks).toEqual(['你好', '世界'])
})
it('keeps emitted content but rejects prematurely disconnected streams', async () => {
  const chunks: string[] = []
  await expect(readCompletionStream(response('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n'), v => chunks.push(v))).rejects.toThrow('提前断开')
  expect(chunks).toEqual(['部分'])
})
it('does not echo upstream errors and rejects length-limited responses', async () => {
  await expect(readCompletionStream(response('data: {"error":{"message":"secret"},"choices":[]}\n\n'), () => {})).rejects.toThrow('生成中断')
  await expect(readCompletionStream(response('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n'), () => {})).rejects.toThrow('长度限制')
})
it('handles multiline data and a final frame without a trailing newline', async () => {
  const stream = 'data: {"choices":\ndata: [{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\ndata: [DONE]'
  expect(await readCompletionStream(response(stream, 20), () => {})).toBe('完成')
})
