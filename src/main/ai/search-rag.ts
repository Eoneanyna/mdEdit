import type { LocalSearchResult } from './search-local'

/** 本地 RAG 服务地址,见 rag-service/README.md */
const RAG_BASE_URL = 'http://127.0.0.1:8765'

/** 上次成功建索引的工作区,workspace 不变则跳过 /index */
let indexedWorkspace: string | null = null

async function postJson<T>(path: string, body: unknown, timeoutMs: number): Promise<T | null> {
  try {
    const res = await fetch(RAG_BASE_URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

interface RagSearchResponse {
  ok: boolean
  error?: string
  results: Array<{ path: string; rel: string; title: string; snippet: string; score: number }>
}

/**
 * 调用 RAG 服务检索。服务不可用/未建索引/无结果时返回 null,
 * 由调用方回退到内置关键词搜索。
 */
export async function ragSearch(query: string, workspace: string, limit = 6): Promise<LocalSearchResult[] | null> {
  if (indexedWorkspace !== workspace) {
    const indexed = await postJson<{ ok: boolean; chunks: number }>('/index', { workspace }, 30_000)
    if (!indexed?.ok) return null
    indexedWorkspace = workspace
  }

  const data = await postJson<RagSearchResponse>('/search', { query, top_k: limit }, 10_000)
  if (!data?.ok || !Array.isArray(data.results)) {
    // 索引状态可能被服务端重置,下次重新提交
    indexedWorkspace = null
    return null
  }

  return data.results.map((r) => ({
    path: r.path,
    rel: r.title ? `${r.rel} · ${r.title}` : r.rel,
    snippet: r.snippet,
    score: r.score
  }))
}
