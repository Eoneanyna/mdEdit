import type { LocalSearchResult } from './search-local'

const RAG_BASE_URL = process.env.MDEDIT_RAG_URL || 'http://127.0.0.1:8765'

async function postJson<T>(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(RAG_BASE_URL + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    signal?.throwIfAborted()
    return null
  }
}

interface RagSearchResponse {
  ok: boolean
  results: Array<{ path: string; rel: string; title: string; snippet: string; score: number }>
}

/** 每次查询交给服务端核对文件指纹；服务不可用或无结果时返回 null。 */
export async function ragSearch(query: string, workspace: string, limit = 6, signal?: AbortSignal): Promise<LocalSearchResult[] | null> {
  const indexed = await postJson<{ ok: boolean; protocol?: number }>('/index', { workspace }, 30_000, signal)
  // 旧服务不检测文件变化，不能继续使用可能过期的索引。
  if (!indexed?.ok || indexed.protocol !== 2) return null
  const data = await postJson<RagSearchResponse>('/search', { query, workspace, top_k: limit }, 10_000, signal)
  if (!data?.ok || !Array.isArray(data.results) || !data.results.length) return null
  return data.results.map((r) => ({
    path: r.path, rel: r.title ? `${r.rel} · ${r.title}` : r.rel,
    snippet: r.snippet, score: r.score
  }))
}
