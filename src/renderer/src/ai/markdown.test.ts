import { expect, it, vi } from 'vitest'
import { renderAnswer } from './markdown'

it('renders headings, emphasis, lists, tables and code as DOM', () => {
  const host = document.createElement('div')
  renderAnswer(host, '## 标题\n\n**粗体**与 `代码`\n\n- 项目\n\n| 列 | 值 |\n|---|---|\n| 甲 | 乙 |\n\n~~~ts\nconst x = 1\n~~~')
  expect(host.querySelector('h2')?.textContent).toBe('标题')
  expect(host.querySelector('strong')?.textContent).toBe('粗体')
  expect(host.querySelector('li')?.textContent).toContain('项目')
  expect(host.querySelectorAll('td')).toHaveLength(2)
  expect(host.querySelector('pre code')?.textContent).toBe('const x = 1')
})
it('never executes raw HTML, unsafe URLs or automatically fetches images', () => {
  const host = document.createElement('div')
  renderAnswer(host, '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[坏链接](javascript:alert%281%29)\n\n![远程图](https://example.test/tracker.png)')
  expect(host.querySelector('script,img,iframe')).toBeNull()
  expect(host.querySelector('a')).toBeNull()
  expect(host.textContent).toContain('远程图')
})
it('opens only an explicit HTTP link through the external API', () => {
  const openExternal = vi.fn().mockResolvedValue({ ok: true, value: null })
  Object.defineProperty(window, 'api', { configurable: true, value: { openExternal } })
  const host = document.createElement('div')
  renderAnswer(host, '[链接](https://example.test/docs)')
  host.querySelector('a')!.click()
  expect(openExternal).toHaveBeenCalledWith('https://example.test/docs')
})
it('makes valid citation numbers clickable but leaves code and unknown numbers unchanged', () => {
  const host = document.createElement('div')
  const source = { id: 1, type: 'local' as const, title: '笔记.md', snippet: '依据' }
  const open = vi.fn()
  renderAnswer(host, '结论 [1]。无效编号 [9]。代码 `[1]`。', { sources: [source], open })
  expect(host.querySelectorAll('.ai-citation-link')).toHaveLength(1)
  host.querySelector<HTMLButtonElement>('.ai-citation-link')!.click()
  expect(open).toHaveBeenCalledWith(source)
  expect(host.querySelector('code')?.textContent).toBe('[1]')
})
