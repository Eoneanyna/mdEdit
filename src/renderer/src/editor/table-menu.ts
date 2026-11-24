/**
 * 表格右键菜单:在光标所在单元格的行/列上做插入与删除。
 * 复用 Milkdown GFM 预设的表格命令,与工具栏的加号按钮行为保持一致。
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  deleteSelectedCellsCommand,
  selectColCommand,
  selectRowCommand
} from '@milkdown/kit/preset/gfm'
import type { EditorView } from '@milkdown/kit/prose/view'
import { DIVIDER, showPopup, type PopupItem } from '../ui/popup'

export interface TableCellTarget {
  rowIndex: number
  colIndex: number
  /** 表格内的一个文档位置,供 selectRow/selectCol 反查所在表格 */
  pos: number
}

export type TableAction =
  | 'row-before'
  | 'row-after'
  | 'col-before'
  | 'col-after'
  | 'row-delete'
  | 'col-delete'

/** 从右键落点解析出单元格所在行列;不在表格内时返回 null */
export function findTableCell(view: EditorView, event: MouseEvent): TableCellTarget | null {
  const target = event.target
  if (!(target instanceof Element)) return null
  const cell = target.closest('td, th')
  if (!(cell instanceof HTMLTableCellElement)) return null
  const table = cell.closest('table')
  if (!table) return null

  // 表格可能由 NodeView 渲染在 shadow root 内,用宿主节点判断是否属于本编辑器
  const root = table.getRootNode()
  const host = root instanceof ShadowRoot ? root.host : table
  if (!view.dom.contains(host)) return null

  const row = cell.parentElement
  if (!(row instanceof HTMLTableRowElement)) return null
  const rowIndex = Array.from(table.rows).indexOf(row)
  const colIndex = Array.from(row.cells).indexOf(cell)
  if (rowIndex < 0 || colIndex < 0) return null

  // 从单元格 DOM 反查文档位置,比鼠标坐标可靠:点在单元格边缘时
  // posAtCoords 可能落到表格外,导致行列命令作用在别处甚至整篇文档。
  let cellPos: number
  try {
    cellPos = view.posAtDOM(cell, 0)
  } catch {
    return null
  }

  // 再向上定位到所属表格的内容起点,与 Crepe 自带行列命令的传参一致
  const $pos = view.state.doc.resolve(cellPos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'table') {
      return { rowIndex, colIndex, pos: $pos.start(depth) + 1 }
    }
  }
  return null
}

export function runTableAction(ctx: Ctx, target: TableCellTarget, action: TableAction): void {
  const commands = ctx.get(commandsCtx)
  const isRow = action.startsWith('row')

  // 所有行列命令都以「先选中整行/整列」为前提
  if (isRow) commands.call(selectRowCommand.key, { pos: target.pos, index: target.rowIndex })
  else commands.call(selectColCommand.key, { pos: target.pos, index: target.colIndex })

  switch (action) {
    case 'row-before':
      commands.call(addRowBeforeCommand.key)
      break
    case 'row-after':
      commands.call(addRowAfterCommand.key)
      break
    case 'col-before':
      commands.call(addColBeforeCommand.key)
      break
    case 'col-after':
      commands.call(addColAfterCommand.key)
      break
    case 'row-delete':
    case 'col-delete':
      // CellSelection 为整行/整列时,该命令会删除对应的行或列
      commands.call(deleteSelectedCellsCommand.key)
      break
  }

  requestAnimationFrame(() => ctx.get(editorViewCtx).focus())
}

const MENU_ITEMS: Array<{ label: string; hint?: string; action: TableAction }> = [
  { label: '在上方插入行', action: 'row-before' },
  { label: '在下方插入行', action: 'row-after' },
  { label: '在左侧插入列', action: 'col-before' },
  { label: '在右侧插入列', action: 'col-after' }
]

const DELETE_ITEMS: Array<{ label: string; action: TableAction }> = [
  { label: '删除当前行', action: 'row-delete' },
  { label: '删除当前列', action: 'col-delete' }
]

/** 在编辑器 DOM 上安装右键菜单,返回卸载函数 */
export function attachTableContextMenu(view: EditorView, getCtx: () => Ctx): () => void {
  const handler = (event: MouseEvent): void => {
    const target = findTableCell(view, event)
    if (!target) return

    // 表格区域由本菜单接管,避免同时弹出系统菜单或块菜单
    event.preventDefault()
    event.stopPropagation()

    const items: PopupItem[] = [
      ...MENU_ITEMS.map((item) => ({
        label: item.label,
        action: () => runTableAction(getCtx(), target, item.action)
      })),
      DIVIDER,
      ...DELETE_ITEMS.map((item) => ({
        label: item.label,
        action: () => runTableAction(getCtx(), target, item.action)
      }))
    ]

    showPopup({ x: event.clientX, y: event.clientY }, () => items)
  }

  view.dom.addEventListener('contextmenu', handler, true)
  return () => view.dom.removeEventListener('contextmenu', handler, true)
}
