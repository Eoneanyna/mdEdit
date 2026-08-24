import { createEditor, type EditorHandle } from './editor/editor'

/**
 * 测试专用:创建独立的 Crepe 编辑器,用完自动销毁。
 * 每个用例独立实例,避免共享文档状态互相污染。
 */
export async function withCrepeEditor<T>(
  defaultValue: string,
  run: (editor: EditorHandle) => Promise<T> | T
): Promise<T> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = await createEditor(host, defaultValue)
  try {
    return await run(editor)
  } finally {
    await editor.destroy()
    host.remove()
  }
}
