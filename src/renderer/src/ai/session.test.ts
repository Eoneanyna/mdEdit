import { beforeEach, expect, it } from 'vitest'
import { loadSession, saveSession } from './session'

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
