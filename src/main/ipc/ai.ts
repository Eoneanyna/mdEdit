import { BrowserWindow, ipcMain } from 'electron'
import { isAbsolute, relative, resolve } from 'node:path'
import type { AiConfig, AiQueryRequest, Result } from '@shared/ipc'
import { queryAi } from '../ai/query'
import { getRagStatus } from '../ai/search-rag'
import * as store from '../store'
import { guard } from './guard'

export function registerAiIpc(): void {
  const active = new Map<number, AbortController>()
  ipcMain.handle('ai:query', async (event, req: AiQueryRequest) => {
    const id = event.sender.id
    if (active.has(id)) return { ok: false, error: '已有问答进行中，请等待或停止生成' }
    const controller = new AbortController()
    const destroyed = (): void => controller.abort()
    active.set(id, controller)
    event.sender.once('destroyed', destroyed)
    try {
      return await guard(() => queryAi(req, store.getLastWorkspace(), controller.signal,
        req?.requestId ? update => {
          if (!event.sender.isDestroyed()) event.sender.send('ai:event', update)
        } : undefined))
    } finally {
      active.delete(id)
      event.sender.removeListener('destroyed', destroyed)
    }
  })
  ipcMain.handle('ai:cancel', (event) => { active.get(event.sender.id)?.abort() })
  ipcMain.handle('ai:rag-status', () => getRagStatus())
  ipcMain.handle('ai:get-config', () => store.getAiConfig())
  ipcMain.handle('ai:set-config', (_event, config: AiConfig) => {
    store.setAiConfig(config)
  })
  ipcMain.handle('ai:open-local', (event, filePath: string): Promise<Result<null>> => guard(() => {
    const workspace = store.getLastWorkspace()
    if (!workspace || typeof filePath !== 'string') throw new Error('请先打开工作区')
    const rel = relative(resolve(workspace), resolve(filePath))
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('来源文件不在当前工作区')
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('窗口已关闭')
    event.sender.send('app:open-file', filePath)
    win.focus()
    return null
  }))
}
