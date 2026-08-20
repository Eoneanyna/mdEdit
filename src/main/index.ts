import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { buildAppMenu } from './menu'
import { pickFileArg, setPendingFile } from './pending-file'
import { createMainWindow } from './window'

// Windows 上任务栏分组与通知需要显式声明 AppUserModelId
app.setAppUserModelId('com.mdedit.app')

/** 把文件送到已打开的窗口;窗口还没准备好则先暂存 */
function deliverFile(filePath: string): void {
  const [window] = BrowserWindow.getAllWindows()
  if (!window) {
    setPendingFile(filePath)
    return
  }
  if (window.isMinimized()) window.restore()
  window.focus()
  window.webContents.send('app:open-file', filePath)
}

// macOS 通过事件而非命令行传递文件,且可能早于 ready 触发,需尽早注册
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  deliverFile(filePath)
})

// 编辑器同时打开多个实例会造成同一文件的写入竞争,这里限制为单实例
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // 冷启动:双击文件时路径就在自己的启动参数里
  setPendingFile(pickFileArg(process.argv))

  // 热启动:应用已在运行时再次双击文件,参数由第二个实例转交过来
  app.on('second-instance', (_event, argv) => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()

    const filePath = pickFileArg(argv)
    if (filePath) window.webContents.send('app:open-file', filePath)
  })

  app.whenReady().then(() => {
    registerIpc()
    buildAppMenu()
    createMainWindow()

    // macOS:点击 Dock 图标时若无窗口则重建
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  // macOS 习惯是关闭窗口后应用驻留,其他平台直接退出
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
