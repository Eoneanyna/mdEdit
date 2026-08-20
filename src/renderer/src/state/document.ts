import type { OpenedDocument } from '@shared/ipc'
import type { EditorHandle } from '../editor/editor'

export interface DocumentSnapshot {
  path: string | null
  name: string
  dirty: boolean
}

export type DocumentListener = (snapshot: DocumentSnapshot) => void

const UNTITLED = '未命名.md'

/**
 * 当前文档的状态机:路径、未保存标记,以及与编辑器内容的同步。
 *
 * 脏标记以「编辑器序列化后的内容」为基准而非文件原文 —— 所见即所得编辑器
 * 打开时会把源码规范化(例如统一列表符号),用原文对比会导致刚打开就显示未保存。
 */
export class DocumentState {
  #path: string | null = null
  #name: string = UNTITLED
  #savedContent: string
  #dirty = false
  #listeners: DocumentListener[] = []

  /** initialName 用于首屏的语法帮助;用户新建文档后一律回到「未命名.md」 */
  constructor(
    private readonly editor: EditorHandle,
    initialName: string = UNTITLED
  ) {
    this.#name = initialName
    this.#savedContent = editor.getMarkdown()
    editor.onChange(() => this.#recompute())
  }

  get path(): string | null {
    return this.#path
  }

  get name(): string {
    return this.#name
  }

  get dirty(): boolean {
    return this.#dirty
  }

  subscribe(listener: DocumentListener): void {
    this.#listeners.push(listener)
    listener(this.#snapshot())
  }

  /** 载入一个已读取的文件 */
  open(doc: OpenedDocument): void {
    this.editor.setMarkdown(doc.content)
    this.#path = doc.path
    this.#name = doc.name
    // 以规范化后的输出作为基准,避免打开即脏
    this.#savedContent = this.editor.getMarkdown()
    this.#dirty = false
    this.#emit()
  }

  /** 新建空白文档 */
  reset(template = ''): void {
    this.editor.setMarkdown(template)
    this.#path = null
    this.#name = UNTITLED
    this.#savedContent = this.editor.getMarkdown()
    this.#dirty = false
    this.#emit()
  }

  /**
   * 当前文件在磁盘上被改名后,只更新路径与显示名。
   * 不重新载入内容 —— 否则未保存的改动会丢失。
   */
  renamed(newPath: string, newName: string): void {
    if (this.#path === null) return
    this.#path = newPath
    this.#name = newName
    this.#emit()
  }

  /** 保存成功后调用,刷新基准内容 */
  markSaved(path: string, name: string, content: string): void {
    this.#path = path
    this.#name = name
    this.#savedContent = content
    this.#dirty = false
    this.#emit()
  }

  #recompute(): void {
    const dirty = this.editor.getMarkdown() !== this.#savedContent
    if (dirty === this.#dirty) return
    this.#dirty = dirty
    this.#emit()
  }

  #snapshot(): DocumentSnapshot {
    return { path: this.#path, name: this.#name, dirty: this.#dirty }
  }

  #emit(): void {
    const snapshot = this.#snapshot()
    for (const listener of this.#listeners) listener(snapshot)
  }
}
