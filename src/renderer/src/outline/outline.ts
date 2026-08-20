interface OutlineItem {
  level: number
  text: string
  element: HTMLElement
  row: HTMLElement
}

/** 简易节流:滚动高亮不需要每帧都算 */
function throttle(fn: () => void, wait: number): () => void {
  let last = 0
  let timer: number | undefined
  return () => {
    const now = Date.now()
    const remaining = wait - (now - last)
    if (remaining <= 0) {
      last = now
      fn()
    } else if (timer === undefined) {
      timer = window.setTimeout(() => {
        last = Date.now()
        timer = undefined
        fn()
      }, remaining)
    }
  }
}

/**
 * 文档大纲。标题直接从编辑器渲染出的 DOM 中读取,
 * 这样无需另行解析 Markdown,也天然与所见即所得的结果一致。
 */
export class Outline {
  #items: OutlineItem[] = []
  #activeRow: HTMLElement | null = null
  #onScroll: () => void
  /** 点击跳转后的一小段时间内不让滚动同步覆盖用户的明确选择 */
  #suppressUntil = 0

  constructor(
    private readonly container: HTMLElement,
    private readonly scroller: HTMLElement
  ) {
    this.#onScroll = throttle(() => this.#syncActive(), 120)
    this.scroller.addEventListener('scroll', this.#onScroll, { passive: true })
  }

  /** 重新扫描标题并渲染 */
  refresh(): void {
    const headings = this.scroller.querySelectorAll<HTMLElement>(
      '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6'
    )

    this.container.innerHTML = ''
    this.#items = []
    this.#activeRow = null

    if (headings.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'outline__empty'
      empty.textContent = '当前文档没有标题'
      this.container.appendChild(empty)
      return
    }

    // 以文档中最小的标题级别作为缩进基准,避免整篇都是 h2 时无谓地缩进
    const levels = [...headings].map((h) => Number(h.tagName.slice(1)))
    const baseLevel = Math.min(...levels)

    const list = document.createElement('div')
    list.className = 'outline'

    headings.forEach((heading, index) => {
      const level = levels[index]!
      const text = heading.textContent?.trim() ?? ''

      const row = document.createElement('div')
      row.className = `outline__item outline__item--h${level}`
      row.style.paddingLeft = `${10 + (level - baseLevel) * 14}px`
      row.textContent = text || '(空标题)'
      row.title = text

      row.addEventListener('click', () => {
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
        this.#setActive(row)
        // 平滑滚动期间会连续触发 scroll,若不抑制会把高亮改回去
        this.#suppressUntil = Date.now() + 700
      })

      list.appendChild(row)
      this.#items.push({ level, text, element: heading, row })
    })

    this.container.appendChild(list)
    this.#syncActive()
  }

  /** 依据滚动位置高亮当前所处的标题 */
  #syncActive(): void {
    if (this.#items.length === 0) return
    if (Date.now() < this.#suppressUntil) return

    // 文末标题受限于底部留白往往无法滚到贴顶,滚到底时直接认定为最后一条,
    // 否则高亮会一直停在倒数第二个标题上。
    const { scrollTop, clientHeight, scrollHeight } = this.scroller
    if (scrollTop + clientHeight >= scrollHeight - 2) {
      this.#setActive(this.#items[this.#items.length - 1]!.row)
      return
    }

    const scrollerTop = this.scroller.getBoundingClientRect().top

    let current: OutlineItem | null = null
    for (const item of this.#items) {
      // 容差 8px,避免标题刚好贴顶时来回抖动
      if (item.element.getBoundingClientRect().top - scrollerTop <= 8) current = item
      else break
    }

    this.#setActive((current ?? this.#items[0]!).row)
  }

  #setActive(row: HTMLElement): void {
    if (this.#activeRow === row) return
    this.#activeRow?.classList.remove('is-active')
    row.classList.add('is-active')
    this.#activeRow = row
  }

  destroy(): void {
    this.scroller.removeEventListener('scroll', this.#onScroll)
  }
}
