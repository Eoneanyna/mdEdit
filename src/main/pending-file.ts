import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { isEditableKind, kindOf } from '@shared/ipc'

/**
 * 双击文件启动时,系统把路径作为命令行参数传进来。
 * 这里挑出其中第一个真实存在、且本应用能编辑的文件。
 *
 * 需要跳过的干扰项:
 * - 以 - 开头的都是 Chromium / Electron 的开关
 * - 开发模式下 `electron . foo.md` 的 "." 是应用目录,不是文档
 */
export function pickFileArg(argv: readonly string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue

    const full = resolve(arg)
    if (!existsSync(full)) continue
    if (!isEditableKind(kindOf(basename(full)))) continue

    return full
  }
  return null
}

/**
 * 冷启动时渲染进程尚未就绪,无法直接推送,
 * 故先暂存,待渲染层挂载后主动来取。
 */
let pending: string | null = null

export function setPendingFile(filePath: string | null): void {
  pending = filePath
}

/** 取走待打开的文件,同时清空 —— 只应被消费一次 */
export function takePendingFile(): string | null {
  const filePath = pending
  pending = null
  return filePath
}
