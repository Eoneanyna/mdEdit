import { readFile } from 'node:fs/promises'
import { type FSWatcher, watch } from 'chokidar'
import type { WebContents } from 'electron'

let watcher: FSWatcher | null = null
let watchedPath: string | null = null
/** 记录本应用最后写入的内容,用于区分「自己保存」与「外部改动」 */
let lastWrittenContent: string | null = null

export function noteOwnWrite(filePath: string, content: string): void {
  if (filePath === watchedPath) lastWrittenContent = content
}

export async function stopWatching(): Promise<void> {
  await watcher?.close()
  watcher = null
  watchedPath = null
  lastWrittenContent = null
}

/**
 * 监听当前编辑的文件。保存动作自身也会触发 change,
 * 因此回调里对比内容,与本应用刚写入的一致则不打扰用户。
 */
export async function watchFile(filePath: string | null, sender: WebContents): Promise<void> {
  // 目标没变就不要重建监听:重建会清掉 lastWrittenContent,
  // 而保存产生的 change 事件往往晚于重建到达,届时会把自己的写入误判成外部改动。
  if (filePath && filePath === watchedPath) return

  await stopWatching()
  if (!filePath) return

  watchedPath = filePath
  watcher = watch(filePath, { ignoreInitial: true })

  watcher.on('change', async () => {
    try {
      const content = await readFile(filePath, 'utf-8')
      if (content === lastWrittenContent) return
      if (sender.isDestroyed()) return
      sender.send('file:external-change', filePath)
    } catch {
      // 文件可能正被其他程序替换,读失败时跳过本次通知
    }
  })
}
