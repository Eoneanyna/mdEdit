import { type FileEntry, type FileKind, isEditableKind } from '@shared/ipc'

interface TreeNode {
  entry: FileEntry
  /** null 表示尚未加载,展开时才去读 */
  children: TreeNode[] | null
  expanded: boolean
}

export interface FileTreeCallbacks {
  /** 点击可在应用内编辑的文件 */
  onOpenEditable: (entry: FileEntry) => void
  /** 点击只能交给外部程序的文件,anchor 用于定位弹出菜单 */
  onOpenExternal: (entry: FileEntry, anchor: HTMLElement) => void
  /** 右键。entry 为 null 表示点在树的空白处 */
  onContextMenu: (entry: FileEntry | null, point: { x: number; y: number }) => void
  onError: (message: string) => void
}

/** 渲染进程没有 path 模块,按分隔符取末段即可 */
function baseName(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? fullPath
}

const ICON_TEXT: Record<FileKind, string> = {
  markdown: 'M',
  text: 'T',
  word: 'W',
  excel: 'X'
}

/**
 * 左侧常驻文件树。子目录按需加载,避免打开大目录时一次性递归扫描。
 */
export class FileTree {
  #rootNode: TreeNode | null = null
  #activePath: string | null = null
  #rows = new Map<string, HTMLElement>()
  /** null 表示不过滤 */
  #filter: Set<FileKind> | null = null

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: FileTreeCallbacks
  ) {
    // 空白处右键。落在某一行上的右键由该行自己处理并阻止冒泡
    this.container.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      this.callbacks.onContextMenu(null, { x: event.clientX, y: event.clientY })
    })
  }

  get rootPath(): string | null {
    return this.#rootNode?.entry.path ?? null
  }

  async setRoot(dirPath: string): Promise<void> {
    const children = await this.#loadChildren(dirPath)
    this.#rootNode = {
      entry: { name: baseName(dirPath), path: dirPath, isDirectory: true, kind: null },
      children,
      expanded: true
    }
    this.#render()
  }

  /** 设置类型筛选,传 null 表示显示全部 */
  setFilter(kinds: Set<FileKind> | null): void {
    this.#filter = kinds && kinds.size > 0 ? kinds : null
    this.#render()
  }

  /**
   * 目录一律显示 —— 子项按需加载,无法预先知道里面是否有匹配的文件,
   * 贸然隐藏会让用户找不到尚未展开的内容。
   */
  #matchesFilter(entry: FileEntry): boolean {
    if (entry.isDirectory) return true
    if (!this.#filter) return true
    return entry.kind !== null && this.#filter.has(entry.kind)
  }

  /** 高亮当前正在编辑的文件 */
  setActive(path: string | null): void {
    this.#activePath = path
    for (const [rowPath, element] of this.#rows) {
      element.classList.toggle('is-active', rowPath === path)
    }
  }

  /** 重新读取整棵树,保留已展开的目录 */
  async refresh(): Promise<void> {
    if (!this.#rootNode) return
    const expanded = new Set<string>()
    const collect = (node: TreeNode): void => {
      if (node.expanded) expanded.add(node.entry.path)
      for (const child of node.children ?? []) collect(child)
    }
    collect(this.#rootNode)

    const rebuild = async (dirPath: string): Promise<TreeNode[]> => {
      const nodes = await this.#loadChildren(dirPath)
      for (const node of nodes) {
        if (node.entry.isDirectory && expanded.has(node.entry.path)) {
          node.expanded = true
          node.children = await rebuild(node.entry.path)
        }
      }
      return nodes
    }

    this.#rootNode.children = await rebuild(this.#rootNode.entry.path)
    this.#render()
  }

  async #loadChildren(dirPath: string): Promise<TreeNode[]> {
    const result = await window.api.readDir(dirPath)
    if (!result.ok) {
      this.callbacks.onError(`读取目录失败:${result.error}`)
      return []
    }
    return result.value.map((entry) => ({ entry, children: null, expanded: false }))
  }

  async #toggle(node: TreeNode): Promise<void> {
    node.expanded = !node.expanded
    if (node.expanded && node.children === null) {
      node.children = await this.#loadChildren(node.entry.path)
    }
    this.#render()
  }

  #render(): void {
    const scrollTop = this.container.scrollTop
    this.container.innerHTML = ''
    this.#rows.clear()

    if (!this.#rootNode) return
    const visible = (this.#rootNode.children ?? []).filter((child) =>
      this.#matchesFilter(child.entry)
    )

    if (visible.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'tree__empty'
      empty.textContent = this.#filter ? '没有符合筛选条件的文件' : '此文件夹为空'
      this.container.appendChild(empty)
      return
    }

    const list = document.createElement('ul')
    list.className = 'tree'
    for (const child of visible) {
      list.appendChild(this.#renderNode(child, 0))
    }
    this.container.appendChild(list)
    this.container.scrollTop = scrollTop
  }

  #renderNode(node: TreeNode, depth: number): HTMLElement {
    const item = document.createElement('li')
    item.className = 'tree__item'

    const row = document.createElement('div')
    row.className = 'tree__row'
    row.style.paddingLeft = `${6 + depth * 14}px`
    row.title = node.entry.path
    if (node.entry.path === this.#activePath) row.classList.add('is-active')

    const arrow = document.createElement('span')
    arrow.className = 'tree__arrow'
    arrow.textContent = node.entry.isDirectory ? (node.expanded ? '▾' : '▸') : ''
    row.appendChild(arrow)

    // 目录的展开状态已由前面的箭头表达,这里只给文件加类型标记,
    // 但占位元素仍保留,以保证目录与文件的名称左边缘对齐
    const icon = document.createElement('span')
    icon.className = 'tree__icon'
    if (!node.entry.isDirectory && node.entry.kind) {
      icon.classList.add(`tree__icon--${node.entry.kind}`)
      icon.textContent = ICON_TEXT[node.entry.kind]
    }
    row.appendChild(icon)

    const name = document.createElement('span')
    name.className = 'tree__name'
    name.textContent = node.entry.name
    row.appendChild(name)

    row.addEventListener('click', () => {
      if (node.entry.isDirectory) {
        void this.#toggle(node)
        return
      }
      if (isEditableKind(node.entry.kind)) {
        this.callbacks.onOpenEditable(node.entry)
      } else {
        this.callbacks.onOpenExternal(node.entry, row)
      }
    })

    row.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      // 阻止冒泡,否则容器会再按"空白处"处理一次
      event.stopPropagation()
      this.callbacks.onContextMenu(node.entry, { x: event.clientX, y: event.clientY })
    })

    this.#rows.set(node.entry.path, row)
    item.appendChild(row)

    if (node.entry.isDirectory && node.expanded && node.children) {
      const sublist = document.createElement('ul')
      sublist.className = 'tree__children'
      for (const child of node.children) {
        if (!this.#matchesFilter(child.entry)) continue
        sublist.appendChild(this.#renderNode(child, depth + 1))
      }
      item.appendChild(sublist)
    }

    return item
  }
}
