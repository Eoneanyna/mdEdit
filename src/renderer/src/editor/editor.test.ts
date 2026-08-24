import { describe, expect, it, vi } from 'vitest'
import { withCrepeEditor } from '../test-utils'

/**
 * 序列化保真回归:这是产品的核心卖点「保存不改写原有格式」。
 * 每个用例都是真实 Crepe 编辑器跑 parse → ProseMirror → stringify 的完整回路。
 *
 * 两类断言:
 * - 恒等:fixture 已是序列化器的稳定形,「打开→直接保存」必须零改动
 * - 归一:不稳定的写法只允许变成唯一稳定形,且反复保存不再变化(幂等)
 */

const STABLE_FIXTURES: Array<[string, string]> = [
  [
    '标题 + 嵌套列表 + 行内强调',
    '# 标题\n\n- 项一\n- 项二\n  - 嵌套项\n\n正文 **粗体** 与 *斜体*。\n'
  ],
  ['任务列表', '- [ ] 待办\n- [x] 已完成\n'],
  ['行内代码 + 链接', '行内 `代码` 与 [链接](https://example.com/x)。\n'],
  ['多行引用', '> 引用第一行\n> 引用第二行\n'],
  ['有序列表', '1. 第一\n2. 第二\n'],
  ['代码块', '```js\nlet a = 1\n```\n'],
  [
    'CJK 按显示宽度对齐的表格',
    '| 里程碑 | 内容   | 状态 |\n| ------ | ------ | ---- |\n| M1     | 脚手架 | 完成 |\n'
  ],
  [
    '完整文档:标题 + 列表 + 表格混排',
    '# 标题\n\n- 项一\n- 项二\n  - 嵌套项\n\n正文 **粗体** 与 *斜体*。\n\n| 里程碑 | 内容   | 状态 |\n| ------ | ------ | ---- |\n| M1     | 脚手架 | 完成 |\n'
  ]
]

const MESSY_INPUTS: string[] = [
  '* 星号列表\n* 第二项\n',
  '段落一\n\n\n段落二',
  '| 里程碑 | 内容             | 状态 |\n| ------ | ---------------- | ---- |\n| M1     | 脚手架           | 完成 |\n',
  'abc',
  'abc\n\n\n',
  '混排 * 星\n\n> 引\n\n```py\nx = 1\n```\n'
]

describe('编辑器序列化保真', () => {
  for (const [label, fixture] of STABLE_FIXTURES) {
    it(`恒等:${label}`, async () => {
      await withCrepeEditor(fixture, (editor) => {
        expect(editor.getMarkdown()).toBe(fixture)
      })
    })
  }

  it('星号列表归一为短横线', async () => {
    await withCrepeEditor('', (editor) => {
      editor.setMarkdown('* 星号列表\n* 第二项\n')
      expect(editor.getMarkdown()).toBe('- 星号列表\n- 第二项\n')
    })
  })

  it('连续空行收敛为一个,空行不会变成 <br />', async () => {
    await withCrepeEditor('', (editor) => {
      editor.setMarkdown('段落一\n\n\n段落二')
      const out = editor.getMarkdown()
      expect(out).toBe('段落一\n\n段落二\n')
      expect(out).not.toContain('<br')
    })
  })

  it('文末换行统一为单个', async () => {
    await withCrepeEditor('', (editor) => {
      editor.setMarkdown('abc')
      expect(editor.getMarkdown()).toBe('abc\n')

      editor.setMarkdown('abc\n\n\n')
      expect(editor.getMarkdown()).toBe('abc\n')
    })
  })

  it('宽表格分隔行归一为列宽(CJK 感知),单元格按显示宽度补齐', async () => {
    await withCrepeEditor('', (editor) => {
      editor.setMarkdown(
        '| 里程碑 | 内容             | 状态 |\n| ------ | ---------------- | ---- |\n| M1     | 脚手架           | 完成 |\n'
      )
      expect(editor.getMarkdown()).toBe(
        '| 里程碑 | 内容   | 状态 |\n| ------ | ------ | ---- |\n| M1     | 脚手架 | 完成 |\n'
      )
    })
  })

  for (const input of MESSY_INPUTS) {
    it('幂等:第二次保存不再改变内容', async () => {
      await withCrepeEditor(input, (editor) => {
        const once = editor.getMarkdown()
        editor.setMarkdown(once)
        expect(editor.getMarkdown()).toBe(once)
      })
    })
  }
})

describe('编辑器行为', () => {
  it('初始值可读', async () => {
    await withCrepeEditor('初始\n', (editor) => {
      expect(editor.getMarkdown()).toBe('初始\n')
    })
  })

  it('setMarkdown 后触发 onChange,内容为最新序列化结果', async () => {
    await withCrepeEditor('旧\n', async (editor) => {
      const seen: string[] = []
      editor.onChange((markdown) => seen.push(markdown))
      editor.setMarkdown('新\n')
      // markdownUpdated 是批处理派发,不保证同步,等待其落地
      await vi.waitFor(() => {
        expect(seen.length).toBeGreaterThan(0)
      })
      expect(seen.at(-1)).toBe('新\n')
    })
  })

  it('focus 落在 ProseMirror 编辑区', async () => {
    await withCrepeEditor('', (editor) => {
      editor.focus()
      expect(document.activeElement?.classList.contains('ProseMirror')).toBe(true)
    })
  })
})
