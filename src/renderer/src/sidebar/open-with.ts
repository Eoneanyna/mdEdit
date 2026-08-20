import type { FileEntry } from '@shared/ipc'
import { DIVIDER, type PopupItem, showPopup } from '../ui/popup'

/**
 * Word / Excel 这类无法在应用内编辑的文件,点击后弹出打开方式菜单。
 * 记住过的应用排在默认程序之后,选过一次即可复用。
 */
export async function showOpenWithMenu(
  entry: FileEntry,
  anchor: HTMLElement,
  notify: (message: string) => void
): Promise<void> {
  if (!entry.kind) return

  const remembered = await window.api.getRememberedApps(entry.kind)

  const run = async (task: Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    const result = await task
    if (!result.ok) notify(`打开失败:${result.error ?? '未知错误'}`)
    else notify(`已打开 ${entry.name}`)
  }

  const items: PopupItem[] = [
    {
      label: '用默认程序打开',
      action: () => run(window.api.openWithDefault(entry.path))
    }
  ]

  if (remembered.length > 0) {
    items.push(DIVIDER)
    for (const app of remembered) {
      items.push({
        label: app.name,
        hint: app.path,
        action: () => run(window.api.openWithApp(entry.path, app.path))
      })
    }
  }

  items.push(DIVIDER)
  items.push({
    label: '选择其他应用…',
    action: async () => {
      const app = await window.api.chooseApp()
      if (!app) return
      await run(window.api.openWithApp(entry.path, app.path))
    }
  })

  showPopup(anchor, () => items)
}
