import type { EditorSearch } from '../editor/editor'

export interface SearchBarHandle {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

/** 输入后延迟多久才真正检索,避免每敲一个字就全文扫描 */
const TYPING_DELAY = 150

export function createSearchBar(
  container: HTMLElement,
  search: EditorSearch,
  onAfterReplace: () => void
): SearchBarHandle {
  const bar = document.createElement('div')
  bar.className = 'search-bar'
  bar.hidden = true
  bar.innerHTML = `
    <div class="search-bar__row">
      <input class="search-bar__input" type="text" placeholder="查找" data-role="query" />
      <span class="search-bar__count" data-role="count">0/0</span>
      <button class="search-bar__btn" type="button" data-act="prev" title="上一个 (Shift+Enter)">↑</button>
      <button class="search-bar__btn" type="button" data-act="next" title="下一个 (Enter)">↓</button>
      <button class="search-bar__btn" type="button" data-act="close" title="关闭 (Esc)">✕</button>
    </div>
    <div class="search-bar__row">
      <input class="search-bar__input" type="text" placeholder="替换为" data-role="replace" />
      <button class="search-bar__btn search-bar__btn--text" type="button" data-act="replace">替换</button>
      <button class="search-bar__btn search-bar__btn--text" type="button" data-act="replace-all">全部</button>
    </div>
  `
  container.appendChild(bar)

  const queryInput = bar.querySelector<HTMLInputElement>('[data-role="query"]')!
  const replaceInput = bar.querySelector<HTMLInputElement>('[data-role="replace"]')!
  const countEl = bar.querySelector<HTMLElement>('[data-role="count"]')!

  function renderCount(total: number, index: number): void {
    countEl.textContent = `${index}/${total}`
    countEl.classList.toggle('is-empty', total === 0 && queryInput.value !== '')
  }

  let typingTimer: number | undefined
  function runQuery(): void {
    const { total, index } = search.setQuery(queryInput.value)
    renderCount(total, index)
  }

  queryInput.addEventListener('input', () => {
    window.clearTimeout(typingTimer)
    typingTimer = window.setTimeout(runQuery, TYPING_DELAY)
  })

  queryInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    // 输入后立即回车时,防抖可能还没跑,先补一次检索
    window.clearTimeout(typingTimer)
    const snapshot = event.shiftKey ? search.prev() : search.next()
    renderCount(snapshot.total, snapshot.index)
  })

  bar.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  })

  bar.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
    if (!action) return

    if (action === 'close') {
      close()
      return
    }
    if (action === 'prev' || action === 'next') {
      const snapshot = action === 'next' ? search.next() : search.prev()
      renderCount(snapshot.total, snapshot.index)
      return
    }
    if (action === 'replace') {
      const snapshot = search.replaceCurrent(replaceInput.value)
      renderCount(snapshot.total, snapshot.index)
      onAfterReplace()
      return
    }
    if (action === 'replace-all') {
      search.replaceAll(replaceInput.value)
      // 全部替换后原查询通常已无匹配,重新检索以刷新计数
      runQuery()
      onAfterReplace()
    }
  })

  function open(): void {
    bar.hidden = false
    queryInput.focus()
    queryInput.select()
    if (queryInput.value) runQuery()
  }

  function close(): void {
    bar.hidden = true
    window.clearTimeout(typingTimer)
    search.clear()
  }

  return { open, close, isOpen: () => !bar.hidden }
}
