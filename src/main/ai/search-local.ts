import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

export interface LocalSearchResult {
  path: string
  rel: string
  snippet: string
  score: number
}

const EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt'])
const SKIP = new Set(['node_modules', 'dist', 'out', 'release', '__pycache__'])
const STOP = new Set(['什么', '怎么', '如何', '哪些', '是否', '这个', '那个', '一下', '请问', '可以', 'the', 'is', 'are', 'what', 'how'])

export function keywords(query: string): string[] {
  const tokens = query.toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]+/g) || []
  return [...new Set(tokens.flatMap((t) => /^[\u4e00-\u9fff]+$/.test(t) && t.length > 2
    ? [t, ...Array.from({ length: t.length - 1 }, (_, i) => t.slice(i, i + 2))]
    : [t]).filter((t) => t.length > 1 && !STOP.has(t)))]
}

/** 无服务也可用的中英文分块检索。每次读磁盘，保证保存后的内容可立即检索。 */
export async function searchLocalMd(query: string, workspace: string, limit = 6, signal?: AbortSignal): Promise<LocalSearchResult[]> {
  const terms = keywords(query)
  if (!terms.length) return []
  const results: LocalSearchResult[] = []
  async function walk(dir: string): Promise<void> {
    signal?.throwIfAborted()
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { await walk(path); continue }
      if (!entry.isFile() || !EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
      try {
        if ((await stat(path)).size > 2_000_000) continue
        const text = await readFile(path, 'utf8')
        const rel = relative(workspace, path).replace(/\\/g, '/')
        for (let start = 0; start < text.length; start += 1200) {
          const snippet = text.slice(start, start + 1400)
          const lower = snippet.toLowerCase()
          const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0) + (rel.toLowerCase().includes(term) ? 0.5 : 0), 0)
          if (score > 0) results.push({ path, rel, snippet, score })
        }
      } catch { /* 文件在扫描时删除或不可读，继续检索。 */ }
    }
  }
  await walk(workspace)
  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}
