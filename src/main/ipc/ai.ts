import { ipcMain, shell } from 'electron'
import { searchLocalMd } from '../ai/search-local'
import { ragSearch } from '../ai/search-rag'
import { searchWeb } from '../ai/search-web'
import { callOpenAICompat } from '../ai/providers/openai-compat'
import { getLastWorkspace } from '../store'
import * as store from '../store'

const DEFAULT_CONFIG = {
  provider: 'openrouter' as const,
  model: 'deepseek/deepseek-chat-v3-0324:free',
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  useLocal: true,
  useWeb: false
}

function buildPrompt(question: string, context: string): { system: string, user: string } {
  const system = `你是一个本地知识助手。你的任务是基于用户提供的「本地文档片段」和「网页搜索结果」来回答问题。

规则：
1. 优先使用「本地文档片段」中的内容回答。如果答案来源于本地文档，必须在对应句子后标注 [1]、[2] 等编号。
2. 如果同时参考了网页结果，也用对应编号标注。
3. 如果提供的资料中没有相关信息，诚实地说明「未在本地文档和搜索结果中找到相关内容」，再给出你认为合理的回答（此时可不强制标注）。
4. 回答要简洁、直接，重点放在解决用户的问题上。
5. 不要在回答末尾重新列出完整的参考文献列表，由系统统一展示。`
  const user = `问题：${question}\n\n${context || '（无可用资料）'}\n\n请基于以上资料回答。`
  return { system, user }
}

export function registerAiIpc(): void {
  ipcMain.handle('ai:query', async (_e, req: any) => {
    try {
      const workspace = getLastWorkspace()
      const sources: any[] = []
      let idx = 1
      let context = ''

      if (req.useLocal && workspace) {
        // 优先走本地 RAG 服务(混合检索),服务不在则回退关键词搜索
        const local = (await ragSearch(req.question, workspace)) ?? (await searchLocalMd(req.question, workspace))
        for (const s of local) {
          sources.push({ id: idx, type: 'local', title: s.rel, path: s.path, snippet: s.snippet })
          context += `\n[${idx}] 本地文档 ${s.rel}\n片段：${s.snippet}\n`
          idx++
        }
      }

      if (req.useWeb) {
        const web = await searchWeb(req.question)
        for (const w of web) {
          sources.push({ id: idx, type: 'web', title: w.title, url: w.url, snippet: w.description })
          context += `\n[${idx}] 网页 ${w.title} (${w.url})\n摘要：${w.description}\n`
          idx++
        }
      }

      const { system, user } = buildPrompt(req.question, context)
      const answer = await callOpenAICompat(req, system, user)
      return { ok: true, value: { answer, sources } }
    } catch (err: any) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('ai:get-config', async () => {
    try {
      const cfg = (store as any).getAiConfig ? (store as any).getAiConfig() : null
      return cfg || DEFAULT_CONFIG
    } catch {
      return DEFAULT_CONFIG
    }
  })

  ipcMain.handle('ai:set-config', async (_e, config: any) => {
    try {
      if ((store as any).setAiConfig) {
        ;(store as any).setAiConfig(config)
      }
    } catch {}
  })

  ipcMain.handle('ai:get-workspace', async () => {
    try {
      return getLastWorkspace()
    } catch {
      return null
    }
  })

  ipcMain.handle('ai:open-external', async (_e, url: string) => {
    try {
      await shell.openExternal(url)
    } catch {}
  })

  ipcMain.handle('ai:open-local', async (_e, filePath: string) => {
    try {
      const { BrowserWindow } = await import('electron')
      const wins = BrowserWindow.getAllWindows()
      if (wins[0]) {
        wins[0].webContents.send('app:open-file', filePath)
        if (wins[0].isMinimized()) wins[0].restore()
        wins[0].focus()
      }
    } catch {}
  })
}
