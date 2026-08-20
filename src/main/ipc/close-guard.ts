import { BrowserWindow, dialog, ipcMain } from 'electron'

interface DocState {
  fileName: string | null
  dirty: boolean
}

const docStates = new WeakMap<BrowserWindow, DocState>()
/** 已确认可以关闭的窗口,避免二次拦截造成死循环 */
const allowClose = new WeakSet<BrowserWindow>()

/** 渲染进程超过该时限没回应保存结果,按失败处理,不再阻塞关闭流程 */
const SAVE_TIMEOUT = 20_000

export function updateDocState(window: BrowserWindow, fileName: string | null, dirty: boolean): void {
  docStates.set(window, { fileName, dirty })
}

/** 请渲染进程执行一次保存,等待其回执 */
function requestSave(window: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (saved: boolean): void => {
      clearTimeout(timer)
      ipcMain.off('app:save-result', listener)
      resolve(saved)
    }
    const listener = (_event: Electron.IpcMainEvent, saved: boolean): void => finish(saved)
    const timer = setTimeout(() => finish(false), SAVE_TIMEOUT)

    ipcMain.on('app:save-result', listener)
    window.webContents.send('app:save-request')
  })
}

/**
 * 拦截带未保存改动的窗口关闭,避免内容静默丢失。
 */
export function attachCloseGuard(window: BrowserWindow): void {
  window.on('close', (event) => {
    if (allowClose.has(window)) return

    const state = docStates.get(window)
    if (!state?.dirty) return

    // 对话框是异步的,必须先阻止本次关闭,拿到结果后再决定
    event.preventDefault()

    void (async () => {
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: ['保存', '不保存', '取消'],
        defaultId: 0,
        cancelId: 2,
        message: `「${state.fileName ?? '未命名'}」有未保存的修改`,
        detail: '关闭前是否保存这些修改?'
      })

      if (response === 2) return // 取消关闭

      if (response === 1) {
        allowClose.add(window)
        window.close()
        return
      }

      const saved = await requestSave(window)
      if (!saved) {
        // 保存失败或用户在保存对话框里取消,留在原地让用户处理
        await dialog.showMessageBox(window, {
          type: 'error',
          buttons: ['好'],
          message: '保存未完成',
          detail: '文件没有保存成功,窗口保持打开。'
        })
        return
      }
      allowClose.add(window)
      window.close()
    })()
  })
}
