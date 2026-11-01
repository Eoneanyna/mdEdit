import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ExternalApp, FileKind } from '@shared/ipc'

interface Settings {
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
  model: 'deepseek/deepseek-chat-v3-0324:free',
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  useLocal: true,
  useWeb: false
}

export function getAiConfig(): AiConfigStore {
  const current: any = read()
  return { ...AI_DEFAULT, ...(current.aiConfig || {}) }
}

export function setAiConfig(config: AiConfigStore): void {
  const current: any = read()
  write({ ...current, aiConfig: config } as any)
}


