import { app, BrowserWindow, ipcMain } from 'electron'
import { isAbsolute, relative, resolve, join } from 'node:path'
import type { AiConfig, AiPrivacySettings, AiQueryRequest, AiSource, Result } from '@shared/ipc'
import { queryAi } from '../ai/query'
import { getRagStatus } from '../ai/search-rag'
import * as store from '../store'
import { guard } from './guard'
import { AiProfileStore, enforceLocalPrivacy } from '../ai/profile'
import { restartRagProcess } from '../ai/rag-process'
import { validateRequest } from '../ai/conversation'

export function registerAiIpc(): void {
  const profile = new AiProfileStore(join(app.getPath('userData'), 'ai'))
  const active = new Map<number, AbortController>()
  ipcMain.handle('ai:query', async (event, req: AiQueryRequest) => {
    const id = event.sender.id
    if (active.has(id)) return { ok: false, error: '已有问答进行中，请等待或停止生成' }
    const controller = new AbortController()
    const destroyed = (): void => controller.abort()
    active.set(id, controller)
    event.sender.once('destroyed', destroyed)
    try {
      return await guard(async () => {
        const request = validateRequest(req)
        const privacy = profile.getPrivacy()
        enforceLocalPrivacy(request, privacy)
        const preferences = privacy.personalize ? profile.get().markdown : undefined
        const result = await queryAi(request, store.getLastWorkspace(), controller.signal,
          request.requestId ? update => { if (!event.sender.isDestroyed()) event.sender.send('ai:event', update) } : undefined, preferences)
        controller.signal.throwIfAborted()
        try { result.learnedPreferences = profile.learn(request.question) }
        catch { result.notices.push('本轮回答已完成，但个人偏好未能保存。') }
        return result
      })
    } finally {
      active.delete(id)
      event.sender.removeListener('destroyed', destroyed)
    }
  })
  ipcMain.handle('ai:cancel', (event) => { active.get(event.sender.id)?.abort() })
  ipcMain.handle('ai:rag-status', () => getRagStatus())
  ipcMain.handle('ai:rag-restart', () => guard(async () => {
    if (active.size) throw new Error('请在当前问答结束后重启检索服务')
    await restartRagProcess(); return null
  }))
  ipcMain.handle('ai:profile-get', () => profile.get())
  ipcMain.handle('ai:privacy-set', (_event, settings: AiPrivacySettings) => profile.setPrivacy(settings))
  ipcMain.handle('ai:preferences-save', (_event, markdown: string, revision: string) => profile.save(markdown, revision))
  ipcMain.handle('ai:preferences-clear', () => profile.clear())
  ipcMain.handle('ai:preferences-undo', () => profile.undoLearning())
  ipcMain.handle('ai:get-config', () => store.getAiConfig())
  ipcMain.handle('ai:set-config', (_event, config: AiConfig) => {
    store.setAiConfig(config)
  })
  ipcMain.handle('ai:open-local', (event, filePath: string, source?: AiSource): Promise<Result<null>> => guard(() => {
    const workspace = store.getLastWorkspace()
    if (!workspace || typeof filePath !== 'string') throw new Error('请先打开工作区')
    const rel = relative(resolve(workspace), resolve(filePath))
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('来源文件不在当前工作区')
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('窗口已关闭')
    event.sender.send('app:open-file', filePath, source && source.type === 'local' && source.path === filePath ? source : undefined)
    win.focus()
    return null
  }))
}
