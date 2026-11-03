import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

interface Connection { url: string; headers: Record<string, string> }
interface Options { executable: string; developmentPython?: string; serviceDirectory: string; logPath: string }
let options: Options | undefined
let child: ChildProcess | undefined
let connection: Connection | undefined
let starting: Promise<Connection | null> | undefined
let epoch = 0
let stopping = false
let failures = 0
let state: 'starting' | 'running' | 'stopped' | 'unavailable' = 'stopped'
let error: string | null = null

export function ragProcessState() {
  return { managed: !!options && !process.env.MDEDIT_RAG_URL,
    serviceState: process.env.MDEDIT_RAG_URL ? 'external' as const : state, error }
}
function log(text: string): void {
  if (!options) return
  try {
    if (existsSync(options.logPath) && statSync(options.logPath).size > 128000) writeFileSync(options.logPath, readFileSync(options.logPath, 'utf8').slice(-64000), 'utf8')
    appendFileSync(options.logPath, text.slice(0, 8000), 'utf8')
  } catch { /* 日志失败不阻止编辑。 */ }
}
export function configureRagProcess(config: Options): void {
  options = config
  if (process.env.MDEDIT_RAG_URL) return
  try { mkdirSync(dirname(config.logPath), { recursive: true }) } catch {}
  try { const old = readFileSync(config.logPath, 'utf8'); writeFileSync(config.logPath, old.slice(-64000), 'utf8') } catch {}
  void startRagProcess()
}
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as { port: number }).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}
export function startRagProcess(): Promise<Connection | null> {
  if (process.env.MDEDIT_RAG_URL) return Promise.resolve({ url: process.env.MDEDIT_RAG_URL, headers: {} })
  if (connection && state === 'running') return Promise.resolve(connection)
  if (starting) return starting
  if (!options) return Promise.resolve({ url: 'http://127.0.0.1:8765', headers: {} })
  const config = options
  const executable = existsSync(config.executable) ? config.executable : config.developmentPython && existsSync(config.developmentPython) ? config.developmentPython : null
  if (!executable) {
    state = 'unavailable'; error = '内置增强检索尚未准备，当前仍可使用关键词检索。'
    return Promise.resolve(null)
  }
  stopping = false; state = 'starting'; error = null
  const current = ++epoch
  starting = (async () => {
    try {
      const port = await freePort()
      if (current !== epoch || stopping) return null
      const token = randomBytes(24).toString('hex')
      const target = { url: 'http://127.0.0.1:' + port, headers: { 'x-mdedit-token': token } }
      const args = executable === config.executable ? ['--port', String(port)] : ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)]
      const owned = spawn(executable, args, { cwd: dirname(executable === config.executable ? config.executable : join(config.serviceDirectory, 'entrypoint.py')),
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MDEDIT_EMBEDDER: 'hash', MDEDIT_RAG_TOKEN: token } })
      child = owned
      owned.stdout?.on('data', data => log(String(data)))
      owned.stderr?.on('data', data => log(String(data)))
      owned.on('error', () => { if (current === epoch) { state = 'unavailable'; error = '本地检索服务启动失败，可点击重启。' } })
      owned.on('exit', () => {
        if (current !== epoch || stopping) return
        connection = undefined; state = 'unavailable'; error = '本地检索服务已退出，已回退关键词模式。'
        if (++failures <= 2) setTimeout(() => { if (current === epoch && !stopping) void startRagProcess() }, 1000)
      })
      for (let attempt = 0; attempt < 35; attempt++) {
        if (current !== epoch || stopping || owned.exitCode !== null || !owned.pid) break
        try {
          const res = await fetch(target.url + '/health', { headers: target.headers, signal: AbortSignal.timeout(350) })
          if (res.ok && (await res.json() as { protocol?: number }).protocol === 2) {
            connection = target; state = 'running'; return target
          }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      if (current === epoch && !stopping) { state = 'unavailable'; error = '本地检索服务启动超时，已回退关键词模式。'; owned.kill() }
      return null
    } catch {
      if (current === epoch) { state = 'unavailable'; error = '本地检索服务暂不可用，已回退关键词模式。' }
      return null
    } finally { if (current === epoch) starting = undefined }
  })()
  return starting
}
export async function getRagConnection(): Promise<Connection | null> { return startRagProcess() }
export async function stopRagProcess(): Promise<void> {
  stopping = true; ++epoch; connection = undefined; starting = undefined; state = 'stopped'
  const owned = child; child = undefined
  if (!owned?.pid || owned.exitCode !== null) return
  if (process.platform === 'win32') {
    try {
      execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(owned.pid), '/t', '/f'],
        { windowsHide: true, stdio: 'ignore', timeout: 4000 })
    } catch { owned.kill() }
  } else owned.kill('SIGTERM')
}
export async function restartRagProcess(): Promise<void> {
  if (process.env.MDEDIT_RAG_URL) throw new Error('当前连接外部检索服务，请在原服务中重启')
  await stopRagProcess(); failures = 0
  if (!await startRagProcess()) throw new Error(error || '本地服务未能启动')
}
