import { beforeEach, expect, it } from 'vitest'
import { loadSession, saveSession, loadSessions, saveSessions, newSession, emptySessions, clearAllAiHistory, deleteSavedSession, exportSession } from './session'

beforeEach(() => localStorage.clear())
it('isolates workspace histories and supports clearing', () => {
  const turns = [{ question: '问题', answer: '答案', sources: [] }]
  saveSession('A', turns)
  expect(loadSession('A')).toEqual(turns)
  expect(loadSession('B')).toEqual([])
  saveSession('A', [])
  expect(loadSession('A')).toEqual([])
})
it('ignores corrupted storage and caps saved history', () => {
  localStorage.setItem('mdedit.ai.session.v1:A', '{broken')
  expect(loadSession('A')).toEqual([])
  saveSession('A', Array.from({ length: 40 }, (_, i) => ({ question: String(i), answer: '答', sources: [] })))
  expect(loadSession('A')).toHaveLength(30)
  expect(loadSession('A')[0].question).toBe('10')
})
it('migrates legacy data, preserves multiple conversations and active selection', () => {
  localStorage.setItem('mdedit.ai.session.v1:A', JSON.stringify([{ question: '旧问题', answer: '旧回答', sources: [] }]))
  const data = loadSessions('A'); const first = data.activeId
  expect(data.sessions[0].title).toBe('旧问题')
  expect(localStorage.getItem('mdedit.ai.session.v1:A')).toBeNull()
  const second = newSession(); data.sessions.push(second); data.activeId = second.id
  expect(saveSessions('A', data)).toBe(true)
  expect(loadSessions('A').activeId).toBe(second.id)
  expect(loadSessions('A').sessions.find(s => s.id === first)?.turns).toHaveLength(1)
})
it('disabled persistence neither loads nor writes stored history; clearing leaves other app data', () => {
  saveSessions('A', emptySessions())
  const before = localStorage.getItem('mdedit.ai.sessions.v2:A')
  expect(loadSessions('A', false).sessions[0].turns).toEqual([])
  saveSessions('A', emptySessions(), false)
  expect(localStorage.getItem('mdedit.ai.sessions.v2:A')).toBe(before)
  localStorage.setItem('editor.setting', 'keep')
  clearAllAiHistory()
  expect(localStorage.getItem('editor.setting')).toBe('keep')
  expect(localStorage.getItem('mdedit.ai.sessions.v2:A')).toBeNull()
})
it('exports questions, answers and source snapshots as Markdown', () => {
  const s = newSession(); s.title = '学习笔记'
  s.turns = [{ question: 'RAG?', answer: '答案 [1]', sources: [{ id: 1, type: 'web', title: '网页', url: 'https://example.com', snippet: '正文\n下一行' }] }]
  expect(exportSession(s)).toContain('https://example.com')
  expect(exportSession(s)).toContain('> 正文\n> 下一行')
})
it('explicitly deletes a previously saved session even when subsequent saves are disabled', () => {
  const data = emptySessions(); data.sessions[0].turns = [{ question: '待删除', answer: '引用快照', sources: [] }]
  saveSessions('A', data)
  saveSessions('A', emptySessions(), false)
  expect(deleteSavedSession('A', data.activeId)).toBe(true)
  expect(JSON.stringify(loadSessions('A'))).not.toContain('待删除')
})
