/**
 * 大纲「整节移动」的纯逻辑。
 *
 * 一个节 = 标题行 + 其后所有内容,直到下一个同级或更高级标题为止。
 * 因此移动二级标题时,它下面的三级标题、正文、表格都会被一起带走。
 * 这里只处理 Markdown 源码行,不依赖 DOM,便于独立测试。
 */

export interface HeadingInfo {
  level: number
  text: string
  /** 标题所在的行下标 */
  line: number
}

export interface Section extends HeadingInfo {
  /** 本节结束行(不含) */
  endLine: number
}

interface SplitDocument {
  /** 正文行,末尾空行已剥离 */
  body: string[]
  /** 末尾空行,移动正文后原样拼回,保证文档仍以换行结尾 */
  tail: string[]
}

function splitDocument(markdown: string): SplitDocument {
  const lines = markdown.split('\n')
  let end = lines.length
  while (end > 0 && lines[end - 1]!.trim() === '') end--
  return { body: lines.slice(0, end), tail: lines.slice(end) }
}

function findHeadings(body: string[]): HeadingInfo[] {
  const headings: HeadingInfo[] = []
  // 围栏代码块里的 "# xxx" 是代码,不是标题
  let fence: { char: string; length: number } | null = null

  body.forEach((line, index) => {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (fenceMatch) {
        const marker = fenceMatch[1]!
        const rest = line.slice(fenceMatch[0].length).trim()
        if (marker[0] === fence.char && marker.length >= fence.length && rest === '') {
          fence = null
        }
      }
      return
    }
    if (fenceMatch) {
      const marker = fenceMatch[1]!
      fence = { char: marker[0]!, length: marker.length }
      return
    }

    const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line)
    if (!match) return
    headings.push({
      level: match[1]!.length,
      text: (match[2] ?? '').trim(),
      line: index
    })
  })

  return headings
}

/** 解析出每个标题及其所辖的行范围 */
export function parseSections(markdown: string): Section[] {
  const { body } = splitDocument(markdown)
  const headings = findHeadings(body)

  return headings.map((heading, index) => {
    let endLine = body.length
    for (let next = index + 1; next < headings.length; next++) {
      if (headings[next]!.level <= heading.level) {
        endLine = headings[next]!.line
        break
      }
    }
    return { ...heading, endLine }
  })
}

/**
 * 把 fromIndex 这一节整体移动到 targetIndex 这一节之前/之后。
 * 返回新的 Markdown 源码;无法移动时(目标是自身或自己的子节)原样返回。
 */
export function moveSection(
  markdown: string,
  fromIndex: number,
  targetIndex: number,
  placement: 'before' | 'after'
): string {
  const sections = parseSections(markdown)
  const source = sections[fromIndex]
  const target = sections[targetIndex]
  if (!source || !target || fromIndex === targetIndex) return markdown

  // 目标落在源节内部说明拖进了自己的子标题,会造成结构自吞,直接拒绝
  if (target.line >= source.line && target.line < source.endLine) return markdown

  const { body, tail } = splitDocument(markdown)
  const block = body.slice(source.line, source.endLine)
  if (block.length === 0) return markdown

  let insertLine = placement === 'before' ? target.line : target.endLine
  const remaining = [...body.slice(0, source.line), ...body.slice(source.endLine)]
  if (insertLine >= source.endLine) insertLine -= block.length
  else if (insertLine > source.line) return markdown

  const moved = [
    ...remaining.slice(0, insertLine),
    ...block,
    ...remaining.slice(insertLine)
  ]
  // 与编辑器保存时的尾部归一化保持一致,避免块末尾空行叠加出多余空行
  return [...moved, ...tail].join('\n').replace(/\n+$/, '\n')
}
