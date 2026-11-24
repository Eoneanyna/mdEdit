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

/** 统一分隔符、去掉末尾斜杠,并按 Windows 的大小写不敏感规则比较 */
function normalize(fullPath: string): string {
  return fullPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * targetPath 是否位于 rootPath 目录内(含其自身)。
 * 用于判断双击打开的文件能不能在现有文件树里找到。
 */
export function isPathInside(rootPath: string | null, targetPath: string): boolean {
  if (!rootPath) return false
  const root = normalize(rootPath)
  if (!root) return false
  const target = normalize(targetPath)
  return target === root || target.startsWith(`${root}/`)
}
