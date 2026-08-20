export interface PopupItem {
  /** 传 'divider' 表示分隔线,其余字段忽略 */
  kind?: 'item' | 'divider'
  label?: string
  /** 次要说明,显示在标签下方 */
  hint?: string
  /** 勾选态。undefined 表示该项不是勾选项 */
  checked?: boolean
  /** 点击后是否保留菜单(多选场景需要) */
  keepOpen?: boolean
  action?: () => void | Promise<void>
}

export const DIVIDER: PopupItem = { kind: 'divider' }

/** 锚点可以是元素(贴其下方),也可以是鼠标坐标(用于右键菜单) */
export type PopupAnchor = HTMLElement | { x: number; y: number }

let current: { element: HTMLElement; anchor: PopupAnchor; getItems: () => PopupItem[] } | null =
  null

function onOutside(event: MouseEvent): void {
  if (current && !current.element.contains(event.target as Node)) dismissPopup()
}

function onEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') dismissPopup()
}

export function dismissPopup(): void {
  current?.element.remove()
  current = null
  document.removeEventListener('mousedown', onOutside, true)
  document.removeEventListener('keydown', onEscape, true)
}

function build(getItems: () => PopupItem[]): HTMLElement {
  const menu = document.createElement('div')
  menu.className = 'popup'

  for (const item of getItems()) {
    if (item.kind === 'divider') {
      const divider = document.createElement('div')
      divider.className = 'popup__divider'
      menu.appendChild(divider)
      continue
    }

    const button = document.createElement('button')
    button.className = 'popup__item'
    button.type = 'button'

    // 勾选项统一留出前置标记的位置,避免有勾无勾时文字左右跳动
    if (item.checked !== undefined) {
      const mark = document.createElement('span')
      mark.className = 'popup__check'
      mark.textContent = item.checked ? '✓' : ''
      button.appendChild(mark)
    }

    const body = document.createElement('span')
    body.className = 'popup__body'

    const label = document.createElement('span')
    label.className = 'popup__label'
    label.textContent = item.label ?? ''
    body.appendChild(label)

    if (item.hint) {
      const hint = document.createElement('span')
      hint.className = 'popup__hint'
      hint.textContent = item.hint
      body.appendChild(hint)
    }

    button.appendChild(body)

    button.addEventListener('click', () => {
      if (item.keepOpen) {
        void item.action?.()
        // 重新渲染以反映新的勾选态
        if (current) {
          const next = build(current.getItems)
          current.element.replaceWith(next)
          current.element = next
          place(next, current.anchor)
        }
        return
      }
      dismissPopup()
      void item.action?.()
    })

    menu.appendChild(button)
  }

  return menu
}

/** 贴着触发元素或鼠标位置显示,超出视口时向上翻转 */
function place(menu: HTMLElement, anchor: PopupAnchor): void {
  const menuRect = menu.getBoundingClientRect()

  // 鼠标坐标锚点:菜单出现在光标右下,空间不足则向上/向左翻
  if (!(anchor instanceof HTMLElement)) {
    const top =
      anchor.y + menuRect.height > window.innerHeight
        ? Math.max(4, anchor.y - menuRect.height)
        : anchor.y
    menu.style.top = `${top}px`
    menu.style.left = `${Math.min(anchor.x, window.innerWidth - menuRect.width - 8)}px`
    return
  }

  const rect = anchor.getBoundingClientRect()
  const top =
    rect.bottom + menuRect.height > window.innerHeight
      ? Math.max(4, rect.top - menuRect.height)
      : rect.bottom + 2
  menu.style.top = `${top}px`
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menuRect.width - 8)}px`
}

/**
 * 显示一个浮层菜单。传入工厂函数而非静态数组,
 * 这样 keepOpen 的项被点击后能重新取到最新的勾选态。
 */
export function showPopup(anchor: PopupAnchor, getItems: () => PopupItem[]): void {
  dismissPopup()

  const menu = build(getItems)
  document.body.appendChild(menu)
  place(menu, anchor)

  current = { element: menu, anchor, getItems }
  document.addEventListener('mousedown', onOutside, true)
  document.addEventListener('keydown', onEscape, true)
}
