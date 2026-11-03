export interface WebSearchResult {
  title: string
  url: string
  description: string
}

export async function searchWeb(query: string, limit = 4, signal?: AbortSignal): Promise<WebSearchResult[]> {
  try {
    // 使用 DuckDuckGo HTML 搜索（无需 API key）
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query)
    const res = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    if (!res.ok) return []
    const html = await res.text()
    const results: WebSearchResult[] = []
    // 简单正则提取（够用）
    const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]+?)<\/a>/g
    const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]+?)<\/a>/g
    const links: Array<{ href: string, title: string }> = []
    let m
    while ((m = linkRegex.exec(html)) && links.length < limit) {
      let href = m[1]
      // DuckDuckGo 重定向
      if (href.includes('uddg=')) {
        try {
          const u = new URL(href, 'https://duckduckgo.com')
          href = u.searchParams.get('uddg') || href
        } catch {}
      }
      const title = m[2].replace(/<[^>]+>/g, '').trim()
      if (href && title) links.push({ href, title })
    }
    let i = 0
    while ((m = snippetRegex.exec(html)) && results.length < limit && i < links.length) {
      const desc = m[1].replace(/<[^>]+>/g, '').trim()
      results.push({ title: links[i].title, url: links[i].href, description: desc })
      i++
    }
    // 如果没匹配到 snippet，用空描述也行
    if (results.length === 0 && links.length > 0) {
      for (let j = 0; j < links.length && results.length < limit; j++) {
        results.push({ title: links[j].title, url: links[j].href, description: '' })
      }
    }
    return results
  } catch {
    signal?.throwIfAborted()
    return []
  }
}
