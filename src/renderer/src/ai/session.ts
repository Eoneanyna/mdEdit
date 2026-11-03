import type { AiTurn } from '@shared/ipc'

const MAX_SAVED_TURNS = 30
function key(workspace: string | null): string { return 'mdedit.ai.session.v1:' + (workspace || 'no-workspace') }

export function loadSession(workspace: string | null): AiTurn[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key(workspace)) || '[]')
    if (!Array.isArray(data)) return []
    return data.filter((t): t is AiTurn =>
      t && typeof t.question === 'string' && typeof t.answer === 'string' &&
      Array.isArray(t.sources) && t.sources.every((s: any) =>
        s && typeof s.id === 'number' && ['local', 'web'].includes(s.type) &&
        typeof s.title === 'string' && typeof s.snippet === 'string' &&
        (s.path === undefined || typeof s.path === 'string') &&
        (s.url === undefined || typeof s.url === 'string')
      )
    ).slice(-MAX_SAVED_TURNS)
  } catch { return [] }
}

export function saveSession(workspace: string | null, turns: AiTurn[]): boolean {
  try {
    // 仅保存问答及来源，不保存请求配置、API Key。
    localStorage.setItem(key(workspace), JSON.stringify(turns.slice(-MAX_SAVED_TURNS)))
    return true
  } catch { return false }
}
