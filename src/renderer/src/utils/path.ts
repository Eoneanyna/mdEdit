/**
 * 渲染进程没有 node 的 path 模块(未开启 nodeIntegration),
 * 这里提供够用的最小实现。同时兼容 Windows 的反斜杠与 POSIX 的正斜杠。
 */

/** 取路径末段。传入目录路径时返回目录名 */
export function baseName(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? fullPath
}

/** 取所在目录。已是根路径(无可去除的层级)时返回 null */
export function dirName(fullPath: string): string | null {
  const index = Math.max(fullPath.lastIndexOf('\\'), fullPath.lastIndexOf('/'))
  return index > 0 ? fullPath.slice(0, index) : null
}
