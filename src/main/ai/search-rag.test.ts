import { afterEach, expect, it, vi } from 'vitest'
import { ragSearch } from './search-rag'
afterEach(() => vi.unstubAllGlobals())
it('checks index freshness on every turn and sends the workspace with search', async () => {
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/index')
    ? { ok: true, protocol: 2 }
    : { ok: true, results: [{ path: '/docs/a.md', rel: 'a.md', title: '节', snippet: '证据', score: 1 }] })))
  vi.stubGlobal('fetch', fetcher)
  await ragSearch('问题', '/docs')
  await ragSearch('追问', '/docs')
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/index'))).toHaveLength(2)
  const searchCall = (fetcher.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url.endsWith('/search'))!
  expect(JSON.parse(searchCall[1].body as string).workspace).toBe('/docs')
})
it('rejects old services and falls back when new service has no results', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))))
  expect(await ragSearch('问题', '/docs')).toBeNull()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/index')
    ? { ok: true, protocol: 2 } : { ok: true, results: [] }))))
  expect(await ragSearch('问题', '/docs')).toBeNull()
})
