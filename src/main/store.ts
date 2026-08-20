import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ExternalApp, FileKind } from '@shared/ipc'

interface Settings {
  /** 上次打开的工作区,启动时用于恢复侧边栏 */
  lastWorkspace: string | null
  /** 最近打开过的文件,最新的在前 */
  recentFiles: string[]
  /** 按文件类别记住的外部应用,最近用过的在前 */
  externalApps: Partial<Record<FileKind, ExternalApp[]>>
  /** 文件树的类型筛选,null 表示不过滤 */
  fileFilter: FileKind[] | null
  /** 是否在停止输入后自动保存 */
  autoSave: boolean
}

const DEFAULTS: Settings = {
  lastWorkspace: null,
  recentFiles: [],
  externalApps: {},
  fileFilter: null,
  autoSave: true
}

const MAX_RECENT = 10
const MAX_APPS_PER_KIND = 5

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function read(): Settings {
  if (cache) return cache
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    // 首次启动或文件损坏,回落到默认值
    cache = { ...DEFAULTS }
  }
  return cache
}

function write(next: Settings): void {
  cache = next
  try {
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  } catch {
    // 配置写入失败不应影响editor主流程,忽略
  }
}

export function getLastWorkspace(): string | null {
  return read().lastWorkspace
}

export function setLastWorkspace(dirPath: string): void {
  write({ ...read(), lastWorkspace: dirPath })
}

export function pushRecentFile(filePath: string): void {
  const current = read()
  const recentFiles = [filePath, ...current.recentFiles.filter((p) => p !== filePath)].slice(
    0,
    MAX_RECENT
  )
  write({ ...current, recentFiles })
}

export function getRecentFiles(): string[] {
  return read().recentFiles
}

export function getAutoSave(): boolean {
  return read().autoSave
}

export function setAutoSave(enabled: boolean): void {
  write({ ...read(), autoSave: enabled })
}

export function getFileFilter(): FileKind[] | null {
  return read().fileFilter
}

export function setFileFilter(kinds: FileKind[] | null): void {
  write({ ...read(), fileFilter: kinds })
}

export function getRememberedApps(kind: FileKind): ExternalApp[] {
  return read().externalApps[kind] ?? []
}

/** 记住某类别用过的应用,重复选择会提到最前 */
export function rememberApp(kind: FileKind, entry: ExternalApp): void {
  const current = read()
  const existing = current.externalApps[kind] ?? []
  const next = [entry, ...existing.filter((a) => a.path !== entry.path)].slice(
    0,
    MAX_APPS_PER_KIND
  )
  write({
    ...current,
    externalApps: { ...current.externalApps, [kind]: next }
  })
}
