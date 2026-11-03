import type { LocalSearchResult } from './search-local'
import type { RagStatus } from '@shared/ipc'

const RAG_BASE_URL = process.env.MDEDIT_RAG_URL || 'http://127.0.0.1:8765'

export async function getRagStatus(): Promise<RagStatus> {
  const empty: RagStatus = { available: false, compatible: false, indexed: false, chunks: 0,
    embedder: null, workspace: null, building: false, phase: 'offline', completed: 0, total: 0, error: null }
  try {
    const response = await fetch(RAG_BASE_URL + '/health', { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return { ...empty, error: '本地检索服务返回错误，将使用内置关键词检索' }
    const data = await response.json() as Record<string, unknown>
    if (data.ok !== true) return { ...empty, error: '本地检索服务响应无效' }
    return { available: true, compatible: data.protocol === 2, indexed: data.indexed === true,
      chunks: typeof data.chunks === 'number' ? data.chunks : 0,
      embedder: typeof data.embedder === 'string' ? data.embedder : null,
      workspace: typeof data.workspace === 'string' ? data.workspace : null,
      building: data.building === true, phase: typeof data.phase === 'string' ? data.phase : 'idle',
      completed: typeof data.completed === 'number' ? data.completed : 0,
      total: typeof data.total === 'number' ? data.total : 0,
      error: typeof data.error === 'string' ? data.error : null }
  } catch { return { ...empty, error: '本地检索服务未连接，将使用内置关键词检索' } }
}

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
  results: Array<{ path: string; rel: string; title: string; snippet: string; score: number; start_line?: number; end_line?: number }>
}

/** 每次查询交给服务端核对文件指纹；服务不可用或无结果时返回 null。 */
export async function ragSearch(query: string, workspace: string, limit = 6, signal?: AbortSignal): Promise<LocalSearchResult[] | null> {
  const indexed = await postJson<{ ok: boolean; protocol?: number }>('/index', { workspace }, 30_000, signal)
  // 旧服务不检测文件变化，不能继续使用可能过期的索引。
  if (!indexed?.ok || indexed.protocol !== 2) return null
  const data = await postJson<RagSearchResponse>('/search', { query, workspace, top_k: limit }, 10_000, signal)
  if (!data?.ok || !Array.isArray(data.results) || !data.results.length) return null
  return data.results.map((r) => ({
    path: r.path, rel: r.rel, heading: r.title,
    startLine: r.start_line, endLine: r.end_line,
    snippet: r.snippet, score: r.score
  }))
}
