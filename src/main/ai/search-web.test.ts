// @vitest-environment node
import { expect, it, vi, afterEach } from 'vitest'
import * as network from './public-page'
import { isPublicAddress, publicUrl } from './public-page'
import { extractWebText, parseSearchResults, relevantWebExcerpt, searchWeb, rankWebResults } from './search-web'

afterEach(() => vi.restoreAllMocks())
it('blocks loopback, private networks, mapped addresses and unsafe URLs', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.2', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fe80::1']) expect(isPublicAddress(ip), ip).toBe(false)
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPublicAddress(ip), ip).toBe(true)
  for (const url of ['file:///c:/a', 'http://localhost', 'http://0x7f000001', 'http://user:pass@example.com', 'http://example.com:8765', 'http://[::ffff:7f00:1]']) expect(() => publicUrl(url), url).toThrow()
})
it('parses real search result structures and rejects empty or private destinations', () => {
  const html = '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Frag">RAG</a><span class="result__snippet">定义</span></div>'
  expect(parseSearchResults(html)).toEqual([{ title: 'RAG', url: 'https://example.com/rag', description: '定义' }])
  expect(parseSearchResults('<rss><channel><item><title>定义</title><link>https://example.com/rag</link><description>RAG 定义</description></item><item><title>空</title></item></channel></rss>', true)).toHaveLength(1)
  expect(parseSearchResults('<div class="result"><a class="result__a" href="http://127.0.0.1">bad</a></div>')).toEqual([])
})
it('extracts article text without scripts or navigation and selects relevant long-page passage', () => {
  const body = 'Retrieval augmented generation combines document retrieval and model generation. '.repeat(8)
  const extracted = extractWebText('<html><head><title>RAG 定义</title></head><body><nav>秘密导航</nav><article><h1>RAG</h1><p>' + body + '</p><script>secret()</script></article></body></html>', 'https://example.com')
  expect(extracted?.text).toContain('Retrieval augmented')
  expect(extracted?.text).not.toContain('secret')
  expect(extracted?.text).not.toContain('秘密导航')
  expect(extractWebText('<html><body>验证码</body></html>', 'https://example.com')).toBeNull()
  expect(relevantWebExcerpt('无关内容'.repeat(3000) + '\nRAG retrieval augmented definition '.repeat(100), 'RAG retrieval', 1000)).toContain('RAG')
})
it('falls back between search engines and labels page text versus search summaries', async () => {
  vi.spyOn(network, 'downloadPublicPage').mockImplementation(async url => {
    if (url.includes('duckduckgo.com')) throw new Error('engine unavailable')
    if (url.includes('bing.com')) return { url, contentType: 'application/rss+xml', body: '<rss><channel><item><title>RAG 正文</title><link>https://example.com/full</link><description>摘要1</description></item><item><title>RAG 受限网页</title><link>https://example.com/blocked</link><description>仅搜索摘要</description></item></channel></rss>' }
    if (url.endsWith('/blocked')) throw new Error('403')
    return { url, contentType: 'text/html', body: '<html><body><article><h1>RAG 正文</h1><p>' + 'Retrieval augmented generation retrieves documents before generating an answer. '.repeat(8) + '</p></article></body></html>' }
  })
  const hits = await searchWeb('RAG 定义')
  expect(hits).toHaveLength(2)
  expect(hits[0].webKind).toBe('page'); expect(hits[0].description).toContain('retrieves documents')
  expect(hits[1].webKind).toBe('search-summary'); expect(hits[1].description).toBe('仅搜索摘要')
  expect(hits.every(hit => !!hit.retrievedAt)).toBe(true)
})
it('propagates cancellation instead of silently returning summaries', async () => {
  const abort = new AbortController(); abort.abort()
  vi.spyOn(network, 'downloadPublicPage').mockRejectedValue(new Error('aborted'))
  await expect(searchWeb('test', 3, abort.signal)).rejects.toThrow()
})
it('rejects dictionary results matching only the first word of a technical query', () => {
  expect(rankWebResults([{ title: 'retrieval dictionary', description: 'retrieve something', url: 'https://example.com' }], 'retrieval augmented generation RAG definition')).toEqual([])
})
