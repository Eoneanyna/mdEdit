import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { TEST_HOOKS_FLAG } from '@shared/ipc'
import { attachCloseGuard } from './ipc/close-guard'

// 自动化验证时才透传给渲染进程,正常启动不会带上
const testHooksEnabled = process.argv.includes(TEST_HOOKS_FLAG)

/**
 * 窗口图标(标题栏与任务栏)。这与 exe 文件自身的图标是两回事,
 * 不显式指定的话会回落到 Electron 默认图标。
 * macOS 的窗口图标由 .app bundle 决定,无需也不应在此设置。
 */
function windowIcon(): string | undefined {
  if (process.platform === 'darwin') return undefined
  // Windows 用 ico:标题栏取其中 16px 的简化图,任务栏取 32px,都不会糊
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  return app.isPackaged
    ? join(process.resourcesPath, file)
    : join(__dirname, '../../build', file)
}

/**
 * 创建主窗口。开发环境加载 vite dev server,生产环境加载打包后的 HTML。
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 680,
    minHeight: 480,
    show: false,
    icon: windowIcon(),
    backgroundColor: '#ffffff',
    // macOS 使用内嵌式红绿灯按钮,更贴近原生编辑器观感
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: testHooksEnabled ? [TEST_HOOKS_FLAG] : []
    }
  })

  // 等首帧就绪再显示,避免启动白屏
  window.once('ready-to-show', () => window.show())

  // 标题由文档状态驱动(文件名 + 未保存标记),不跟随页面的 <title>
  window.on('page-title-updated', (event) => event.preventDefault())

  // 有未保存改动时拦截关闭
  attachCloseGuard(window)

  // 文档里的外部链接交给系统浏览器,不在应用内新开窗口
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    window.loadURL(devServerUrl)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
