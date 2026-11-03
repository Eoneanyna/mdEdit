import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Nodes } from 'mdast'

const parser = unified().use(remarkParse).use(remarkGfm)

/** 从 Markdown AST 创建 DOM，不执行原始 HTML，不自动加载远程图片。 */
export function renderAnswer(target: HTMLElement, markdown: string): void {
  function append(parent: Node, node: Nodes): void {
    const element = (tag: string): HTMLElement => {
      const child = document.createElement(tag)
      parent.appendChild(child)
      return child
    }
    const children = (into: Node): void => {
      if ('children' in node) for (const child of node.children) append(into, child)
    }
    switch (node.type) {
      case 'root': children(parent); break
      case 'text': parent.appendChild(document.createTextNode(node.value)); break
      case 'paragraph': children(element('p')); break
      case 'heading': children(element('h' + node.depth)); break
      case 'strong': children(element('strong')); break
      case 'emphasis': children(element('em')); break
      case 'delete': children(element('del')); break
      case 'inlineCode': element('code').textContent = node.value; break
      case 'code': {
        const code = document.createElement('code')
        code.textContent = node.value
        if (node.lang) code.dataset.language = node.lang
        element('pre').appendChild(code)
        break
      }
      case 'blockquote': children(element('blockquote')); break
      case 'list': {
        const list = element(node.ordered ? 'ol' : 'ul')
        if (node.ordered && node.start) list.setAttribute('start', String(node.start))
        children(list)
        break
      }
      case 'listItem': {
        const item = element('li')
        if (typeof node.checked === 'boolean') {
          const checkbox = document.createElement('input')
          checkbox.type = 'checkbox'; checkbox.checked = node.checked; checkbox.disabled = true
          item.appendChild(checkbox)
        }
        children(item)
        break
      }
      case 'table': {
        const wrap = element('div'); wrap.className = 'ai-table-scroll'
        const table = document.createElement('table'); wrap.appendChild(table)
        node.children.forEach((row, index) => {
          const tr = document.createElement('tr'); table.appendChild(tr)
          row.children.forEach((cell, column) => {
            const td = document.createElement(index === 0 ? 'th' : 'td')
            if (node.align?.[column]) td.style.textAlign = node.align[column]!
            for (const child of cell.children) append(td, child)
            tr.appendChild(td)
          })
        })
        break
      }
      case 'link': {
        if (!/^https?:\/\//i.test(node.url)) { children(parent); break }
        const link = element('a') as HTMLAnchorElement
        link.href = node.url; link.title = node.title || node.url
        children(link)
        link.addEventListener('click', event => {
          event.preventDefault()
          void window.api.openExternal(node.url).catch(() => {})
        })
        break
      }
      case 'image': element('span').textContent = '〔图片：' + (node.alt || '未命名') + '〕'; break
      case 'html': parent.appendChild(document.createTextNode(node.value)); break
      case 'break': element('br'); break
      case 'thematicBreak': element('hr'); break
      default: children(parent)
    }
  }
  const fragment = document.createDocumentFragment()
  append(fragment, parser.parse(markdown))
  target.replaceChildren(fragment)
}
