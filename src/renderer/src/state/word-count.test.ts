import { describe, expect, it } from 'vitest'
import { countText } from './word-count'

describe('countText', () => {
  it('空文本全为零', () => {
    expect(countText('')).toEqual({
      words: 0,
      characters: 0,
      charactersWithSpaces: 0,
      lines: 0
    })
  })

  it('西文按词计,字符数区分是否含空白', () => {
    const stats = countText('hello world')
    expect(stats.words).toBe(2)
    expect(stats.characters).toBe(10)
    expect(stats.charactersWithSpaces).toBe(11)
    expect(stats.lines).toBe(1)
  })

  it('中日韩字符每字独立成词', () => {
    expect(countText('中文').words).toBe(2)
    expect(countText('日本語').words).toBe(3)
    expect(countText('한국어').words).toBe(3)
  })

  it('中日韩与西文混合计数', () => {
    const stats = countText('中文 hello 世界')
    expect(stats.words).toBe(5)
    expect(stats.characters).toBe(9)
  })

  it('撇号与连字符不拆词', () => {
    expect(countText("don't stop a-b").words).toBe(3)
  })

  it('连续数字按一个词计', () => {
    expect(countText('2024 年').words).toBe(2)
  })

  it('按换行计行数', () => {
    expect(countText('a\nb').lines).toBe(2)
  })
})
