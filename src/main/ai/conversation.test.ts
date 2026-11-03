import { describe, expect, it } from 'vitest'
import { boundedHistory, validateRequest } from './conversation'
import type { AiQueryRequest } from '@shared/ipc'

const req: AiQueryRequest = { provider: 'ollama', model: 'test', question: '问题', useLocal: true, useWeb: false }
describe('conversation boundaries', () => {
  it('retains the newest six complete turns without source payloads', () => {
    const turns = Array.from({ length: 9 }, (_, i) => ({ question: String(i), answer: '回答', sources: [] }))
    expect(boundedHistory(turns).map(t => t.question)).toEqual(['3', '4', '5', '6', '7', '8'])
  })
  it('limits context by characters and validates roles through a fixed turn shape', () => {
    expect(boundedHistory([{ question: 'x', answer: 'x'.repeat(25000), sources: [] }])).toEqual([])
    expect(() => validateRequest({ ...req, history: [{}] } as AiQueryRequest)).toThrow('历史格式')
    expect(() => validateRequest({ ...req, question: ' '.repeat(5) })).toThrow('请输入')
    expect(() => validateRequest({ ...req, question: 'x'.repeat(4001) })).toThrow('4000')
  })
})
