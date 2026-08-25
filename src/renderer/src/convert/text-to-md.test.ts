import { describe, expect, it } from 'vitest'
import { markdownToText } from './md-to-text'
import { textToMarkdown } from './text-to-md'

describe('textToMarkdown', () => {
  it('孤立短行升级为标题,首个为一级', () => {
    const md = textToMarkdown('前言\n\n这里是正文内容。\n')
    expect(md).toContain('# 前言')
    expect(md).toContain('这里是正文内容。')
  })

  it('后续短行降为二级,不与文档标题抢层级', () => {
    const md = textToMarkdown('总纲\n\n正文一。\n\n分论\n\n正文二。\n')
    expect(md).toContain('# 总纲')
    expect(md).toContain('## 分论')
  })

  it('带层级编号的行按编号定级', () => {
    const md = textToMarkdown('1 概述\n\n正文。\n\n1.1 背景\n\n正文。\n\n1.1.1 细节\n\n正文。\n')
    expect(md).toContain('# 1 概述')
    expect(md).toContain('## 1.1 背景')
    expect(md).toContain('### 1.1.1 细节')
  })

  it('以句读收尾的行不当标题', () => {
    const md = textToMarkdown('这是一句话。\n')
    expect(md.trim()).toBe('这是一句话。')
  })

  it('过长的行不当标题', () => {
    const long = '这行文字相当长足以超过标题的宽度上限所以应当保持为普通段落不要被误判'
    expect(textToMarkdown(`${long}\n`).trim()).toBe(long)
  })

  it('非 Markdown 项目符号转成标准列表', () => {
    const md = textToMarkdown('• 甲\n• 乙\n')
    expect(md).toContain('- 甲')
    expect(md).toContain('- 乙')
    expect(md).not.toContain('•')
  })

  it('括号数字编号转成有序列表', () => {
    const md = textToMarkdown('(1) 第一步\n(2) 第二步\n')
    expect(md).toContain('1. 第一步')
    expect(md).toContain('2. 第二步')
  })

  it('中文编号转列表且保留原字样', () => {
    const md = textToMarkdown('一、 起因\n二、 经过\n')
    expect(md).toContain('1. 一、起因')
    expect(md).toContain('1. 二、经过')
  })

  it('缩进块转围栏代码块', () => {
    const md = textToMarkdown('    const a = 1\n    const b = 2\n')
    expect(md).toBe('```\nconst a = 1\nconst b = 2\n```\n')
  })

  it('围栏代码块内部原样保留,内含空行不拆段', () => {
    const source = '```js\nconst a = 1\n\nconst b = 2\n```\n'
    expect(textToMarkdown(source)).toBe(source)
  })

  it('围栏内的短行不会被误判成标题', () => {
    const md = textToMarkdown('```\n标题样子的行\n```\n')
    expect(md).not.toContain('#')
  })

  it('对已有 Markdown 结构幂等', () => {
    const source = '# 标题\n\n- 甲\n- 乙\n\n> 引用\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    const once = textToMarkdown(source)
    expect(once).toBe(textToMarkdown(once))
    expect(once).toContain('# 标题')
    expect(once).toContain('| a | b |')
  })

  it('已有 # 标题后,孤立短行不再抢一级', () => {
    const md = textToMarkdown('# 正式标题\n\n正文。\n\n后面的短行\n')
    expect(md).toContain('# 正式标题')
    expect(md).toContain('## 后面的短行')
  })

  it('CRLF 换行不影响识别', () => {
    expect(textToMarkdown('前言\r\n\r\n正文。\r\n')).toContain('# 前言')
  })

  it('空输入返回空串', () => {
    expect(textToMarkdown('')).toBe('')
    expect(textToMarkdown('\n\n')).toBe('')
  })
})

describe('两个方向配合使用', () => {
  it('md 转 txt 再转回来,标题层级不丢', () => {
    const text = markdownToText('# 概述\n\n段落。\n\n## 背景\n\n段落。\n')
    const back = textToMarkdown(text)
    // 编号在往返中留在标题文字里,但层级本身要能还原
    expect(back).toContain('# 1 概述')
    expect(back).toContain('## 1.1 背景')
  })

  it('列表往返后仍是列表', () => {
    const back = textToMarkdown(markdownToText('- 甲\n- 乙\n'))
    expect(back).toContain('- 甲')
    expect(back).toContain('- 乙')
  })
})
