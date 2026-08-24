import { BrowserWindow, dialog } from 'electron'

/**
 * 以发起请求的窗口为父窗口弹出系统对话框。
 *
 * 拿不到父窗口时(理论上不该发生,但 fromWebContents 的返回值可空)
 * 退化为无父对话框 —— 此时它不是模态的,但至少功能可用。
 * 把这层判断收在这里,新增对话框时不会有人忘记处理。
 */
function ownerOf(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export function showOpenDialog(
  event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const owner = ownerOf(event)
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

export function showSaveDialog(
  event: Electron.IpcMainInvokeEvent,
  options: Electron.SaveDialogOptions
): Promise<Electron.SaveDialogReturnValue> {
  const owner = ownerOf(event)
  return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
}

/** 选中单个路径,取消或未选时返回 null */
export async function pickOnePath(
  event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions
): Promise<string | null> {
  const result = await showOpenDialog(event, options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]!
}
