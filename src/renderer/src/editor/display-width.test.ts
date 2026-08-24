import { describe, expect, it } from 'vitest'
import { displayWidth } from './display-width'

describe('displayWidth', () => {
  it('ASCII 字符每字符 1 列', () => {
    expect(displayWidth('')).toBe(0)
    expect(displayWidth('abc')).toBe(3)
    expect(displayWidth('a1 !')).toBe(4)
  })

  it('CJK 字符每字符 2 列', () => {
    expect(displayWidth('列一')).toBe(4)
    expect(displayWidth('a中b')).toBe(4)
  })

  it('全角形式计 2 列', () => {
    expect(displayWidth('ＡＢＣ')).toBe(6)
    expect(displayWidth('１２３')).toBe(6)
  })

  it('全角与 CJK 标点计 2 列', () => {
    // U+FF0C(全角逗号)与 U+3002(句号)分处两个宽区间
    expect(displayWidth('，。')).toBe(4)
  })

  it('谚文音节计 2 列', () => {
    expect(displayWidth('가')).toBe(2)
  })

  it('CJK 扩展 A 区(码点边界)计 2 列', () => {
    expect(displayWidth('㐀')).toBe(2) // U+3400,区间起点
    expect(displayWidth('鿿')).toBe(2) // U+9FFF,基本区终点
  })

  it('emoji 按单个码点计 2 列,不拆代理对', () => {
    expect(displayWidth('🚀')).toBe(2)
    expect(displayWidth('a🚀b')).toBe(4)
  })

  it('常规标点和符号计 1 列', () => {
    expect(displayWidth('-|')).toBe(2)
    expect(displayWidth('—')).toBe(1) // 长破折号 U+2014 不在宽区间
  })
})
