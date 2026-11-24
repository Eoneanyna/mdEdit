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

/** 测试进程内的定长等待 */
export function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * 列出某个 pid 的所有后代进程(POSIX)。
 * Electron 会派生 GPU / renderer / utility,应用自身还会拉起内置检索服务,
 * 这些都是主进程的子进程,并且会继承它的 stdio 描述符。
 */
function descendants(rootPid: number): number[] {
  let listing: string
  try {
    listing = execFileSync('ps', ['-eo', 'pid=,ppid='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    return []
  }
  const byParent = new Map<number, number[]>()
  for (const line of listing.split('\n')) {
    // Linux(procps) 与 macOS(BSD ps) 的对齐/列宽不同,按空白切分更稳。
    const columns = line.trim().split(/\s+/)
    const child = Number(columns[0])
    const parent = Number(columns[1])
    if (!Number.isInteger(child) || !Number.isInteger(parent)) continue
    const siblings = byParent.get(parent) ?? []
    siblings.push(child)
    byParent.set(parent, siblings)
  }
  const found: number[] = []
  const visit = (pid: number): void => {
    for (const child of byParent.get(pid) ?? []) {
      found.push(child)
      visit(child)
    }
  }
  visit(rootPid)
  return found
}

/** 定时器不应拖住 worker 进程退出 */
function timeout(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}

/**
 * 强杀应用进程树。优雅 close() 会被未保存拦截卡住,清理阶段直接杀进程。
 *
 * 关键:只杀 Electron 主进程是不够的。Node 的 ChildProcess 'close' 事件要等
 * 所有继承 stdio 描述符的子进程退出才触发,否则 Playwright 不会把该进程从
 * gracefullyCloseSet 移除,worker 收尾时的 gracefullyCloseAll() 会一直挂着,
 * 最终报 "Worker teardown timeout"(表现为「用例全部通过但 job 失败」)。
 * Windows 的 taskkill /t 天然杀整棵树;POSIX 此前只 kill() 主进程,故需先
 * 取子进程快照,再按进程组(与 Playwright 自身做法一致)整组清掉。
 *
 * 还要容忍「应用已经不在了」:用例若主动关掉最后一个窗口,应用会自行退出,
 * 此时 Playwright 的进程句柄失效 —— Windows 上仍返回对象,Linux 上返回
 * undefined,直接取 .pid 会抛错并让本已通过的用例判失败。清理不该如此脆弱。
 */
async function killApp(app: ElectronApplication, closed: Promise<void>): Promise<void> {
  let proc: ReturnType<ElectronApplication['process']> | undefined
  try {
    proc = app.process()
  } catch {
    // 句柄已失效,视作已退出
  }

  const pid = proc?.pid
  if (pid !== undefined) {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/f', '/t', '/pid', String(pid)], { stdio: 'ignore' })
      } catch {
        // 进程可能已退出
      }
    } else {
      // 先取子进程快照:主进程一死,子进程就被 init 收养,进程树会断掉。
      const tree = descendants(pid)
      // Playwright 以 detached 启动 Electron,pid 即进程组 ID,一次清掉整组。
      // 这正是 Playwright 自己 killProcess() 的做法,不会误伤测试 worker。
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // 组已不存在(或该版本未用独立进程组),走下面的逐个清理
      }
      // 兜底:自行脱离进程组的子进程按快照逐个清掉。
      for (const target of tree) {
        try {
          process.kill(target, 'SIGKILL')
        } catch {
          // 进程可能已退出
        }
      }
      try {
        proc?.kill('SIGKILL')
      } catch {
        // 同上
      }
    }
  }
  // 等 'close' 真正触发,Playwright 才会完成清理;超时兜底防止清理本身卡死用例。
  await Promise.race([closed, timeout(3000)])
}

/**
 * 启动应用。每次启动用独立 userData,避免上次的 settings.json(工作区、
 * 最近文件)串进断言;测试钩子由 --enable-test-hooks 开关开启。
 */
export async function launchApp(
  options: { env?: NodeJS.ProcessEnv; args?: string[] } = {}
): Promise<AppHarness> {
  const userData = mkdtempSync(join(tmpdir(), 'mdedit-e2e-'))
  // 末尾的附加参数可模拟「双击文件」时系统传入的文档路径
  const args = [MAIN, `--user-data-dir=${userData}`, '--enable-test-hooks', ...(options.args ?? [])]
  // CI 的 Linux 容器未配置 SUID sandbox helper,不关掉沙箱 Electron 会直接 fatal 退出。
  // 仅测试环境使用,不影响正式产物的安全设置。
  if (process.platform === 'linux') args.push('--no-sandbox')
  const app = await electron.launch({ args, cwd: root, env: { ...process.env, ...options.env } })
  // 启动后立刻监听,保证 dispose 一定能等到这个信号(而不是自己再去注册一个
  // 可能已经错过事件的监听器)。
  const closed = new Promise<void>((resolve) => {
    try {
      app.process().once('close', () => resolve())
    } catch {
      resolve()
    }
  })
  const win = await app.firstWindow()
  // bootstrap 在全部初始化完成后才挂载钩子,钩子出现即代表应用就绪
  await win.waitForFunction(
    () => typeof (window as unknown as Record<string, unknown>)['__actions'] !== 'undefined',
    undefined,
    { timeout: 30_000 }
  )
  return { app, win, dispose: () => killApp(app, closed) }
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
