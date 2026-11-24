import { beforeEach, expect, it } from 'vitest'
import { loadAnswerMode, saveAnswerMode, webStatusLabel } from './web-status'
import type { AiWebSearchStatus } from '@shared/ipc'
beforeEach(() => localStorage.clear())
it('remembers an explicitly selected mode without saving model credentials', () => {
  expect(loadAnswerMode(false)).toBe('auto')
  saveAnswerMode('notes-web'); expect(loadAnswerMode(false)).toBe('notes-web')
  saveAnswerMode('general'); expect(loadAnswerMode(true)).toBe('general')
  expect(Object.keys(localStorage)).toEqual(['mdedit.ai.mode.v1'])
})
it('distinguishes disabled, failed, filtered and successful searches', () => {
  const s: AiWebSearchStatus = { state: 'disabled', query: '', candidates: 4, selected: 2, pages: 1, summaries: 1, attempts: [] }
  expect(webStatusLabel(s, [])).toContain('未联网')
  expect(webStatusLabel({ ...s, state: 'unavailable' }, [])).toContain('联网失败')
  expect(webStatusLabel({ ...s, state: 'empty' }, [])).toContain('已联网，无相关网页')
  expect(webStatusLabel({ ...s, state: 'success' }, [])).toContain('选用 2 个网页')
  expect(webStatusLabel(undefined, [])).toContain('旧记录未保存联网状态')
})
