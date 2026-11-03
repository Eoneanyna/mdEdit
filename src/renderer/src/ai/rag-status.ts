import type { AiQueryResponse } from '@shared/ipc'

const PHASES: Record<string, string> = {
  checking: '检查文件变化', loading: '加载嵌入模型', scanning: '扫描并切分文档',
  bm25: '构建关键词索引', embedding: '构建向量索引', idle: '空闲', error: '索引构建失败'
}

export function createRagStatus(container: HTMLElement, getWorkspace: () => string | null): {
  refresh: () => Promise<void>
  setOutcome: (result: AiQueryResponse) => void
  clearOutcome: () => void
  dispose: () => void
} {
  container.innerHTML = `<details class="ai-rag-status">
    <summary id="ai-rag-summary">本地检索：检测中…</summary>
    <div id="ai-rag-info"></div>
    <div id="ai-rag-outcome"></div>
    <button class="ai-btn" id="ai-rag-refresh" type="button">刷新状态</button>
    <button class="ai-btn" id="ai-rag-restart" type="button" hidden>重启内置检索</button>
  </details>`
  const summary = container.querySelector<HTMLElement>('#ai-rag-summary')!
  const info = container.querySelector<HTMLElement>('#ai-rag-info')!
  const outcome = container.querySelector<HTMLElement>('#ai-rag-outcome')!
  let refreshing = false
  let disposed = false
  async function refresh(): Promise<void> {
    if (refreshing || disposed) return
    refreshing = true
    try {
      const state = await window.api.getRagStatus()
      if (disposed) return
      container.querySelector<HTMLButtonElement>('#ai-rag-restart')!.hidden = !state.managed
      if (!state.available) {
        summary.textContent = state.serviceState === 'starting' ? '本地检索：启动中…' : '本地检索：关键词模式'
        info.textContent = state.error || 'RAG 服务未连接，提问时使用内置关键词检索。'
        return
      }
      if (!state.compatible) {
        summary.textContent = '本地检索：服务需要重启或更新'
        info.textContent = '当前服务版本不兼容，将使用关键词检索；更新代码后请重启 RAG 服务。'
        return
      }
      const embedder = state.embedder === 'hash' ? '哈希向量（语义模型未启用）' : state.embedder || '尚未加载'
      const index = state.indexed ? `${state.chunks} 个文档块` : '尚未建立索引，首次提问时自动建立'
      summary.textContent = state.building ? '本地检索：' + (PHASES[state.phase] || '构建索引中')
        : state.error ? '本地检索：索引异常' : '本地检索：RAG 已连接'
      const progress = state.building && state.total > 0 ? `\n进度：${state.completed}/${state.total} 个文档块` : ''
      const different = state.workspace && getWorkspace() && state.workspace.replace(/\\/g, '/') !== getWorkspace()!.replace(/\\/g, '/')
        ? '\n索引属于其他工作区，提问时自动切换。' : ''
      info.textContent = `嵌入器：${embedder}\n索引：${index}\n索引工作区：${state.workspace || '无'}${progress}${different}${state.error ? '\n' + state.error : ''}`
    } catch {
      if (!disposed) { summary.textContent = '本地检索：状态获取失败'; info.textContent = '可点击刷新重试；提问仍会自动尝试检索。' }
    } finally { refreshing = false }
  }
  container.querySelector('#ai-rag-refresh')!.addEventListener('click', () => void refresh())
  container.querySelector('#ai-rag-restart')!.addEventListener('click', () => { void (async () => {
    const button = container.querySelector<HTMLButtonElement>('#ai-rag-restart')!
    button.disabled = true; info.textContent = '正在重启内置检索…'
    try { const result = await window.api.restartRag(); if (!result.ok) throw new Error(result.error); await refresh() }
    catch (error) { info.textContent = error instanceof Error ? error.message : '重启失败，请重试' }
    finally { button.disabled = false }
  })() })
  container.querySelector('details')!.addEventListener('toggle', () => void refresh())
  const timer = window.setInterval(() => {
    if (document.visibilityState !== 'hidden' && container.closest('.ai-drawer')?.classList.contains('is-open')) void refresh()
  }, 2000)
  void refresh()
  return {
    refresh,
    setOutcome(result) {
      const mode = result.retrievalMode === 'rag' ? '混合检索' : result.retrievalMode === 'keyword' ? '关键词检索' : '未使用本地检索'
      outcome.textContent = ['本轮：' + mode, ...result.notices].join('\n')
      void refresh()
    },
    clearOutcome() { outcome.textContent = ''; void refresh() },
    dispose() { disposed = true; window.clearInterval(timer) }
  }
}
