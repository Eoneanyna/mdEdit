import { displayWidth } from '../editor/display-width'

/** 超过这个显示宽度就不像标题,而像正文句子 */
const HEADING_MAX_WIDTH = 40

/** 以这些标点收尾的多半是完整句子,不该升级成标题 */
const SENTENCE_END = /[。！？；，、.!?;,:：]$/

/** 已经是 Markdown 块结构的行,原样放行 */
const MD_BLOCK = /^\s{0,3}(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|~~~|\||:?-{3,}:?\s*$|={3,}\s*$)/

/** 纯文本常见的项目符号,Markdown 不认,需要换成 - */
const BULLET = /^(\s*)[•·○●▪▫◦‣⁃*]\s+/

/** 中文编号:一、 (1) 1) 之类,Markdown 同样不认作有序列表 */
const CN_ORDERED = /^(\s*)(?:[（(]\s*(\d+)\s*[)）]|(\d+)[)）]|([一二三四五六七八九十]+)\s*[、.])\s+/

/** 形如 1.2.3 的层级编号,段数即标题级别 */
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)[.、]?\s+(\S.*)$/

/** Setext 标题:文字下方整行 = 或 -。md 转 txt 时正是这样标注一二级标题 */
const SETEXT = /^\s{0,3}(=+|-+)\s*$/

/** 四空格或制表符起头,按纯文本惯例视作代码 */
const INDENTED_CODE = /^(?: {4}|\t)/

interface Block {
  readonly lines: readonly string[]
  /** 位于围栏代码块内部,一律不加工 */
  readonly fenced: boolean
}

/**
 * 按空行切段,同时把围栏代码块整体圈起来。
 * 围栏内的空行不是段落边界 —— 否则一段代码会被拆得七零八落。
 */
function splitBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let current: string[] = []
  let fence: string | null = null

  const flush = (fenced: boolean): void => {
    if (current.length > 0) blocks.push({ lines: current, fenced })
    current = []
  }

  for (const line of text.split('\n')) {
    const fenceMark = /^\s{0,3}(```+|~~~+)/.exec(line)
    if (fence === null && fenceMark) {
      flush(false)
      fence = fenceMark[1]!.slice(0, 3)
      current.push(line)
      continue
    }
    if (fence !== null) {
      current.push(line)
      // 结束围栏后整块落袋,后续内容重新按普通文本处理
      if (line.trimStart().startsWith(fence)) {
        flush(true)
        fence = null
      }
      continue
    }
    if (line.trim() === '') {
      flush(false)
      continue
    }
    current.push(line)
  }
  // 未闭合的围栏也要收尾,否则末尾内容会凭空消失
  flush(fence !== null)
  return blocks
}

/** 整段都已经是 Markdown 结构就别动它,保证对 md 输入幂等 */
function isMarkdownBlock(lines: readonly string[]): boolean {
  return lines.some((line) => MD_BLOCK.test(line))
}

/** 孤立、简短、不以句读收尾的一行,才当它是标题 */
function headingLevel(lines: readonly string[], seenHeading: boolean): number | null {
  if (lines.length !== 1) return null
  const line = lines[0]!.trim()
  if (line === '' || displayWidth(line) > HEADING_MAX_WIDTH) return null
  if (SENTENCE_END.test(line)) return null

  const numbered = NUMBERED_HEADING.exec(line)
  // 1.2.3 这样的编号自带层级信息,直接照搬,md 转 txt 再转回来即可对上
  if (numbered) return Math.min(numbered[1]!.split('.').length, 6)

  // 没有编号线索时,首个当作文档标题,其余降一级
  return seenHeading ? 2 : 1
}

/**
 * Setext 标题改写成 ATX 风格。
 * 两者语义相同,但 ATX 支持六级且一眼看得出层级,导出的文件更规整。
 */
function asSetextHeading(lines: readonly string[]): string | null {
  if (lines.length !== 2) return null
  const [title = '', rule = ''] = lines
  if (title.trim() === '' || !SETEXT.test(rule)) return null
  const level = rule.trim().startsWith('=') ? 1 : 2
  return `${'#'.repeat(level)} ${title.trim()}`
}

/** 把非 Markdown 的项目符号与中文编号换成标准列表语法 */
function normalizeListMarkers(lines: readonly string[]): string[] | null {
  let changed = false
  const converted = lines.map((line) => {
    const bullet = BULLET.exec(line)
    if (bullet) {
      changed = true
      return line.replace(BULLET, `${bullet[1]}- `)
    }
    const ordered = CN_ORDERED.exec(line)
    if (ordered) {
      changed = true
      const [, indent = '', paren, trailing, chinese] = ordered
      const digits = paren ?? trailing
      // 中文数字没法直接做序号,交给 Markdown 自动编号,原字样留在正文里
      const number = digits ?? '1'
      const rest = line.replace(CN_ORDERED, '')
      return chinese ? `${indent}${number}. ${chinese}、${rest}` : `${indent}${number}. ${rest}`
    }
    return line
  })
  return changed ? converted : null
}

/**
 * 纯文本转 Markdown:识别标题、列表与缩进代码块。
 *
 * 输入可能本来就是 Markdown —— 编辑器把 .txt 也按 Markdown 解析,
 * 所以这里对已有结构一律放行,重复执行不会改变结果。
 */
export function textToMarkdown(text: string): string {
  const blocks = splitBlocks(text.replace(/\r\n?/g, '\n'))
  let seenHeading = false

  const rendered = blocks.map((block) => {
    if (block.fenced) return block.lines.join('\n')

    // Setext 要抢在通用结构判断之前处理,否则会被当作"已是 Markdown"原样留下
    const setext = asSetextHeading(block.lines)
    if (setext) {
      seenHeading = true
      return setext
    }

    if (isMarkdownBlock(block.lines)) {
      // 已有结构里若含 # 标题,后续孤立短行就不该再抢一级标题
      if (block.lines.some((line) => /^\s{0,3}#/.test(line))) seenHeading = true
      return block.lines.join('\n')
    }

    if (block.lines.every((line) => INDENTED_CODE.test(line))) {
      const body = block.lines.map((line) => line.replace(/^(?: {4}|\t)/, ''))
      return ['```', ...body, '```'].join('\n')
    }

    const level = headingLevel(block.lines, seenHeading)
    if (level !== null) {
      seenHeading = true
      return `${'#'.repeat(level)} ${block.lines[0]!.trim()}`
    }

    const list = normalizeListMarkers(block.lines)
    if (list) return list.join('\n')

    return block.lines.join('\n')
  })

  const body = rendered.filter((part) => part.length > 0).join('\n\n')
  return body.length > 0 ? `${body}\n` : ''
}
