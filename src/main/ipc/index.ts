import { BrowserWindow, ipcMain } from 'electron'
import type { ReadingProgress } from '@shared/ipc'
import { updateDocState } from './close-guard'
import { registerExternalIpc } from './external'
import { registerFileIpc } from './files'
import { registerFsOpsIpc } from './fs-ops'
import { watchFile } from './watcher'
import { registerWorkspaceIpc } from './workspace'
import { takePendingFile } from '../pending-file'
import * as store from '../store'
import { registerAiIpc } from './ai'

const APP_NAME = 'mdEdit'

function registerWindowIpc(): void {
  // 标题栏展示当前文件名,未保存时前置圆点标记
  ipcMain.on('window:document-state', (event, fileName: string | null, dirty: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    window.setTitle(fileName ? `${dirty ? '● ' : ''}${fileName} — ${APP_NAME}` : APP_NAME)
    // 关窗拦截依赖这份状态判断是否需要挽留
    updateDocState(window, fileName, dirty)
  })

  ipcMain.on('file:watch', (event, filePath: string | null) => {
    void watchFile(filePath, event.sender)
  })

  ipcMain.handle('file:recent', () => store.getRecentFiles())

  ipcMain.handle('app:get-autosave', () => store.getAutoSave())

  ipcMain.handle('app:take-pending-file', () => takePendingFile())

  ipcMain.handle('app:get-reading-progress', (_event, filePath: string) =>
    store.getReadingProgress(filePath)
  )

  ipcMain.handle(
    'app:set-reading-progress',
    (_event, filePath: string, progress: ReadingProgress) => {
      store.setReadingProgress(filePath, progress)
    }
  )
}

export function registerIpc(): void {
  registerFileIpc()
  registerWorkspaceIpc()
  registerExternalIpc()
  registerFsOpsIpc()
  registerWindowIpc()
  registerAiIpc()
}

