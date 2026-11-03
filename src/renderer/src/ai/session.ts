import type { AiSource, AiTurn, AiWebSearchStatus } from '@shared/ipc'
import { webStatusLabel } from './web-status'

export interface AiSession { id: string; title: string; updatedAt: number; turns: AiTurn[] }
export interface SessionCollection { activeId: string; sessions: AiSession[] }
const PREFIX = 'mdedit.ai.sessions.v2:'
const LEGACY = 'mdedit.ai.session.v1:'
const key = (workspace: string | null): string => PREFIX + (workspace || 'no-workspace')
const legacyKey = (workspace: string | null): string => LEGACY + (workspace || 'no-workspace')

function validSource(s: AiSource): boolean {
  return !!s && Number.isInteger(s.id) && ['local', 'web', 'context'].includes(s.type) &&
    typeof s.title === 'string' && typeof s.snippet === 'string' &&
    (s.path === undefined || typeof s.path === 'string') && (s.url === undefined || typeof s.url === 'string') &&
    (s.startLine === undefined || Number.isInteger(s.startLine) && s.startLine >= 1) &&
    (s.endLine === undefined || Number.isInteger(s.endLine) && s.endLine >= (s.startLine || 1)) &&
    (s.heading === undefined || typeof s.heading === 'string') && (s.documentHash === undefined || typeof s.documentHash === 'string')
}
function validTurns(data: unknown): AiTurn[] {
  if (!Array.isArray(data)) return []
  return data.filter((t): t is AiTurn => t && typeof t.question === 'string' && typeof t.answer === 'string' &&
    Array.isArray(t.sources) && t.sources.every(validSource)).slice(-30).map(turn => ({ ...turn,
      webSearch: validWebStatus(turn.webSearch) ? turn.webSearch : undefined }))
}
function validWebStatus(status: AiWebSearchStatus | undefined): status is AiWebSearchStatus {
  return !!status && ['disabled', 'success', 'empty', 'unavailable'].includes(status.state) && typeof status.query === 'string' && status.query.length <= 1000 &&
    [status.candidates, status.selected, status.pages, status.summaries].every(n => Number.isInteger(n) && n >= 0) &&
    (status.searchedAt === undefined || typeof status.searchedAt === 'string' && Number.isFinite(Date.parse(status.searchedAt))) &&
    Array.isArray(status.attempts) && status.attempts.length <= 4 && status.attempts.every(attempt => attempt &&
      ['DuckDuckGo', 'Bing'].includes(attempt.engine) && ['ok', 'empty', 'filtered', 'error'].includes(attempt.outcome))
}
export function newSession(): AiSession {
  return { id: crypto.randomUUID(), title: '新对话', updatedAt: Date.now(), turns: [] }
}
export function emptySessions(): SessionCollection {
  const session = newSession()
  return { activeId: session.id, sessions: [session] }
}
export function loadSessions(workspace: string | null, persist = true): SessionCollection {
  if (!persist) return emptySessions()
  try {
    const saved = JSON.parse(localStorage.getItem(key(workspace)) || 'null')
    if (saved && Array.isArray(saved.sessions)) {
      const sessions: AiSession[] = saved.sessions.filter((s: AiSession) => s && typeof s.id === 'string' && typeof s.title === 'string' &&
        Number.isFinite(s.updatedAt) && Array.isArray(s.turns))
        .map((s: AiSession) => ({ id: s.id, title: s.title.slice(0, 100), updatedAt: s.updatedAt, turns: validTurns(s.turns) }))
      if (sessions.length) return { sessions, activeId: sessions.some(s => s.id === saved.activeId) ? saved.activeId : sessions[0].id }
    }
    const turns = validTurns(JSON.parse(localStorage.getItem(legacyKey(workspace)) || '[]'))
    const initial = emptySessions()
    if (turns.length) {
      initial.sessions[0].turns = turns
      initial.sessions[0].title = turns[0].question.slice(0, 30)
      saveSessions(workspace, initial)
    }
    return initial
  } catch { return emptySessions() }
}
export function saveSessions(workspace: string | null, collection: SessionCollection, persist = true): boolean {
  if (!persist) return true
  try {
    const sessions = collection.sessions.map(s => ({ id: s.id, title: s.title.slice(0, 100), updatedAt: s.updatedAt, turns: validTurns(s.turns) }))
    localStorage.setItem(key(workspace), JSON.stringify({ activeId: collection.activeId, sessions }))
    localStorage.removeItem(legacyKey(workspace))
    return true
  } catch { return false }
}
export function clearAllAiHistory(): void {
  for (const name of Object.keys(localStorage)) if (name.startsWith(PREFIX) || name.startsWith(LEGACY)) localStorage.removeItem(name)
}
/** 显式删除独立于“是否继续保存”，关闭保存后仍可删除旧记录。 */
export function deleteSavedSession(workspace: string | null, id: string): boolean {
  const data = loadSessions(workspace)
  if (!data.sessions.some(s => s.id === id)) return true
  data.sessions = data.sessions.filter(s => s.id !== id)
  if (!data.sessions.length) return saveSessions(workspace, emptySessions())
  if (data.activeId === id) data.activeId = data.sessions[0].id
  return saveSessions(workspace, data)
}
export function exportSession(session: AiSession): string {
  return '# ' + session.title + '\n\n' + session.turns.map(turn =>
    '## 用户\n\n' + turn.question + '\n\n## 助手\n\n' + turn.answer +
    (turn.webSearch ? '\n\n> 检索记录：' + webStatusLabel(turn.webSearch, turn.sources) + '\n> 联网查询：' + (turn.webSearch.query || '未发起').replace(/\n/g, ' ') : '') +
    (turn.sources.length ? '\n\n### 本轮来源\n\n' + turn.sources.map(s => '- [' + s.id + '] ' + s.title +
      (s.url ? ' — ' + s.url : s.path ? ' — ' + s.path : '（编辑快照）') +
      (s.startLine ? ' L' + s.startLine + '–' + s.endLine : '') + '\n\n> ' + s.snippet.replace(/\n/g, '\n> ')).join('\n\n') : '')
  ).join('\n\n---\n\n') + '\n'
}
// 兼容旧调用及迁移测试。
export function loadSession(workspace: string | null): AiTurn[] {
  const data = loadSessions(workspace)
  return data.sessions.find(s => s.id === data.activeId)!.turns
}
export function saveSession(workspace: string | null, turns: AiTurn[]): boolean {
  const data = loadSessions(workspace)
  data.sessions.find(s => s.id === data.activeId)!.turns = turns
  return saveSessions(workspace, data)
}
