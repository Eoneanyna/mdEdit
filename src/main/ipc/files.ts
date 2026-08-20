import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { type OpenedDocument, isEditableKind, kindOf } from '@shared/ipc'
import { buildAppMenu } from '../menu'
import * as store from '../store'
import { guard } from './guard'
import { noteOwnWrite } from './watcher'

/** 供对话框使用的可编辑类型过滤器 */
const EDITABLE_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
  { name: '文本文件', extensions: ['txt'] },
  { name: '所有文件', extensions: ['*'] }
]

async function openDocument(filePath: string): Promise<OpenedDocument> {
  const name = basename(filePath)
  const kind = kindOf(name)
  if (!isEditableKind(kind)) {
    throw new Error(`该类型不支持在应用内编辑:${name}`)
  }
  const content = await readFile(filePath, 'utf-8')
  store.pushRecentFile(filePath)
  // 最近打开列表变了,菜单需要跟着重建
  buildAppMenu()
  return { path: filePath, name, content, kind: kind! }
}

export function registerFileIpc(): void {
  ipcMain.handle('file:choose', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: EDITABLE_FILTERS
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]!
  })

  ipcMain.handle('file:choose-save-path', async (event, defaultName: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { defaultPath: defaultName, filters: EDITABLE_FILTERS }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle('file:read', (_event, filePath: string) => guard(() => openDocument(filePath)))

  ipcMain.handle('file:write', (_event, filePath: string, content: string) =>
    guard(async () => {
      // 先登记内容,避免自身的写入被文件监听当成外部改动
      noteOwnWrite(filePath, content)
      await writeFile(filePath, content, 'utf-8')
      store.pushRecentFile(filePath)
      buildAppMenu()
      return null
    })
  )
}
