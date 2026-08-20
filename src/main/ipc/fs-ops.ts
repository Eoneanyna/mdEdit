import { access, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ipcMain, shell } from 'electron'
import { guard } from './guard'

/** Windows 下的非法文件名字符,同时也覆盖了路径穿越 */
const INVALID_CHARS = /[\\/:*?"<>|]/

function assertValidName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('名称不能为空')
  if (trimmed === '.' || trimmed === '..') throw new Error('名称无效')
  if (INVALID_CHARS.test(trimmed)) throw new Error('名称不能包含 \\ / : * ? " < > |')
  // Windows 上以点或空格结尾的名称会被静默截断,直接拒绝更清晰
  if (/[. ]$/.test(trimmed)) throw new Error('名称不能以点或空格结尾')
  return trimmed
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

export function registerFsOpsIpc(): void {
  // 返回新文件路径,便于调用方随后打开它
  ipcMain.handle('fs:create-file', (_event, dirPath: string, name: string) =>
    guard(async () => {
      const safe = assertValidName(name)
      const target = join(dirPath, safe)
      if (await exists(target)) throw new Error(`「${safe}」已存在`)
      await writeFile(target, '', 'utf-8')
      return target
    })
  )

  ipcMain.handle('fs:create-folder', (_event, dirPath: string, name: string) =>
    guard(async () => {
      const safe = assertValidName(name)
      const target = join(dirPath, safe)
      if (await exists(target)) throw new Error(`「${safe}」已存在`)
      await mkdir(target)
      return target
    })
  )

  ipcMain.handle('fs:rename', (_event, oldPath: string, newName: string) =>
    guard(async () => {
      const safe = assertValidName(newName)
      const target = join(dirname(oldPath), safe)
      if (target === oldPath) return oldPath
      if (await exists(target)) throw new Error(`「${safe}」已存在`)
      await rename(oldPath, target)
      return target
    })
  )

  // 走系统回收站而非彻底删除,误删可恢复
  ipcMain.handle('fs:trash', (_event, target: string) =>
    guard(async () => {
      await shell.trashItem(target)
      return null
    })
  )

  ipcMain.handle('fs:show-in-folder', (_event, target: string) =>
    guard(() => {
      shell.showItemInFolder(target)
      return null
    })
  )
}
