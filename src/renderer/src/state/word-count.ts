export interface TextStats {
  /** 中日韩字符按字计,连续的西文按词计 */
  words: number
  /** 不含空白的字符数 */
  characters: number
  /** 含空白的总字符数 */
  charactersWithSpaces: number
  lines: number
}

// 汉字、日文假名、韩文谚文:每个字符独立成词
const CJK = /[㐀-鿿぀-ヿ가-힯豈-﫿]/g
// 西文词:字母数字加词内的连字符与撇号
const WESTERN_WORD = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g

/**
 * 统计正文字数。传入的应是编辑器渲染后的纯文本,
 * 而非 Markdown 源码 —— 否则 ** 、# 之类的标记会被算进去。
 */
export function countText(text: string): TextStats {
  const cjk = text.match(CJK)?.length ?? 0
  const western = text.match(WESTERN_WORD)?.length ?? 0

  return {
    words: cjk + western,
    characters: text.replace(/\s/g, '').length,
    charactersWithSpaces: text.length,
    lines: text === '' ? 0 : text.split('\n').length
  }
}
