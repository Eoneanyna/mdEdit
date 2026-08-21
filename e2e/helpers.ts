import { execFileSync } from 'node:child_process'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// package.json 为 commonjs,Playwright 将 TS 转译为 CJS,用 __dirname 定位项目根
const root = resolve(__dirname, '..')
const MAIN = join(root, 'out', 'main', 'index.js')
export interface AppHarness {
  app: ElectronApplication
  win: Page
  /** 无条件终止应用(绕过关窗拦截),仅用于测试清理 */
  dispose: () => Promise<void>
}
/**
 * 测试钩子形状(--enable-test-hooks 时挂载到 window)。
 * 钩子是带方法的对象,无法经 evaluate 序列化传回,
 * 用例须在页面上下文内直接调用,并用本接口做类型断言。
 */
export interface PageHooks {
  __editor: {
    getMarkdown(): string
    setMarkdown(markdown: string): void
  }
  __doc: { name: string; path: string | null; dirty: boolean }
  __tree: { setRoot(dirPath: string): Promise<void> }
  __search: { open(): void; close(): void }
  __actions: {
    openPath(filePath: string): Promise<void>
    save(forceDialog?: boolean): Promise<boolean>
    setTab(tab: 'files' | 'outline'): void
  }
}

/** 页面内等待,避免回调式 Promise */
export function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/**
 * 强杀应用进程。优雅 close() 会被未保存拦截卡住,清理阶段直接杀进程。
 * Windows 上 Electron 派生 GPU/renderer 等子进程,kill() 只杀主进程,
 * 导致 close 事件永不触发,故用 taskkill /t 杀整棵进程树。
 */
function killApp(app: ElectronApplication): Promise<void> {
  const pid = app.process().pid
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/f', '/t', '/pid', String(pid)], { stdio: 'ignore' })
    } catch {
      // 进程可能已退出
    }
  } else {
    app.process().kill()
  }
  return delay(300)
}

/**
 * 启动应用。每次启动用独立 userData,避免上次的 settings.json(工作区、
 * 最近文件)串进断言;测试钩子由 --enable-test-hooks 开关开启。
 */
export async function launchApp(): Promise<AppHarness> {
  const userData = mkdtempSync(join(tmpdir(), 'mdedit-e2e-'))
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${userData}`, '--enable-test-hooks'],
    cwd: root
  })
  const win = await app.firstWindow()
  // bootstrap 在全部初始化完成后才挂载钩子,钩子出现即代表应用就绪
  await win.waitForFunction(
    () => typeof (window as unknown as Record<string, unknown>)['__actions'] !== 'undefined',
    undefined,
    { timeout: 30_000 }
  )
  return { app, win, dispose: () => killApp(app) }
}

/** 建一个带已知文件的工作区目录,返回目录路径 */
export function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mdedit-ws-'))
  for (const [name, content] of Object.entries(files)) {
    const target = join(dir, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf-8')
  }
  return dir
}
