import { describe, expect, it } from 'vitest'
import { moveSection, parseSections } from './sections'

/** 一级 a 下有二级 b,二级 b 下有三级 c 与正文,末尾还有一个一级标题 */
const DOC = [
  '# a',
  '',
  '## b',
  '',
  '### c',
  '',
  '正文 c',
  '',
  '# 另一节',
  '',
  '结尾',
  ''
].join('\n')

describe('大纲节解析', () => {
  it('按标题级别切分,子标题归入父节', () => {
    const sections = parseSections(DOC)
    expect(sections.map((s) => [s.level, s.text, s.line, s.endLine])).toEqual([
      [1, 'a', 0, 8],
      [2, 'b', 2, 8],
      [3, 'c', 4, 8],
      [1, '另一节', 8, 11]
    ])
  })

  it('围栏代码块里的 # 不会被误判为标题', () => {
    const markdown = '# 真标题\n\n```md\n# 假标题\n```\n\n## 真二级\n'
    expect(parseSections(markdown).map((s) => s.text)).toEqual(['真标题', '真二级'])
  })

  it('没有标题时返回空数组', () => {
    expect(parseSections('普通段落\n')).toEqual([])
  })
})

describe('大纲整节移动', () => {
  it('把二级 b 连同三级 c 与正文拖到一级 a 之前,标题级别保持不变', () => {
    const next = moveSection(DOC, 1, 0, 'before')
    expect(next).toBe(
      [
        '## b',
        '',
        '### c',
        '',
        '正文 c',
        '',
        '# a',
        '',
        '# 另一节',
        '',
        '结尾',
        ''
      ].join('\n')
    )
  })

  it('拖到目标节之后时,落在目标节全部内容之后', () => {
    const next = moveSection(DOC, 1, 3, 'after')
    expect(next).toBe(
      [
        '# a',
        '',
        '# 另一节',
        '',
        '结尾',
        '## b',
        '',
        '### c',
        '',
        '正文 c',
        ''
      ].join('\n')
    )
  })

  it('不能把标题拖进它自己的子章节', () => {
    expect(moveSection(DOC, 1, 2, 'before')).toBe(DOC)
    expect(moveSection(DOC, 1, 1, 'before')).toBe(DOC)
  })

  it('索引越界时原样返回', () => {
    expect(moveSection(DOC, 99, 0, 'before')).toBe(DOC)
  })

  it('移动后仍保留文末换行', () => {
    expect(moveSection(DOC, 1, 0, 'before').endsWith('\n')).toBe(true)
  })
})
