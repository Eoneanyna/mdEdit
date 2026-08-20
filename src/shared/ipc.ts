/**
 * 主进程与渲染进程共享的 IPC 契约。
 * 两端都从这里取类型,避免通道名各写一份导致漂移。
 * 注意:本文件会被渲染进程加载,不得依赖 Node 类型。
 */

/** 主进程菜单向渲染进程派发的动作。每一项都必须在渲染层有对应实现 */
export type MenuChannel =
  | 'menu:file-new'
  | 'menu:file-open'
  | 'menu:folder-open'
  | 'menu:file-save'
  | 'menu:file-save-as'
  | 'menu:find'
  | 'menu:toggle-outline'

/** 目标平台,仅覆盖本项目支持的三个系统 */
export type Platform = 'win32' | 'darwin' | 'linux'

/** 运行环境信息,用于界面展示与平台差异判断 */
export interface RuntimeVersions {
  electron: string
  chrome: string
  node: string
}

/**
 * 侧边栏关心的文件类别:
 * - markdown / text 在应用内编辑
 * - word / excel 只能交给外部程序打开
 */
export type FileKind = 'markdown' | 'text' | 'word' | 'excel'

/** 扩展名到类别的映射,两端共用以保证判定一致 */
export const KIND_BY_EXT: Readonly<Record<string, FileKind>> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdown': 'markdown',
  '.mkd': 'markdown',
  '.txt': 'text',
  '.doc': 'word',
  '.docx': 'word',
  '.xls': 'excel',
  '.xlsx': 'excel',
  '.csv': 'excel'
}

/** 类别的中文名,用于筛选菜单等界面展示 */
export const KIND_LABEL: Readonly<Record<FileKind, string>> = {
  markdown: 'Markdown',
  text: '文本',
  word: 'Word',
  excel: 'Excel'
}

/** 类别的短标签,用于空间紧张的按钮上 */
export const KIND_SHORT: Readonly<Record<FileKind, string>> = {
  markdown: 'MD',
  text: 'TXT',
  word: 'DOC',
  excel: 'XLS'
}

/** 全部类别,顺序即筛选菜单中的展示顺序 */
export const ALL_KINDS: readonly FileKind[] = ['markdown', 'text', 'word', 'excel']

/** 能在应用内编辑的类别 */
export const EDITABLE_KINDS: readonly FileKind[] = ['markdown', 'text']

export function isEditableKind(kind: FileKind | null): boolean {
  return kind !== null && EDITABLE_KINDS.includes(kind)
}

/** 取文件类别,不受支持的扩展名返回 null */
export function kindOf(fileName: string): FileKind | null {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return null
  return KIND_BY_EXT[fileName.slice(dot).toLowerCase()] ?? null
}

/** 文件树中的一个条目。目录不预载子项,展开时再调用 readDir */
export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  /** 目录恒为 null;文件为其类别 */
  kind: FileKind | null
}

/** 读入的文档内容 */
export interface OpenedDocument {
  path: string
  name: string
  content: string
  kind: FileKind
}

/** 记住的外部应用 */
export interface ExternalApp {
  name: string
  path: string
}

/** 统一的操作结果,避免渲染进程直接吃到主进程异常栈 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** preload 通过 contextBridge 暴露给渲染进程的能力集合 */
/** 启用自动化测试钩子的命令行开关 */
export const TEST_HOOKS_FLAG = '--enable-test-hooks'

export interface RendererApi {
  platform: Platform
  versions: RuntimeVersions

  /**
   * 是否启用测试钩子。仅当进程带 --enable-test-hooks 启动时为 true,
   * 正常使用不会向 window 挂载任何内部对象。
   */
  testHooks: boolean

  /** 订阅菜单动作,返回取消订阅的函数 */
  onMenu: (channel: MenuChannel, handler: () => void) => () => void

  /** 弹出文件夹选择框,返回选中的目录 */
  chooseFolder: () => Promise<string | null>
  /** 读取某个目录下的直接子项(已过滤为受支持的类型与目录) */
  readDir: (dirPath: string) => Promise<Result<FileEntry[]>>

  /** 弹出文件选择框 */
  chooseFile: () => Promise<string | null>
  /** 弹出保存位置选择框 */
  chooseSavePath: (defaultName: string) => Promise<string | null>
  /** 读取可编辑文件的文本内容 */
  readFile: (filePath: string) => Promise<Result<OpenedDocument>>
  /** 写入文本内容 */
  writeFile: (filePath: string, content: string) => Promise<Result<null>>

  /** 在目录下新建文件,返回新文件路径 */
  createFile: (dirPath: string, name: string) => Promise<Result<string>>
  /** 在目录下新建子目录,返回新目录路径 */
  createFolder: (dirPath: string, name: string) => Promise<Result<string>>
  /** 同目录内改名,返回新路径 */
  renameEntry: (oldPath: string, newName: string) => Promise<Result<string>>
  /** 移入系统回收站 */
  trashEntry: (target: string) => Promise<Result<null>>
  /** 在系统文件管理器中定位 */
  showInFolder: (target: string) => Promise<Result<null>>

  /** 用系统默认程序打开 */
  openWithDefault: (filePath: string) => Promise<Result<null>>
  /** 用指定应用打开,并记住该应用 */
  openWithApp: (filePath: string, appPath: string) => Promise<Result<null>>
  /** 弹出选择器让用户挑一个可执行程序 */
  chooseApp: () => Promise<ExternalApp | null>
  /** 取该类别下记住过的外部应用 */
  getRememberedApps: (kind: FileKind) => Promise<ExternalApp[]>

  /**
   * 取走冷启动时待打开的文件(双击文件启动的场景)。
   * 只应在渲染层初始化时调用一次,取过即清空。
   */
  takePendingFile: () => Promise<string | null>
  /** 应用已在运行时,用户又双击了文件 */
  onOpenFile: (handler: (filePath: string) => void) => () => void

  /** 自动保存开关。仅对已有路径的文档生效 */
  getAutoSave: () => Promise<boolean>
  /** 开关被菜单切换时的通知 */
  onAutoSaveChanged: (handler: (enabled: boolean) => void) => () => void

  /** 文件树的类型筛选。null 表示不过滤 */
  getFileFilter: () => Promise<FileKind[] | null>
  setFileFilter: (kinds: FileKind[] | null) => Promise<void>

  /** 上次打开的工作区,用于启动时恢复 */
  getLastWorkspace: () => Promise<string | null>
  /** 记录当前工作区 */
  setLastWorkspace: (dirPath: string) => Promise<void>

  /** 同步窗口标题上的文件名与未保存标记 */
  setDocumentState: (fileName: string | null, dirty: boolean) => void

  /** 最近打开过的文件,最新的在前 */
  getRecentFiles: () => Promise<string[]>
  /** 菜单「最近打开」被点击 */
  onOpenRecent: (handler: (filePath: string) => void) => () => void

  /**
   * 关闭窗口前主进程请求保存。处理完毕后必须调用 replySaveResult,
   * 否则主进程会在超时后按「保存失败」处理。
   */
  onSaveRequest: (handler: () => void) => () => void
  replySaveResult: (saved: boolean) => void

  /** 监听指定文件的外部改动,传 null 停止监听 */
  watchFile: (filePath: string | null) => void
  /** 当前文件被其他程序改动 */
  onExternalChange: (handler: (filePath: string) => void) => () => void
}
