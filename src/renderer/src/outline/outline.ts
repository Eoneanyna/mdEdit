import { moveSection, parseSections, type Section } from './sections'

interface OutlineItem {
  level: number
  text: string
  element: HTMLElement
  row: HTMLElement
}

export interface OutlineOptions {
  /** 取当前文档的 Markdown 源码,用于把标题映射成「节」 */
  getMarkdown: () => string
  /** 应用重排后的源码;由外层交给编辑器,以触发保存与脏标记 */
  applyMarkdown: (markdown: string) => void
  notify?: (message: string) => void
}

type Placement = 'before' | 'after'

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
 *
 * 拖动时按 Markdown 源码里的「节」整体搬运:一个标题连同它下面所有
 * 更深级别的标题与正文一起移动,标题级别保持不变。
 */
export class Outline {
  #items: OutlineItem[] = []
  #sections: Section[] = []
  #activeRow: HTMLElement | null = null
  #onScroll: () => void
  /** 点击跳转后的一小段时间内不让滚动同步覆盖用户的明确选择 */
  #suppressUntil = 0
  #dragIndex: number | null = null

  constructor(
    private readonly container: HTMLElement,
    private readonly scroller: HTMLElement,
    private readonly options: OutlineOptions
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
      this.#sections = []
      return
    }

    const markdown = this.options.getMarkdown()
    const sections = parseSections(markdown)
    // DOM 标题与源码标题数量不吻合时(例如手写 HTML 标题)不开放拖动,
    // 避免按错位下标移动内容。点击跳转仍可用。
    const canDrag = sections.length === headings.length
    this.#sections = canDrag ? sections : []

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
      row.title = canDrag ? `${text}\n拖动可连同下级标题与正文一起移动` : text

      row.addEventListener('click', () => {
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
        this.#setActive(row)
        // 平滑滚动期间会连续触发 scroll,若不抑制会把高亮改回去
        this.#suppressUntil = Date.now() + 700
      })

      if (canDrag) this.#makeDraggable(row, index)

      list.appendChild(row)
      this.#items.push({ level, text, element: heading, row })
    })

    this.container.appendChild(list)
    this.#syncActive()
  }

  #makeDraggable(row: HTMLElement, index: number): void {
    row.draggable = true

    row.addEventListener('dragstart', (event) => {
      this.#dragIndex = index
      row.classList.add('is-dragging')
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', row.textContent ?? '')
      }
    })

    row.addEventListener('dragover', (event) => {
      if (this.#dragIndex === null) return
      event.preventDefault()
      const target = event.currentTarget as HTMLElement
      const rect = target.getBoundingClientRect()
      const placement: Placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      this.#paintDrop(target, placement)
    })

    row.addEventListener('dragleave', (event) => {
      const target = event.currentTarget as HTMLElement
      const next = event.relatedTarget
      if (next instanceof Node && target.contains(next)) return
      target.classList.remove('is-drop-before', 'is-drop-after')
    })

    row.addEventListener('drop', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const from = this.#dragIndex
      const target = event.currentTarget as HTMLElement
      const rect = target.getBoundingClientRect()
      const placement: Placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      this.#endDrag()
      if (from === null) return
      this.#move(from, index, placement)
    })

    row.addEventListener('dragend', () => this.#endDrag())
  }

  #paintDrop(row: HTMLElement, placement: Placement): void {
    for (const item of this.#items) {
      item.row.classList.remove('is-drop-before', 'is-drop-after')
    }
    row.classList.add(placement === 'before' ? 'is-drop-before' : 'is-drop-after')
  }

  #endDrag(): void {
    this.#dragIndex = null
    for (const item of this.#items) {
      item.row.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after')
    }
  }

  /** 目标落在自身节内(即自己的子标题)时拒绝,避免把内容拖进自己 */
  #isInsideSource(sourceIndex: number, targetIndex: number): boolean {
    const source = this.#sections[sourceIndex]
    const target = this.#sections[targetIndex]
    if (!source || !target) return true
    return targetIndex === sourceIndex ||
      (target.line >= source.line && target.line < source.endLine)
  }

  #move(from: number, to: number, placement: Placement): void {
    if (this.#isInsideSource(from, to)) {
      this.options.notify?.('不能把标题拖进它自己的子章节里')
      return
    }

    const markdown = this.options.getMarkdown()
    const next = moveSection(markdown, from, to, placement)
    if (next === markdown) return

    // 整篇替换会重建 DOM,先记住滚动位置再还原,避免视野跳回顶部
    const scrollTop = this.scroller.scrollTop
    this.options.applyMarkdown(next)
    requestAnimationFrame(() => {
      this.scroller.scrollTop = scrollTop
      this.refresh()
    })
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
