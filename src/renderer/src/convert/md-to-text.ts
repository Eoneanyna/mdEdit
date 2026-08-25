import type {
  Heading,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table
} from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { displayWidth } from '../editor/display-width'

/** 一级标题的下划线字符,二级用短横,三级以下只靠编号区分 */
const UNDERLINE = ['=', '-'] as const

/** 列表每深一层的缩进量 */
const INDENT = '  '

const parser = unified().use(remarkParse).use(remarkGfm)

/**
 * 行内节点拍平成纯文字:强调、行内代码一类的标记直接丢掉,
 * 链接与图片保留地址,否则转成 txt 后就再也找不回引用来源了。
 */
function inlineText(nodes: readonly PhrasingContent[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value
        case 'inlineCode':
          return node.value
        case 'break':
          return '\n'
        case 'image':
          return node.alt ? `[图片:${node.alt}]` : '[图片]'
        case 'link': {
          const label = inlineText(node.children)
          // 自动链接的文字就是地址本身,再括一遍纯属噪音
          return label === node.url ? label : `${label} (${node.url})`
        }
        case 'footnoteReference':
          return `[^${node.identifier}]`
        default:
          return 'children' in node ? inlineText(node.children as PhrasingContent[]) : ''
      }
    })
    .join('')
}

/**
 * 标题编号器。level 落后于上一级时把更深的层级清零,
 * 于是 ## 跟在 # 后面得到 1.1,再来一个 # 则回到 2。
 */
function createNumbering(): (level: number) => string {
  const counters = [0, 0, 0, 0, 0, 0]
  return (level: number): string => {
    counters[level - 1] = (counters[level - 1] ?? 0) + 1
    for (let deeper = level; deeper < counters.length; deeper += 1) counters[deeper] = 0
    return counters
      .slice(0, level)
      .join('.')
  }
}

/** 表格按列的显示宽度补空格,中英混排下才对得齐 */
function tableToText(node: Table): string {
  const rows = node.children.map((row) => row.children.map((cell) => inlineText(cell.children)))
  const columns = Math.max(...rows.map((row) => row.length), 0)
  const widths = Array.from({ length: columns }, (_unused, index) =>
    Math.max(...rows.map((row) => displayWidth(row[index] ?? '')))
  )
  return rows
    .map((row) =>
      Array.from({ length: columns }, (_unused, index) => {
        const cell = row[index] ?? ''
        // 末列不必补尾随空格
        if (index === columns - 1) return cell
        return cell + ' '.repeat((widths[index] ?? 0) - displayWidth(cell))
      })
        .join('  ')
        .trimEnd()
    )
    .join('\n')
}

/** 列表项:无序用 -,有序用递增数字,子层级整体缩进 */
function listToText(node: List, depth: number, numbering: (level: number) => string): string {
  const start = node.start ?? 1
  return node.children
    .map((item: ListItem, index) => {
      const marker = node.ordered ? `${start + index}. ` : '- '
      // 任务列表的勾选状态是内容的一部分,不能丢
      const checkbox = item.checked === null || item.checked === undefined
        ? ''
        : item.checked
          ? '[x] '
          : '[ ] '
      const body = blocksToText(item.children, depth + 1, numbering)
      const indent = INDENT.repeat(depth)
      const [first = '', ...rest] = body.split('\n')
      const head = `${indent}${marker}${checkbox}${first}`
      // 续行对齐到标记之后,读起来才像同一项
      const hang = indent + ' '.repeat(marker.length)
      return [head, ...rest.map((line) => (line ? hang + line : line))].join('\n')
    })
    .join('\n')
}

/** 标题:编号 + 文字,一二级额外加下划线,层级在纯文本里才看得出来 */
function headingToText(node: Heading, numbering: (level: number) => string): string {
  const label = `${numbering(node.depth)} ${inlineText(node.children)}`
  const underline = UNDERLINE[node.depth - 1]
  if (!underline) return label
  return `${label}\n${underline.repeat(displayWidth(label))}`
}

function blockToText(
  node: RootContent,
  depth: number,
  numbering: (level: number) => string
): string {
  switch (node.type) {
    case 'heading':
      return headingToText(node, numbering)
    case 'paragraph':
      return inlineText(node.children)
    case 'list':
      return listToText(node, depth, numbering)
    case 'blockquote':
      return blocksToText(node.children, depth, numbering)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')
    case 'code':
      // 去掉围栏,改用四空格缩进 —— 纯文本里区分代码的老办法
      return node.value
        .split('\n')
        .map((line) => (line ? `    ${line}` : line))
        .join('\n')
    case 'table':
      return tableToText(node)
    case 'thematicBreak':
      return '-'.repeat(40)
    case 'html':
      // 原样保留:HTML 在 txt 里没有更好的表示,删掉则丢内容
      return node.value
    case 'footnoteDefinition':
      return `[^${node.identifier}]: ${blocksToText(node.children, depth, numbering)}`
    default:
      return 'children' in node
        ? inlineText(node.children as PhrasingContent[])
        : 'value' in node
          ? String(node.value)
          : ''
  }
}

/** 块之间统一空一行,段落边界在纯文本里全靠它 */
function blocksToText(
  nodes: readonly RootContent[],
  depth: number,
  numbering: (level: number) => string
): string {
  return nodes
    .map((node) => blockToText(node, depth, numbering))
    .filter((text) => text.length > 0)
    .join('\n\n')
}

/**
 * Markdown 转纯文本:剥掉行内标记,但保留标题层级编号、列表前缀与表格对齐,
 * 让转出来的 txt 用记事本打开仍然读得出结构。
 */
export function markdownToText(markdown: string): string {
  const tree = parser.parse(markdown) as Root
  const text = blocksToText(tree.children, 0, createNumbering())
  return text.length > 0 ? `${text}\n` : ''
}
