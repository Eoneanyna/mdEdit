import { describe, expect, it } from 'vitest'
import { markdownToText } from './md-to-text'

describe('markdownToText', () => {
  it('标题按层级编号,一二级带下划线', () => {
    const text = markdownToText('# 第一章\n\n## 小节\n\n### 细目\n\n## 又一节\n\n# 第二章\n')
    expect(text).toContain('1 第一章')
    expect(text).toContain('1.1 小节')
    expect(text).toContain('1.1.1 细目')
    // 同级递增,更深的层级要归零
    expect(text).toContain('1.2 又一节')
    expect(text).toContain('2 第二章')
  })

  it('下划线长度按显示宽度而非字符数', () => {
    const [label, underline] = markdownToText('# 中文').split('\n')
    // "1 中文" = 1 + 空格 + 2*2 = 6 列
    expect(label).toBe('1 中文')
    expect(underline).toBe('='.repeat(6))
  })

  it('剥掉行内标记但保留文字', () => {
    expect(markdownToText('这是 **粗体** 与 `代码`。\n').trim()).toBe('这是 粗体 与 代码。')
  })

  it('链接保留地址,自动链接不重复', () => {
    expect(markdownToText('见 [文档](https://a.dev)。\n').trim()).toBe(
      '见 文档 (https://a.dev)。'
    )
    expect(markdownToText('<https://a.dev>\n').trim()).toBe('https://a.dev')
  })

  it('图片转成占位说明', () => {
    expect(markdownToText('![示意图](a.png)\n').trim()).toBe('[图片:示意图]')
  })

  it('列表保留前缀,嵌套缩进', () => {
    const text = markdownToText('- 甲\n- 乙\n  - 丙\n')
    expect(text).toContain('- 甲')
    expect(text).toContain('  - 丙')
  })

  it('有序列表按 start 递增', () => {
    const text = markdownToText('3. 三\n4. 四\n')
    expect(text).toContain('3. 三')
    expect(text).toContain('4. 四')
  })

  it('任务列表保留勾选状态', () => {
    const text = markdownToText('- [x] 已完成\n- [ ] 待办\n')
    expect(text).toContain('- [x] 已完成')
    expect(text).toContain('- [ ] 待办')
  })

  it('表格按显示宽度对齐', () => {
    const text = markdownToText('| 名称 | 值 |\n| --- | --- |\n| a | 1 |\n')
    const lines = text.trim().split('\n')
    // 中文表头占 4 列,ASCII 单元格要补到同宽
    expect(lines[0]).toBe('名称  值')
    expect(lines[1]).toBe('a     1')
  })

  it('代码块改用四空格缩进,不留围栏', () => {
    const text = markdownToText('```js\nconst a = 1\n```\n')
    expect(text).toContain('    const a = 1')
    expect(text).not.toContain('```')
  })

  it('引用逐行加 > 前缀', () => {
    expect(markdownToText('> 引用内容\n').trim()).toBe('> 引用内容')
  })

  it('空输入返回空串', () => {
    expect(markdownToText('')).toBe('')
    expect(markdownToText('\n\n')).toBe('')
  })
})
