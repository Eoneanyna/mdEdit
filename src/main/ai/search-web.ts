import { parseHTML, DOMParser } from 'linkedom'
import { Readability } from '@mozilla/readability'
import { downloadPublicPage, publicUrl } from './public-page'
import { keywords } from './search-local'

export interface WebSearchResult {
  title: string
  url: string
  description: string
  webKind?: 'page' | 'search-summary'
  retrievedAt?: string
}

export function extractWebText(html: string, url: string): { title: string; text: string } | null {
  const { document } = parseHTML(html)
  for (const element of document.querySelectorAll('script,style,noscript,iframe,form,nav,footer,header')) element.remove()
  const article = new Readability(document as unknown as Document, { charThreshold: 100 }).parse()
  const text = (article?.textContent || document.querySelector('main,article')?.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim()
  if (text.length < 80) return null
  return { title: article?.title || document.title || new URL(url).hostname, text }
}
export function relevantWebExcerpt(text: string, query: string, limit = 3500): string {
  if (text.length <= limit) return text
  const terms = keywords(query)
  let best = 0, score = -1
  for (let start = 0; start < text.length; start += 1000) {
    const window = text.slice(start, start + limit).toLowerCase()
    const overlap = terms.filter(term => window.includes(term)).length
    if (overlap > score) { score = overlap; best = start }
  }
  return (best ? '…\n' : '') + text.slice(best, best + limit) + (best + limit < text.length ? '\n…' : '')
}
function normalizeResultUrl(value: string): string | null {
  if (!value.trim()) return null
  try {
    let url = new URL(value, 'https://duckduckgo.com')
    if (url.searchParams.has('uddg')) url = new URL(url.searchParams.get('uddg')!)
    return publicUrl(url.href).href
  } catch { return null }
}
export function parseSearchResults(html: string, rss = false): WebSearchResult[] {
  const results: WebSearchResult[] = []
  if (rss) {
    const document = new DOMParser().parseFromString(html, 'text/xml')
    for (const item of document.querySelectorAll('item')) {
      const url = normalizeResultUrl(item.querySelector('link')?.textContent || '')
      if (url) results.push({ title: item.querySelector('title')?.textContent || url, url, description: item.querySelector('description')?.textContent || '' })
    }
  } else {
    const { document } = parseHTML(html)
    for (const item of document.querySelectorAll('.result')) {
      const link = item.querySelector('a.result__a')
      const url = normalizeResultUrl(link?.getAttribute('href') || '')
      if (url && link) results.push({ title: link.textContent || url, url, description: item.querySelector('.result__snippet')?.textContent || '' })
    }
  }
  return [...new Map(results.map(result => [result.url, result])).values()]
}
/** 过滤只碰巧命中一个普通词的结果；这只是词面相关性，不代替事实核对。 */
export function rankWebResults(results: WebSearchResult[], query: string): WebSearchResult[] {
  const generic = new Set(['定义', '概念', '解释', '介绍', '的定义', '的定', '是什么', '什么是', 'definition', 'define', 'explain', 'please'])
  const terms = keywords(query).filter(term => !generic.has(term))
  if (!terms.length) return results
  const minimum = Math.min(2, terms.length)
  return results.map(result => ({ result, score: terms.filter(term => (result.title + ' ' + result.description).toLowerCase().includes(term)).length }))
    .filter(item => item.score >= minimum).sort((a, b) => b.score - a.score).map(item => item.result)
}
export async function searchWeb(query: string, limit = 4, signal?: AbortSignal): Promise<WebSearchResult[]> {
  let results: WebSearchResult[] = []
  for (const engine of [
    { url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), rss: false },
    { url: 'https://www.bing.com/search?format=rss&mkt=en-US&setlang=en&q=' + encodeURIComponent(query), rss: true }
  ]) {
    try {
      const page = await downloadPublicPage(engine.url, signal)
      results = rankWebResults(parseSearchResults(page.body, engine.rss), query).slice(0, Math.min(limit, 3))
      if (results.length) break
    } catch { signal?.throwIfAborted() }
  }
  return await Promise.all(results.map(async result => {
    try {
      const page = await downloadPublicPage(result.url, signal)
      const extracted = page.contentType.includes('text/plain') ? { title: result.title, text: page.body } : extractWebText(page.body, page.url)
      if (extracted) return { title: extracted.title, url: page.url, description: relevantWebExcerpt(extracted.text, query),
        webKind: 'page' as const, retrievedAt: new Date().toISOString() }
    } catch { signal?.throwIfAborted() }
    return { ...result, webKind: 'search-summary' as const, retrievedAt: new Date().toISOString() }
  }))
}
