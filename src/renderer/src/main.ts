import {
  ALL_KINDS,
  type FileEntry,
  type FileKind,
  KIND_LABEL,
  KIND_SHORT,
  type MenuChannel
} from '@shared/ipc'
import { markdownToText } from './convert/md-to-text'
import { textToMarkdown } from './convert/text-to-md'
import { createEditor } from './editor/editor'
import { SAMPLE_DOC, SAMPLE_DOC_NAME } from './editor/sample'
import { Outline } from './outline/outline'
import { createSearchBar } from './search/search-bar'
import { showOpenWithMenu } from './sidebar/open-with'
import { FileTree } from './sidebar/tree'
import { DocumentState } from './state/document'
import { countText } from './state/word-count'
import { DIVIDER, type PopupItem, showPopup } from './ui/popup'
import { showPrompt } from './ui/prompt'
import { baseName, dirName } from './utils/path'
import './styles/main.css'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('缺少挂载节点 #app')

root.innerHTML = `
  <div class="app">
    <aside class="sidebar">
      <div class="sidebar__tabs">
        <button class="sidebar__tab is-active" type="button" data-tab="files">文件</button>
        <button class="sidebar__tab" type="button" data-tab="outline">大纲</button>
      </div>
      <section class="sidebar__panel" data-panel="files">
        <div class="sidebar__header">
          <span class="sidebar__title" id="workspace-name">未打开文件夹</span>
          <button class="sidebar__action" id="btn-filter" type="button" title="筛选文件类型">全部</button>
          <button class="sidebar__action" id="btn-open-folder" type="button">打开</button>
        </div>
        <div class="sidebar__body" id="tree"></div>
      </section>
      <section class="sidebar__panel is-hidden" data-panel="outline">
        <div class="sidebar__header">
          <span class="sidebar__title sidebar__title--filename" id="outline-doc">未命名.md</span>
        </div>
        <div class="sidebar__body" id="outline"></div>
      </section>
    </aside>
    <div class="workbench">
      <main class="editor-pane" id="editor-host"></main>
      <footer class="status">
        <span id="status-path">未命名</span>
        <span id="status-count">—</span>
        <span class="status__hint" id="status-hint"></span>
      </footer>
    </div>
  </div>
`

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`界面节点缺失:${selector}`)
  return node
}

/** 停止输入多久后触发自动保存 */
const AUTO_SAVE_DELAY = 2000

