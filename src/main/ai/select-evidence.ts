import type { AiSource } from '@shared/ipc'
import { keywords } from './search-local'

/** 对候选资料排序、去重并保留两类依据；不把词面排序误当成事实验证。 */
export function selectEvidence(candidates: AiSource[], query: string): AiSource[] {
  const terms = keywords(query)
  const seen = new Set<string>()
  const ranked = candidates.map((source, index) => {
    const body = (source.title + '\n' + source.snippet).toLowerCase()
    const score = terms.filter(term => body.includes(term)).length / Math.max(1, terms.length)
    return { source, index, score }
  }).sort((a, b) => b.score - a.score || a.index - b.index).filter(({ source }) => {
    const identity = source.type === 'web' ? canonicalUrl(source.url || '') : source.type + ':' + source.path + ':' + source.snippet.trim()
    if (seen.has(identity)) return false
    seen.add(identity); return true
  })
  const local = ranked.filter(item => item.source.type !== 'web')
  const web = ranked.filter(item => item.source.type === 'web').slice(0, 3)
  const selected = [...local.slice(0, 8 - web.length), ...web]
  // 来源编号仅在最终筛选后分配，文档在前，网页在后，避免过滤产生空号。
  return selected.map(({ source }, index) => ({ ...source, id: index + 1 }))
}
function canonicalUrl(input: string): string {
  try {
    const url = new URL(input); url.hash = ''
    for (const name of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(name)) url.searchParams.delete(name)
    return url.href
  } catch { return input }
}
