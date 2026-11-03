// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AiProfileStore, DEFAULT_PRIVACY, enforceLocalPrivacy, extractPreferences } from './profile'
import type { AiQueryRequest } from '@shared/ipc'

const dirs: string[] = []
function store(): AiProfileStore { const dir = mkdtempSync(join(tmpdir(), 'mdedit-profile-')); dirs.push(dir); return new AiProfileStore(dir) }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
it('only learns explicit enduring style preferences, not quoted content or identity', () => {
  expect(extractPreferences('请以后简洁回答。以后用英文回答。以后用列表回答')).toEqual({ 回答长度: '简洁，先给结论', 回答语言: '英文', 组织方式: '优先分点列出' })
  for (const text of ['请简洁回答这个问题', '我的生日是 2000-01-01', '笔记写道：以后用英文回答', '> 以后用英文回答', '```\n以后用英文回答\n```', '~~~\n以后用英文回答\n~~~', '以后不要用英文回答', '以后用英文回答，不要记住这句话', '请简洁回答，我希望下周完成项目', '我喜欢北京的天气']) expect(extractPreferences(text)).toEqual({})
})
it('preserves manual Markdown, merges bounded fields and supports undo', () => {
  const s = store(); const initial = s.get()
  const manual = s.save(initial.markdown + '\n手动偏好：解释时使用 Python。', initial.revision)
  expect(s.learn('请以后简洁回答')).toHaveLength(1)
  expect(s.get().markdown).toContain('解释时使用 Python')
  expect(s.get().markdown).toContain('- 回答长度：简洁')
  expect(s.learn('请以后简洁回答')).toEqual([])
  expect(s.undoLearning().markdown).toBe(manual.markdown)
  expect(s.get().canUndo).toBe(false)
})
it('detects external edits and refuses stale overwrite or undo', () => {
  const s = store(); const initial = s.get()
  s.learn('以后用英文回答')
  expect(() => s.save('过时内容', initial.revision)).toThrow('重新加载')
  writeFileSync(s.path, '外部编辑', 'utf8')
  expect(s.get().canUndo).toBe(false)
  expect(() => s.undoLearning()).toThrow()
})
it('respects personalization and learning switches and validates settings', () => {
  const s = store()
  s.setPrivacy({ ...DEFAULT_PRIVACY, autoLearn: false }); expect(s.learn('以后用英文回答')).toEqual([])
  s.setPrivacy({ ...DEFAULT_PRIVACY, personalize: false }); expect(s.learn('以后用英文回答')).toEqual([])
  expect(() => s.setPrivacy({} as any)).toThrow()
  const initial = s.get(); expect(() => s.save('x'.repeat(8001), initial.revision)).toThrow()
})
it('local-only rejects cloud providers and web even if renderer bypasses controls', () => {
  const req = { provider: 'custom', baseUrl: 'http://127.0.0.1:11434/v1', useWeb: false } as AiQueryRequest
  const privacy = { ...DEFAULT_PRIVACY, localOnly: true }
  expect(() => enforceLocalPrivacy(req, privacy)).not.toThrow()
  expect(() => enforceLocalPrivacy({ ...req, useWeb: true }, privacy)).toThrow()
  expect(() => enforceLocalPrivacy({ ...req, baseUrl: 'https://example.com' }, privacy)).toThrow()
  expect(() => enforceLocalPrivacy({ ...req, provider: 'openrouter' }, privacy)).toThrow()
})