async function bootstrap(): Promise<void> {
  const hintEl = el('#status-hint')
  const countEl = el('#status-count')
  const pathEl = el('#status-path')
  const workspaceEl = el('#workspace-name')

  let hintTimer: number | undefined
  const notify = (message: string): void => {
    hintEl.textContent = message
    window.clearTimeout(hintTimer)
    hintTimer = window.setTimeout(() => (hintEl.textContent = ''), 4000)
  }

  const editor = await createEditor(el('#editor-host'), SAMPLE_DOC)
  const doc = new DocumentState(editor, SAMPLE_DOC_NAME)

  // 大纲的滚动容器是编辑区本身
  const editorPane = el('.editor-pane')
  const outline = new Outline(el('#outline'), editorPane)
  const outlineDocEl = el('#outline-doc')

  // 输入过程中不必每次按键都重扫标题
  let outlineTimer: number | undefined
  const scheduleOutlineRefresh = (): void => {
    window.clearTimeout(outlineTimer)
    outlineTimer = window.setTimeout(() => outline.refresh(), 300)
  }

  type SidebarTab = 'files' | 'outline'
  let activeTab: SidebarTab = 'files'

  function setTab(tab: SidebarTab): void {
    activeTab = tab
    for (const button of document.querySelectorAll<HTMLElement>('.sidebar__tab')) {
      button.classList.toggle('is-active', button.dataset.tab === tab)
    }
    for (const panel of document.querySelectorAll<HTMLElement>('.sidebar__panel')) {
      panel.classList.toggle('is-hidden', panel.dataset.panel !== tab)
    }
    // 面板隐藏时元素无尺寸,切回来必须重算
    if (tab === 'outline') outline.refresh()
  }

  for (const button of document.querySelectorAll<HTMLElement>('.sidebar__tab')) {
    button.addEventListener('click', () => setTab(button.dataset.tab as SidebarTab))
  }

  const tree = new FileTree(el('#tree'), {
    onOpenEditable: (entry) => void openPath(entry.path),
    onOpenExternal: (entry, anchor) => void showOpenWithMenu(entry, anchor, notify),
    onContextMenu: (entry, point) => showTreeContextMenu(entry, point),
    onError: notify
  })

  // 文档状态驱动标题栏与状态栏
  doc.subscribe((snapshot) => {
    window.api.setDocumentState(snapshot.name, snapshot.dirty)
    pathEl.textContent = `${snapshot.dirty ? '● ' : ''}${snapshot.path ?? snapshot.name}`
    outlineDocEl.textContent = snapshot.name
    outlineDocEl.title = snapshot.path ?? snapshot.name
    tree.setActive(snapshot.path)
  })

  // 统计渲染后的正文而非 Markdown 源码,否则 ** 、# 等标记会被计入
  const renderCount = (): void => {
    const text = editorPane.querySelector('.ProseMirror')?.textContent ?? ''
    const stats = countText(text)
    countEl.textContent = `${stats.words} 字`
    countEl.title = [
      `字数 ${stats.words}`,
      `字符 ${stats.characters}(含空格 ${stats.charactersWithSpaces})`,
      `行数 ${stats.lines}`
    ].join('\n')
  }
  renderCount()
  editor.onChange(renderCount)
  editor.onChange(scheduleOutlineRefresh)
  outline.refresh()

  /** 有未保存改动时先征求确认,避免静默丢失 */
  function confirmDiscard(): boolean {
    if (!doc.dirty) return true
    return window.confirm(`「${doc.name}」有未保存的修改,确定放弃吗?`)
  }

  /** 载入指定路径。skipConfirm 供外部改动后的重新载入使用 */
  async function openPath(filePath: string, skipConfirm = false): Promise<void> {
    if (!skipConfirm && !confirmDiscard()) return
    const result = await window.api.readFile(filePath)
    if (!result.ok) {
      notify(`打开失败:${result.error}`)
      return
    }
    doc.open(result.value)
    renderCount()
    // 换文件即换监听目标
    window.api.watchFile(result.value.path)
    editor.focus()
    notify(`已打开 ${result.value.name}`)
  }

  // ---- 文件树右键操作 ----

  /** 文件名里不允许出现的字符,与主进程的校验保持一致 */
  function validateEntryName(value: string): string | null {
    if (!value) return '名称不能为空'
    if (/[\\/:*?"<>|]/.test(value)) return '不能包含 \\ / : * ? " < > |'
    if (/[. ]$/.test(value)) return '不能以点或空格结尾'
    return null
  }

  async function createFileIn(dirPath: string): Promise<void> {
    const input = await showPrompt({
      title: '新建 Markdown 文件',
      defaultValue: '未命名.md',
      selectRange: [0, 3],
      confirmLabel: '创建',
      validate: validateEntryName
    })
    if (!input) return

    // 没写扩展名时补 .md,免得建出一个打不开的文件
    const name = input.includes('.') ? input : `${input}.md`
    const result = await window.api.createFile(dirPath, name)
    if (!result.ok) {
      notify(`新建失败:${result.error}`)
      return
    }
    await tree.refresh()
    await openPath(result.value)
  }

  async function createFolderIn(dirPath: string): Promise<void> {
    const name = await showPrompt({
      title: '新建文件夹',
      defaultValue: '新建文件夹',
      confirmLabel: '创建',
      validate: validateEntryName
    })
    if (!name) return

    const result = await window.api.createFolder(dirPath, name)
    if (!result.ok) {
      notify(`新建失败:${result.error}`)
      return
    }
    await tree.refresh()
    notify(`已创建 ${name}`)
  }

  async function renameEntry(entry: FileEntry): Promise<void> {
    // 预选中主干部分,扩展名通常不需要改
    const dot = entry.name.lastIndexOf('.')
    const stemEnd = entry.isDirectory || dot <= 0 ? entry.name.length : dot

    const name = await showPrompt({
      title: entry.isDirectory ? '重命名文件夹' : '重命名文件',
      defaultValue: entry.name,
      selectRange: [0, stemEnd],
      confirmLabel: '重命名',
      validate: validateEntryName
    })
    if (!name || name === entry.name) return

    const result = await window.api.renameEntry(entry.path, name)
    if (!result.ok) {
      notify(`重命名失败:${result.error}`)
      return
    }

    // 改的正是当前打开的文件:只换路径,不重新载入,以免丢掉未保存的改动
    if (doc.path === entry.path) {
      doc.renamed(result.value, baseName(result.value))
      window.api.watchFile(result.value)
    }
    await tree.refresh()
    notify(`已重命名为 ${baseName(result.value)}`)
  }

  async function deleteEntry(entry: FileEntry): Promise<void> {
    const label = entry.isDirectory ? '文件夹' : '文件'
    if (!window.confirm(`确定把${label}「${entry.name}」移到回收站吗?`)) return

    const result = await window.api.trashEntry(entry.path)
    if (!result.ok) {
      notify(`删除失败:${result.error}`)
      return
    }

    // 删掉的正是当前文档:退回空白页,并停止监听已不存在的文件
    if (doc.path === entry.path) {
      doc.reset()
      renderCount()
      window.api.watchFile(null)
    }
    await tree.refresh()
    notify(`已将 ${entry.name} 移到回收站`)
  }

  function showTreeContextMenu(entry: FileEntry | null, point: { x: number; y: number }): void {
    const root = tree.rootPath
    if (!root) {
      notify('请先打开一个文件夹')
      return
    }

    // 新建的落点:空白处用根目录,目录用其自身,文件用它所在的目录
    const targetDir = !entry
      ? root
      : entry.isDirectory
        ? entry.path
        : (dirName(entry.path) ?? root)

    const items: PopupItem[] = [
      { label: '新建 Markdown 文件', action: () => void createFileIn(targetDir) },
      { label: '新建文件夹', action: () => void createFolderIn(targetDir) }
    ]

    if (entry) {
      items.push(
        DIVIDER,
        { label: '重命名…', action: () => void renameEntry(entry) },
        { label: '删除', action: () => void deleteEntry(entry) },
        DIVIDER,
        {
          label: '在文件管理器中显示',
          action: async () => {
            const result = await window.api.showInFolder(entry.path)
            if (!result.ok) notify(`打开失败:${result.error}`)
          }
        }
      )
    }

    showPopup(point, () => items)
  }

  /**
   * 从外部(双击文件、文件关联)打开文档。
   * 若此前没有工作区,顺带把文件所在目录设为工作区,免得侧边栏空着。
   */
  async function openWithWorkspace(filePath: string): Promise<void> {
    if (!tree.rootPath) {
      const dir = dirName(filePath)
      if (dir) await setWorkspace(dir)
    }
    await openPath(filePath)
  }

  /** 切换工作区。树与标题必须一起更新,统一收在这里避免调用方各写一遍 */
  async function setWorkspace(dirPath: string): Promise<void> {
    await tree.setRoot(dirPath)
    workspaceEl.textContent = baseName(dirPath)
    workspaceEl.title = dirPath
  }

  async function openFolder(): Promise<void> {
    const dirPath = await window.api.chooseFolder()
    if (!dirPath) return
    await setWorkspace(dirPath)
    notify(`工作区:${dirPath}`)
  }

  /** 返回是否真的写入成功,关窗拦截依赖这个结果决定要不要继续关闭 */
  async function save(forceDialog = false): Promise<boolean> {
    const content = editor.getMarkdown()
    let target = forceDialog ? null : doc.path
    if (!target) {
      target = await window.api.chooseSavePath(doc.name)
      if (!target) return false
    }
    const result = await window.api.writeFile(target, content)
    if (!result.ok) {
      notify(`保存失败:${result.error}`)
      return false
    }
    doc.markSaved(target, baseName(target), content)
    // 另存为会改变路径,监听目标随之切换
    window.api.watchFile(target)
    notify(`已保存 ${baseName(target)}`)
    // 新文件可能刚落到工作区里,刷新让它出现在树上
    if (tree.rootPath && target.startsWith(tree.rootPath)) await tree.refresh()
    return true
  }

  /**
   * 导出为另一种格式。与「另存为」不同:导出不接管当前文档,
   * 写完后仍在编辑原文件,doc 的路径与脏标记都不受影响。
   */
  async function exportAs(target: 'text' | 'markdown'): Promise<void> {
    const source = editor.getMarkdown()
    const content = target === 'text' ? markdownToText(source) : textToMarkdown(source)
    if (content.trim() === '') {
      notify('文档为空,没有可导出的内容')
      return
    }
    // 换扩展名而不是往后追加,免得出现 讲义.md.txt
    const stem = doc.name.replace(/\.[^.\/]+$/, '')
    const suffix = target === 'text' ? '.txt' : '.md'
    const savePath = await window.api.chooseSavePath(stem + suffix)
    if (!savePath) return

    const result = await window.api.writeFile(savePath, content)
    if (!result.ok) {
      notify(`导出失败:${result.error}`)
      return
    }
    notify(`已导出 ${baseName(savePath)}`)
    // 导出目标可能落在工作区内,刷新让它出现在树上
    if (tree.rootPath && savePath.startsWith(tree.rootPath)) await tree.refresh()
  }

  // ---- 自动保存 ----
  let autoSaveEnabled = await window.api.getAutoSave()
  let autoSaveTimer: number | undefined

  function scheduleAutoSave(): void {
    window.clearTimeout(autoSaveTimer)
    if (!autoSaveEnabled) return
    autoSaveTimer = window.setTimeout(() => {
      // 尚未落盘的新文档会弹出「另存为」对话框,打断输入,因此跳过
      if (!doc.path || !doc.dirty) return
      void save(false)
    }, AUTO_SAVE_DELAY)
  }

  editor.onChange(scheduleAutoSave)

  // ---- 查找替换 ----
  const searchBar = createSearchBar(el('.workbench'), editor.search, () => {
    renderCount()
    scheduleOutlineRefresh()
    scheduleAutoSave()
  })

  window.api.onAutoSaveChanged((enabled) => {
    autoSaveEnabled = enabled
    if (!enabled) window.clearTimeout(autoSaveTimer)
    notify(enabled ? '已开启自动保存' : '已关闭自动保存')
  })

  const handlers: Partial<Record<MenuChannel, () => void>> = {
    'menu:file-new': () => {
      if (!confirmDiscard()) return
      doc.reset()
      renderCount()
      // 新文档尚无对应文件,停止监听
      window.api.watchFile(null)
      editor.focus()
      notify('已新建文档')
    },
    'menu:file-open': () => {
      void (async () => {
        if (!confirmDiscard()) return
        const filePath = await window.api.chooseFile()
        if (filePath) await openPath(filePath)
      })()
    },
    'menu:folder-open': () => void openFolder(),
    'menu:file-save': () => void save(false),
    'menu:file-save-as': () => void save(true),
    'menu:export-text': () => void exportAs('text'),
    'menu:export-markdown': () => void exportAs('markdown'),
    'menu:toggle-outline': () => setTab(activeTab === 'outline' ? 'files' : 'outline'),
    'menu:find': () => searchBar.open()
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    window.api.onMenu(channel as MenuChannel, handler)
  }

  el('#btn-open-folder').addEventListener('click', () => void openFolder())

  // ---- 文件类型筛选 ----
  const filterButton = el('#btn-filter')
  let fileFilter: Set<FileKind> | null = null

  // 按钮空间有限,用短标签;菜单里仍显示完整名称
  function filterLabel(): string {
    if (!fileFilter) return '全部'
    if (fileFilter.size === 1) return KIND_SHORT[[...fileFilter][0]!]
    return `${fileFilter.size} 类`
  }

  /** 勾满或清空都等同于不过滤,统一归一化为 null,按钮回到「全部」 */
  function applyFilter(next: Set<FileKind> | null, persist = true): void {
    fileFilter = !next || next.size === 0 || next.size === ALL_KINDS.length ? null : next
    tree.setFilter(fileFilter)
    filterButton.textContent = filterLabel()
    filterButton.classList.toggle('is-on', fileFilter !== null)
    if (persist) void window.api.setFileFilter(fileFilter ? [...fileFilter] : null)
  }

  filterButton.addEventListener('click', () => {
    showPopup(filterButton, () => [
      {
        label: '全部类型',
        checked: fileFilter === null,
        action: () => applyFilter(null)
      },
      DIVIDER,
      ...ALL_KINDS.map((kind) => ({
        label: KIND_LABEL[kind],
        checked: fileFilter?.has(kind) ?? false,
        keepOpen: true,
        action: () => {
          const next = new Set(fileFilter ?? [])
          if (next.has(kind)) next.delete(kind)
          else next.add(kind)
          applyFilter(next)
        }
      }))
    ])
  })

  // 恢复上次的筛选设置(此处不再写回配置)
  const savedFilter = await window.api.getFileFilter()
  applyFilter(savedFilter ? new Set(savedFilter) : null, false)

  // 菜单「最近打开」
  window.api.onOpenRecent((filePath) => void openPath(filePath))

  // 关窗前主进程请求保存,必须回执,否则它会一直等到超时
  window.api.onSaveRequest(() => {
    void (async () => {
      const saved = await save(false)
      window.api.replySaveResult(saved)
    })()
  })

  // 当前文件被其他程序改动
  window.api.onExternalChange((filePath) => {
    if (filePath !== doc.path) return
    const message = doc.dirty
      ? `「${baseName(filePath)}」已被其他程序修改。\n\n重新载入会丢失你当前未保存的改动,确定重新载入吗?`
      : `「${baseName(filePath)}」已被其他程序修改,是否重新载入?`
    if (!window.confirm(message)) {
      notify('文件已在外部改动,当前内容未同步')
      return
    }
    void openPath(filePath, true)
  })

  // 应用运行期间用户又双击了文件
  window.api.onOpenFile((filePath) => void openWithWorkspace(filePath))

  // 恢复上次的工作区
  const lastWorkspace = await window.api.getLastWorkspace()
  if (lastWorkspace) await setWorkspace(lastWorkspace)

  // 双击文件启动时,路径由主进程从命令行参数中解析后暂存,这里取回
  const pendingFile = await window.api.takePendingFile()
  if (pendingFile) await openWithWorkspace(pendingFile)

  // 自动化验证钩子。系统对话框无法被脚本驱动,故暴露内部动作以便端到端检查;
  // 仅在带 --enable-test-hooks 启动时挂载,正常使用时 window 上不会多出任何东西。
  if (window.api.testHooks) {
    Object.assign(window, {
      __editor: editor,
      __doc: doc,
      __tree: tree,
      __outline: outline,
      __search: searchBar,
      __actions: {
        save,
        openPath,
        openFolder,
        setWorkspace,
        setTab,
        applyFilter,
        setAutoSave: (on: boolean) => {
          autoSaveEnabled = on
          if (!on) window.clearTimeout(autoSaveTimer)
        }
      }
    })
  }
}

void bootstrap()
