import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

export interface LocalSearchResult {
  path: string
  rel: string
  snippet: string
  score: number
}

async function walk(dir: string, workspace: string, keywords: string[], results: LocalSearchResult[], limit: number): Promise<void> {
  if (results.length >= limit * 3) return
  let entries: any[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (results.length >= limit * 3) break
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'out' || e.name === 'release') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      await walk(full, workspace, keywords, results, limit)
      continue
    }
    if (extname(e.name).toLowerCase() !== '.md') continue
    try {
      const text = await readFile(full, 'utf-8')
      const lower = text.toLowerCase()
      let score = 0
      for (const k of keywords) {
        if (!k) continue
        if (lower.includes(k)) score++
      }
      if (score === 0) continue
      const first = keywords.find((k) => k && lower.includes(k)) || keywords[0]
      const idx = first ? lower.indexOf(first) : 0
      const start = Math.max(0, idx - 100)
      const end = Math.min(text.length, idx + 200)
      let snippet = text.slice(start, end).replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
      if (start > 0) snippet = '... ' + snippet
      if (end < text.length) snippet = snippet + ' ...'
      const rel = relative(workspace, full).replace(/\\/g, '/')
      results.push({ path: full, rel, snippet, score })
    } catch {
      // skip unreadable files
    }
  }
}

export async function searchLocalMd(query: string, workspace: string, limit = 6): Promise<LocalSearchResult[]> {
  const keywords = query.toLowerCase().split(/\s+/).filter((k) => k.length > 1)
  if (keywords.length === 0) return []
  const results: LocalSearchResult[] = []
  await walk(workspace, workspace, keywords, results, limit)
  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}
