/**
 * jsdom 缺失的浏览器 API,补上编辑器测试需要的最小行为。
 * 每个测试文件加载前执行一次。
 */
const w = globalThis as typeof globalThis & {
  matchMedia?: Window['matchMedia']
  ResizeObserver?: typeof ResizeObserver
  IntersectionObserver?: typeof IntersectionObserver
}

// 引用定位会触发 ProseMirror 虚拟光标测量；jsdom 没有布局引擎。
if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}

if (typeof w.matchMedia !== 'function') {
  w.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false
    }) as MediaQueryList
}

if (typeof w.ResizeObserver !== 'function') {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  w.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

if (typeof w.IntersectionObserver !== 'function') {
  class NoopIntersectionObserver {
    observe(): void {}
    unobserve(): void {}
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds = []
  }
  w.IntersectionObserver = NoopIntersectionObserver as unknown as typeof IntersectionObserver
}
