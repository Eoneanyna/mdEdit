// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  readFileSync: vi.fn(), writeFileSync: vi.fn(), available: vi.fn(() => true),
  encrypt: vi.fn((text: string) => Buffer.from('encrypted:' + text)),
  decrypt: vi.fn((data: Buffer) => data.toString().replace('encrypted:', ''))
}))
vi.mock('node:fs', () => ({ readFileSync: mocks.readFileSync, writeFileSync: mocks.writeFileSync }))
vi.mock('electron', () => ({
  app: { getPath: () => '/fake-user-data' },
  safeStorage: { isEncryptionAvailable: mocks.available, encryptString: mocks.encrypt,
    decryptString: mocks.decrypt, getSelectedStorageBackend: () => 'test' }
}))
const config = { provider: 'openrouter' as const, model: 'openrouter/free', apiKey: 'dummy-key',
  baseUrl: 'https://openrouter.ai/api/v1', useLocal: true, useWeb: false }
afterEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.available.mockReturnValue(true) })
it('encrypts keys in persisted settings and decrypts only for configuration reads', async () => {
  mocks.readFileSync.mockReturnValue('{}')
  const store = await import('./store')
  store.setAiConfig(config)
  const saved = mocks.writeFileSync.mock.calls[0][1]
  expect(saved).not.toContain('dummy-key')
  expect(JSON.parse(saved).aiConfig.apiKey).toBeUndefined()
  expect(store.getAiConfig().apiKey).toBe('dummy-key')
})
it('persists reading progress per file and normalizes bad values', async () => {
  mocks.readFileSync.mockReturnValue('{}')
  const store = await import('./store')
  store.setReadingProgress('/docs/a.md', { ratio: 2.5, cursor: 12, updatedAt: 0 })
  expect(store.getReadingProgress('/docs/a.md')).toMatchObject({ ratio: 1, cursor: 12 })

  store.setReadingProgress('/docs/a.md', { ratio: NaN, cursor: -3, updatedAt: 0 })
  expect(store.getReadingProgress('/docs/a.md')).toMatchObject({ ratio: 0, cursor: null })

  store.setReadingProgress('/docs/b.md', { ratio: 0.4, cursor: null, updatedAt: 0 })
  expect(store.getReadingProgress('/docs/b.md')).toMatchObject({ ratio: 0.4, cursor: null })
  expect(store.getReadingProgress('')).toBeNull()
})
it('reports persistence errors and does not cache unsuccessful saves', async () => {
  mocks.readFileSync.mockReturnValue('{}')
  const store = await import('./store')
  mocks.writeFileSync.mockImplementationOnce(() => { throw new Error('disk full') })
  expect(() => store.setAiConfig(config)).toThrow('disk full')
  expect(store.getAiConfig().apiKey).toBe('')
  mocks.available.mockReturnValue(false)
  expect(() => store.setAiConfig(config)).toThrow('安全存储')
})
