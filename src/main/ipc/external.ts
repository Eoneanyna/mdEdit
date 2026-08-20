import { spawn } from 'node:child_process'
import { basename, extname } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { type ExternalApp, type FileKind, kindOf } from '@shared/ipc'
import * as store from '../store'
import { guard } from './guard'

/** 各平台下"可执行程序"的选择过滤器 */
function appFilters(): Electron.FileFilter[] {
  switch (process.platform) {
    case 'win32':
      return [
        { name: '应用程序', extensions: ['exe', 'com', 'bat', 'cmd'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    case 'darwin':
      return [{ name: '应用程序', extensions: ['app'] }]
    default:
      return [{ name: '所有文件', extensions: ['*'] }]
  }
}

/** 从可执行文件路径推断一个便于展示的名称 */
function appNameOf(appPath: string): string {
  return basename(appPath, extname(appPath))
}

/**
 * 用指定程序打开文件。
 * macOS 的 .app 是目录而非可执行文件,必须经由 open -a 启动。
 */
function launch(appPath: string, filePath: string): void {
  const child =
    process.platform === 'darwin' && appPath.endsWith('.app')
      ? spawn('open', ['-a', appPath, filePath], { detached: true, stdio: 'ignore' })
      : spawn(appPath, [filePath], { detached: true, stdio: 'ignore' })

  // 与主进程脱钩,关闭编辑器不应连带关掉用户打开的 Word/Excel
  child.unref()
}

export function registerExternalIpc(): void {
  ipcMain.handle('external:open-default', (_event, filePath: string) =>
    guard(async () => {
      // openPath 返回空串表示成功,非空即为错误描述
      const message = await shell.openPath(filePath)
      if (message) throw new Error(message)
      return null
    })
  )

  ipcMain.handle('external:open-with', (_event, filePath: string, appPath: string) =>
    guard(() => {
      launch(appPath, filePath)
      const kind = kindOf(basename(filePath))
      if (kind) store.rememberApp(kind, { name: appNameOf(appPath), path: appPath })
      return null
    })
  )

  ipcMain.handle('external:choose-app', async (event): Promise<ExternalApp | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '选择用于打开的应用程序',
      properties: ['openFile'],
      filters: appFilters()
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const appPath = result.filePaths[0]!
    return { name: appNameOf(appPath), path: appPath }
  })

  ipcMain.handle('external:remembered-apps', (_event, kind: FileKind) =>
    store.getRememberedApps(kind)
  )
}
