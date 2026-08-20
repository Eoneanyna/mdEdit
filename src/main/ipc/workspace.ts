import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { type FileEntry, type FileKind, kindOf } from '@shared/ipc'
import * as store from '../store'
import { guard } from './guard'

/**
 * 读取目录的直接子项。只保留目录与受支持的文件类型,
 * 子目录不预载内容 —— 展开时由渲染层再次调用,避免大目录一次性扫描卡顿。
 */
async function readDir(dirPath: string): Promise<FileEntry[]> {
  const dirents = await readdir(dirPath, { withFileTypes: true })
  const entries: FileEntry[] = []

  for (const dirent of dirents) {
    // 跳过隐藏项与常见的重型目录
    if (dirent.name.startsWith('.')) continue
    if (dirent.isDirectory()) {
      if (dirent.name === 'node_modules') continue
      entries.push({
        name: dirent.name,
        path: join(dirPath, dirent.name),
        isDirectory: true,
        kind: null
      })
      continue
    }
    if (!dirent.isFile()) continue

    const kind = kindOf(dirent.name)
    if (!kind) continue
    entries.push({
      name: dirent.name,
      path: join(dirPath, dirent.name),
      isDirectory: false,
      kind
    })
  }

  // 目录在前,同类按名称排序,与常见文件管理器一致
  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle('workspace:choose-folder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const dirPath = result.filePaths[0]!
    store.setLastWorkspace(dirPath)
    return dirPath
  })

  ipcMain.handle('workspace:read-dir', (_event, dirPath: string) => guard(() => readDir(dirPath)))

  ipcMain.handle('workspace:get-filter', () => store.getFileFilter())

  ipcMain.handle('workspace:set-filter', (_event, kinds: FileKind[] | null) => {
    store.setFileFilter(kinds)
  })

  ipcMain.handle('workspace:get-last', () => store.getLastWorkspace())

  ipcMain.handle('workspace:set-last', (_event, dirPath: string) => {
    store.setLastWorkspace(dirPath)
  })
}
