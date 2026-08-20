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

const api: RendererApi = {
  platform: process.platform as Platform,

  // 主进程通过 additionalArguments 透传,未开启时渲染层不会挂载任何内部对象
  testHooks: process.argv.includes(TEST_HOOKS_FLAG),

  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },

  onMenu(channel: MenuChannel, handler: () => void): () => void {
    const listener = (_event: IpcRendererEvent): void => handler()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  },

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

  onOpenFile(handler: (filePath: string) => void): () => void {
    const listener = (_event: IpcRendererEvent, filePath: string): void => handler(filePath)
    ipcRenderer.on('app:open-file', listener)
    return () => ipcRenderer.off('app:open-file', listener)
  },

  getAutoSave: (): Promise<boolean> => ipcRenderer.invoke('app:get-autosave'),

  onAutoSaveChanged(handler: (enabled: boolean) => void): () => void {
    const listener = (_event: IpcRendererEvent, enabled: boolean): void => handler(enabled)
    ipcRenderer.on('app:autosave-changed', listener)
    return () => ipcRenderer.off('app:autosave-changed', listener)
  },

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

  onOpenRecent(handler: (filePath: string) => void): () => void {
    const listener = (_event: IpcRendererEvent, filePath: string): void => handler(filePath)
    ipcRenderer.on('menu:open-recent', listener)
    return () => ipcRenderer.off('menu:open-recent', listener)
  },

  onSaveRequest(handler: () => void): () => void {
    const listener = (_event: IpcRendererEvent): void => handler()
    ipcRenderer.on('app:save-request', listener)
    return () => ipcRenderer.off('app:save-request', listener)
  },

  replySaveResult: (saved: boolean): void => {
    ipcRenderer.send('app:save-result', saved)
  },

  watchFile: (filePath: string | null): void => {
    ipcRenderer.send('file:watch', filePath)
  },

  onExternalChange(handler: (filePath: string) => void): () => void {
    const listener = (_event: IpcRendererEvent, filePath: string): void => handler(filePath)
    ipcRenderer.on('file:external-change', listener)
    return () => ipcRenderer.off('file:external-change', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
