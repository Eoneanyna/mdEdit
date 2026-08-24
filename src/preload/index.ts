import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  type ExternalApp,
  type FileEntry,
  type FileKind,
  type MenuChannel,
  type OpenedDocument,
  type Platform,
  type RendererApi,
  type Result,
  TEST_HOOKS_FLAG
} from '@shared/ipc'

/**
 * 订阅主进程的推送,返回取消订阅的函数。
 * 各订阅接口的差异只在通道名与载荷类型,故统一由此生成,
 * 新增一路推送只需加一行,不必再抄一遍 on/off 的样板。
 */
function subscribe<A extends unknown[]>(
  channel: string,
  handler: (...args: A) => void
): () => void {
  const listener = (_event: IpcRendererEvent, ...args: A): void => handler(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api: RendererApi = {
  platform: process.platform as Platform,

  // 主进程通过 additionalArguments 透传,未开启时渲染层不会挂载任何内部对象
  testHooks: process.argv.includes(TEST_HOOKS_FLAG),

  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },

  onMenu: (channel: MenuChannel, handler: () => void): (() => void) =>
    subscribe(channel, handler),

  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('workspace:choose-folder'),

  readDir: (dirPath: string): Promise<Result<FileEntry[]>> =>
    ipcRenderer.invoke('workspace:read-dir', dirPath),

  chooseFile: (): Promise<string | null> => ipcRenderer.invoke('file:choose'),

  chooseSavePath: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:choose-save-path', defaultName),

  readFile: (filePath: string): Promise<Result<OpenedDocument>> =>
    ipcRenderer.invoke('file:read', filePath),

  writeFile: (filePath: string, content: string): Promise<Result<null>> =>
    ipcRenderer.invoke('file:write', filePath, content),

  createFile: (dirPath: string, name: string): Promise<Result<string>> =>
    ipcRenderer.invoke('fs:create-file', dirPath, name),

  createFolder: (dirPath: string, name: string): Promise<Result<string>> =>
    ipcRenderer.invoke('fs:create-folder', dirPath, name),

  renameEntry: (oldPath: string, newName: string): Promise<Result<string>> =>
    ipcRenderer.invoke('fs:rename', oldPath, newName),

  trashEntry: (target: string): Promise<Result<null>> => ipcRenderer.invoke('fs:trash', target),

  showInFolder: (target: string): Promise<Result<null>> =>
    ipcRenderer.invoke('fs:show-in-folder', target),

  openWithDefault: (filePath: string): Promise<Result<null>> =>
    ipcRenderer.invoke('external:open-default', filePath),

  openWithApp: (filePath: string, appPath: string): Promise<Result<null>> =>
    ipcRenderer.invoke('external:open-with', filePath, appPath),

  chooseApp: (): Promise<ExternalApp | null> => ipcRenderer.invoke('external:choose-app'),

  getRememberedApps: (kind: FileKind): Promise<ExternalApp[]> =>
    ipcRenderer.invoke('external:remembered-apps', kind),

  takePendingFile: (): Promise<string | null> => ipcRenderer.invoke('app:take-pending-file'),

  onOpenFile: (handler: (filePath: string) => void): (() => void) =>
    subscribe('app:open-file', handler),

  getAutoSave: (): Promise<boolean> => ipcRenderer.invoke('app:get-autosave'),

  onAutoSaveChanged: (handler: (enabled: boolean) => void): (() => void) =>
    subscribe('app:autosave-changed', handler),

  getFileFilter: (): Promise<FileKind[] | null> => ipcRenderer.invoke('workspace:get-filter'),

  setFileFilter: (kinds: FileKind[] | null): Promise<void> =>
    ipcRenderer.invoke('workspace:set-filter', kinds),

  getLastWorkspace: (): Promise<string | null> => ipcRenderer.invoke('workspace:get-last'),

  setLastWorkspace: (dirPath: string): Promise<void> =>
    ipcRenderer.invoke('workspace:set-last', dirPath),

  setDocumentState: (fileName: string | null, dirty: boolean): void => {
    ipcRenderer.send('window:document-state', fileName, dirty)
  },

  getRecentFiles: (): Promise<string[]> => ipcRenderer.invoke('file:recent'),

  onOpenRecent: (handler: (filePath: string) => void): (() => void) =>
    subscribe('menu:open-recent', handler),

  onSaveRequest: (handler: () => void): (() => void) => subscribe('app:save-request', handler),

  replySaveResult: (saved: boolean): void => {
    ipcRenderer.send('app:save-result', saved)
  },

  watchFile: (filePath: string | null): void => {
    ipcRenderer.send('file:watch', filePath)
  },

  onExternalChange: (handler: (filePath: string) => void): (() => void) =>
    subscribe('file:external-change', handler)
}

contextBridge.exposeInMainWorld('api', api)
