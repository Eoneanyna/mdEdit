export interface DocumentChunk {
  snippet: string
  heading?: string
  startLine: number
  endLine: number
}

export function chunkDocument(input: string, size = 1400, overlap = 200): DocumentChunk[] {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const headings: Array<{ offset: number; title: string }> = []
  const stack: string[] = []
  let offset = 0
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
    } else if (!fence) {
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
      if (match) {
        stack.length = Math.min(stack.length, match[1].length - 1)
        while (stack.length < match[1].length - 1) stack.push('')
        stack.push(match[2])
        headings.push({ offset, title: stack.filter(Boolean).join(' > ') })
      }
    }
    offset += line.length + 1
  }
  const chunks: DocumentChunk[] = []
  for (let start = 0; start < text.length; start += size - overlap) {
    const snippet = text.slice(start, start + size)
    if (!snippet.trim()) continue
    chunks.push({ snippet, heading: headings.filter(h => h.offset <= start).at(-1)?.title,
      startLine: text.slice(0, start).split('\n').length,
      endLine: text.slice(0, start + snippet.length - 1).split('\n').length })
    if (start + size >= text.length) break
  }
  return chunks
}
