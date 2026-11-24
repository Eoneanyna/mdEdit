import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { ExternalApp, FileKind, ReadingProgress } from '@shared/ipc'

interface Settings {
  aiConfig?: Omit<AiConfigStore, 'apiKey'> & { apiKey?: string; encryptedKey?: string }

  /** 涓婃鎵撳紑鐨勫伐浣滃尯,鍚姩鏃剁敤浜庢仮澶嶄晶杈规爮 */
  lastWorkspace: string | null
  /** 鏈€杩戞墦寮€杩囩殑鏂囦欢,鏈€鏂扮殑鍦ㄥ墠 */
  recentFiles: string[]
  /** 鎸夋枃浠剁被鍒浣忕殑澶栭儴搴旂敤,鏈€杩戠敤杩囩殑鍦ㄥ墠 */
  externalApps: Partial<Record<FileKind, ExternalApp[]>>
  /** 鏂囦欢鏍戠殑绫诲瀷绛涢€?null 琛ㄧず涓嶈繃婊?*/
  fileFilter: FileKind[] | null
  /** 鏄惁鍦ㄥ仠姝㈣緭鍏ュ悗鑷姩淇濆瓨 */
  autoSave: boolean
  /** 每个文件上次的阅读进度,键为文件绝对路径 */
  readingProgress: Record<string, ReadingProgress>
}

const DEFAULTS: Settings = {
  lastWorkspace: null,
  recentFiles: [],
  externalApps: {},
  fileFilter: null,
  autoSave: true,
  readingProgress: {}
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
    // 棣栨鍚姩鎴栨枃浠舵崯鍧?鍥炶惤鍒伴粯璁ゅ€?
    cache = { ...DEFAULTS }
  }
  return cache
}

function write(next: Settings): void {
  cache = next
  try {
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  } catch {
    // 閰嶇疆鍐欏叆澶辫触涓嶅簲褰卞搷editor涓绘祦绋?蹇界暐
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

/** 阅读进度最多保留最近使用的文件数,避免设置文件无限膨胀 */
const MAX_PROGRESS_ENTRIES = 200

export function getReadingProgress(filePath: string): ReadingProgress | null {
  if (typeof filePath !== 'string' || filePath.length === 0) return null
  return read().readingProgress[filePath] ?? null
}

/**
 * 记录阅读进度。数据来自渲染进程,边界上一律做校验与归一化,
 * 非法值不会写进设置文件,也不会把已有的进度覆盖成脏数据。
 */
export function setReadingProgress(filePath: string, progress: ReadingProgress): void {
  if (typeof filePath !== 'string' || filePath.length === 0) return
  if (!progress || typeof progress !== 'object') return

  const rawRatio = Number(progress.ratio)
  const ratio = Number.isFinite(rawRatio) ? Math.min(1, Math.max(0, rawRatio)) : 0
  const rawCursor = progress.cursor
  const cursor =
    typeof rawCursor === 'number' && Number.isInteger(rawCursor) && rawCursor >= 0
      ? rawCursor
      : null

  const current = read()
  const entries = Object.entries({
    ...current.readingProgress,
    [filePath]: { ratio, cursor, updatedAt: Date.now() }
  })
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, MAX_PROGRESS_ENTRIES)

  write({ ...current, readingProgress: Object.fromEntries(entries) })
}

export function getRememberedApps(kind: FileKind): ExternalApp[] {
  return read().externalApps[kind] ?? []
}

/** 璁颁綇鏌愮被鍒敤杩囩殑搴旂敤,閲嶅閫夋嫨浼氭彁鍒版渶鍓?*/
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


export interface AiConfigStore {
  provider: 'openrouter' | 'siliconcloud' | 'ollama' | 'custom'
  model: string
  apiKey: string
  baseUrl: string
  useLocal: boolean
  useWeb: boolean
}

const AI_DEFAULT: AiConfigStore = {
  provider: 'openrouter',
  model: 'openrouter/free',
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  useLocal: true,
  useWeb: false
}

export function getAiConfig(): AiConfigStore {
  const saved = read().aiConfig
  const { encryptedKey, apiKey: legacyKey, ...config } = saved || { ...AI_DEFAULT }
  let apiKey = legacyKey || ''
  if (encryptedKey && safeStorage.isEncryptionAvailable()) {
    try { apiKey = safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')) } catch { apiKey = '' }
  }
  // 迁移旧版已下线的默认模型，但保留用户自行配置的模型。
  const model = config.provider === 'openrouter' && config.model === 'deepseek/deepseek-chat-v3-0324:free' ? AI_DEFAULT.model : config.model
  return { ...AI_DEFAULT, ...config, ...(model ? { model } : {}), apiKey }
}

export function setAiConfig(config: AiConfigStore): void {
  const { apiKey, ...rest } = config
  const secure = safeStorage.isEncryptionAvailable() &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  if (apiKey && !secure) throw new Error('系统安全存储不可用，API Key 仍可在本次会话使用')
  const next: Settings = { ...read(), aiConfig: {
    ...rest, ...(apiKey ? { encryptedKey: safeStorage.encryptString(apiKey).toString('base64') } : {})
  } }
  // AI 配置保存需向界面报告真实错误，不能沿用静默失败的通用设置写入。
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  cache = next
}
