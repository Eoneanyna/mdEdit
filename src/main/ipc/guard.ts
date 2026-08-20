import type { Result } from '@shared/ipc'

/**
 * 把主进程可能抛出的异常收敛成 Result,避免异常栈直接穿到渲染进程。
 */
export async function guard<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
