/**
 * East Asian Wide / Fullwidth 区间 —— 这些字符在等宽字体下占两列。
 * 序列化表格时按此计算列宽,中文表格的源码才能真正对齐;
 * 若按字符个数计算,"列一" 会被当作 2 列宽,而它实际占 4 列。
 */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // 谚文字母
  [0x2e80, 0x303e], // CJK 部首、日文标点
  [0x3041, 0x33ff], // 平假名、片假名、注音、CJK 兼容符号
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x4e00, 0x9fff], // CJK 基本区
  [0xa000, 0xa4cf], // 彝文
  [0xac00, 0xd7a3], // 谚文音节
  [0xf900, 0xfaff], // CJK 兼容表意文字
  [0xfe10, 0xfe19], // 竖排标点
  [0xfe30, 0xfe6f], // CJK 兼容形式
  [0xff00, 0xff60], // 全角 ASCII
  [0xffe0, 0xffe6], // 全角货币等符号
  [0x1f300, 0x1f64f], // 常用 emoji
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd], // CJK 扩展 B 及以后
  [0x30000, 0x3fffd]
]

function isWide(codePoint: number): boolean {
  // 表格单元格通常很短,线性扫描足够
  return WIDE_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high)
}

/** 字符串在等宽字体下占用的列数 */
export function displayWidth(value: string): number {
  let width = 0
  // for...of 按码点迭代,代理对不会被拆成两个字符
  for (const char of value) {
    const codePoint = char.codePointAt(0)
    if (codePoint === undefined) continue
    width += isWide(codePoint) ? 2 : 1
  }
  return width
}
