import type { AiSource, AiWebSearchStatus } from '@shared/ipc'

const MODE_KEY = 'mdedit.ai.mode.v1'
export type AnswerMode = 'auto' | 'notes' | 'notes-web' | 'general'
export function loadAnswerMode(useWeb: boolean): AnswerMode {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === 'auto' || saved === 'notes' || saved === 'notes-web' || saved === 'general') return saved
  } catch {}
  return useWeb ? 'notes-web' : 'auto'
}
export function saveAnswerMode(mode: AnswerMode): boolean {
  try { localStorage.setItem(MODE_KEY, mode); return true } catch { return false }
}
export function webStatusLabel(status: AiWebSearchStatus | undefined, sources: AiSource[]): string {
  const docs = sources.filter(s => s.type !== 'web').length
  const prefix = `文档片段 ${docs} · `
  if (!status) return prefix + (sources.some(s => s.type === 'web') ? '包含网页来源（旧记录未保存检索状态）' : '旧记录未保存联网状态')
  const time = status.searchedAt ? ' · 搜索时间：' + new Date(status.searchedAt).toLocaleString() : ''
  if (status.state === 'disabled') return prefix + '未联网（本轮未启用）'
  if (status.state === 'unavailable') return prefix + '联网失败：搜索服务不可用或访问受限' + time
  if (status.state === 'empty') return prefix + `已联网，无相关网页（${status.candidates} 个候选未入选）` + time
  return prefix + `联网：${status.candidates} 个候选 → 选用 ${status.selected} 个网页（正文 ${status.pages}，摘要 ${status.summaries}）` + time
}
