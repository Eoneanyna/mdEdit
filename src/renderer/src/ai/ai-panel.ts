import type { AiConfig, AiQueryResponse, AiSource, AiTurn } from '@shared/ipc'
import { loadSession, saveSession } from './session'
import { renderAnswer } from './markdown'
import { createRagStatus } from './rag-status'

interface AiPanelDeps { getWorkspace: () => Promise<string | null> }
const DEFAULTS: Record<AiConfig['provider'], { baseUrl: string; model: string }> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' },
  siliconcloud: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
  custom: { baseUrl: '', model: '' }
}

export function createAiPanel(container: HTMLElement, deps: AiPanelDeps): { workspaceChanged: (workspace: string) => void } {
  container.innerHTML = `
    <div class="ai-panel">
      <div class="ai-panel__config-header">
        <button class="ai-btn" id="ai-config-toggle" type="button" aria-expanded="false">配置</button>
        <button class="ai-btn" id="ai-clear" type="button">新对话</button>
      </div>
      <div class="ai-panel__config" id="ai-config-body" style="display:none">
        <select class="ai-select" id="ai-provider" aria-label="模型供应商">
          <option value="openrouter">OpenRouter</option><option value="siliconcloud">SiliconCloud</option>
          <option value="ollama">Ollama</option><option value="custom">自定义</option>
        </select>
        <input class="ai-input" id="ai-model" aria-label="模型名称" placeholder="模型名称，如 openrouter/free" />
        <input class="ai-input" id="ai-key" type="password" aria-label="API Key" placeholder="API Key（Ollama 可留空）" autocomplete="off" />
        <input class="ai-input" id="ai-baseurl" aria-label="Base URL" placeholder="Base URL" />
        <div class="ai-panel__row">
          <label class="ai-check"><input type="checkbox" id="ai-local" checked />检索本地文档</label>
          <label class="ai-check"><input type="checkbox" id="ai-web" />检索网页</label>
          <button class="ai-btn" id="ai-savecfg" type="button">保存配置</button>
        </div>
        <div class="ai-panel__privacy">云端模型会接收问题、最近 6 轮问答及检索片段；未保存的编辑内容不参与检索。会话仅保存在本机，按工作区隔离。</div>
      </div>
      <div class="ai-panel__hint" id="ai-workspace-hint"></div>
      <div id="ai-rag-status"></div>
      <div class="ai-panel__messages" id="ai-messages" role="log" aria-label="问答记录"></div>
      <div class="ai-panel__status" id="ai-status" role="status" aria-live="polite"></div>
      <div class="ai-panel__input">
        <textarea class="ai-textarea" id="ai-question" aria-label="问题" maxlength="4000" placeholder="询问文档，也可以继续追问；Shift+Enter 换行"></textarea>
        <button class="ai-btn" id="ai-stop" type="button" hidden>停止</button>
        <button class="ai-btn ai-btn--primary" id="ai-send" type="button" disabled>发送</button>
      </div>
    </div>`
  const el = <T extends HTMLElement>(id: string): T => container.querySelector<T>('#' + id)!
  const provider = el<HTMLSelectElement>('ai-provider')
  const model = el<HTMLInputElement>('ai-model')
  const apiKey = el<HTMLInputElement>('ai-key')
  const baseUrl = el<HTMLInputElement>('ai-baseurl')
  const local = el<HTMLInputElement>('ai-local')
  const web = el<HTMLInputElement>('ai-web')
  const messages = el('ai-messages')
  const status = el('ai-status')
  const question = el<HTMLTextAreaElement>('ai-question')
  const sendButton = el<HTMLButtonElement>('ai-send')
  const stopButton = el<HTMLButtonElement>('ai-stop')
  const clearButton = el<HTMLButtonElement>('ai-clear')
  const saveButton = el<HTMLButtonElement>('ai-savecfg')
  const configToggle = el<HTMLButtonElement>('ai-config-toggle')
  const configBody = el('ai-config-body')
  let workspace: string | null = null
  let turns: AiTurn[] = []
  let busy = false
  let generation = 0
  let initialized = false
  const ragStatus = createRagStatus(el('ai-rag-status'), () => workspace)
  window.addEventListener('pagehide', () => ragStatus.dispose(), { once: true })

  function config(): AiConfig {
    return { provider: provider.value as AiConfig['provider'], model: model.value.trim(), apiKey: apiKey.value.trim(),
      baseUrl: baseUrl.value.trim(), useLocal: local.checked, useWeb: web.checked }
  }
  function addMessage(role: 'user' | 'ai', text: string): HTMLElement {
    const div = document.createElement('div')
    div.className = 'ai-msg ai-msg--' + role
    if (role === 'ai') {
      const body = document.createElement('div')
      body.className = 'ai-answer'
      renderAnswer(body, text)
      div.appendChild(body)
    } else div.textContent = text
    messages.appendChild(div)
    messages.scrollTop = messages.scrollHeight
    return div
  }
  function renderSources(target: HTMLElement, sources: AiSource[]): void {
    if (!sources.length) return
    const details = document.createElement('details')
    details.className = 'ai-turn-sources'
    const summary = document.createElement('summary')
    summary.textContent = '本轮参考资料（' + sources.length + '）'
    details.appendChild(summary)
    for (const source of sources) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'ai-source-item'
      button.textContent = `[${source.id}] ${source.title}`
      button.title = source.snippet
      button.addEventListener('click', () => {
        void (async () => {
          const result = source.type === 'local' && source.path
            ? await window.api.openLocalFile(source.path)
            : source.url && /^https?:\/\//i.test(source.url) ? await window.api.openExternal(source.url) : null
          if (result && !result.ok) status.textContent = result.error
        })().catch(() => { status.textContent = '打开来源失败' })
      })
      details.appendChild(button)
      const snippet = document.createElement('div')
      snippet.className = 'ai-source-item__snip'
      snippet.textContent = source.snippet
      details.appendChild(snippet)
    }
    target.appendChild(details)
  }
  function renderTurn(turn: AiTurn): void {
    addMessage('user', turn.question)
    renderSources(addMessage('ai', turn.answer), turn.sources)
  }
  function setBusy(value: boolean): void {
    busy = value
    sendButton.disabled = value || !initialized
    stopButton.hidden = !value
    clearButton.disabled = value
    stopButton.disabled = false
    sendButton.textContent = value ? '思考中…' : '发送'
  }
  function syncWorkspace(next: string | null): void {
    if (workspace === next && initialized) return
    if (busy) {
      generation++
      void window.api.cancelAiQuery()
    }
    workspace = next
    turns = loadSession(workspace)
    messages.replaceChildren()
    turns.forEach(renderTurn)
    el('ai-workspace-hint').textContent = workspace ? '工作区：' + workspace : '未打开工作区，可使用通用问答'
    status.textContent = ''
    ragStatus.clearOutcome()
  }
  configToggle.addEventListener('click', () => {
    const open = configBody.style.display === 'none'
    configBody.style.display = open ? 'flex' : 'none'
    configToggle.setAttribute('aria-expanded', String(open))
  })
  provider.addEventListener('change', () => {
    const defaults = DEFAULTS[provider.value as AiConfig['provider']]
    baseUrl.value = defaults.baseUrl
    model.value = defaults.model
    apiKey.value = ''
  })
  saveButton.addEventListener('click', () => {
    void (async () => {
      saveButton.disabled = true
      try { await window.api.setAiConfig(config()); status.textContent = '配置已保存' }
      catch { status.textContent = '配置保存失败，请检查系统凭据存储和文件权限' }
      finally { saveButton.disabled = false }
    })()
  })
  clearButton.addEventListener('click', () => {
    if (busy) return
    turns = []
    messages.replaceChildren()
    ragStatus.clearOutcome()
    status.textContent = saveSession(workspace, turns) ? '已开始新对话' : '无法清除已保存的会话，请检查本地存储'
  })
  stopButton.addEventListener('click', () => {
    generation++
    stopButton.disabled = true
    status.textContent = '正在停止…'
    void window.api.cancelAiQuery().catch(() => { status.textContent = '停止请求失败，请等待超时' })
  })
  async function send(): Promise<void> {
    if (busy || !initialized) return
    const text = question.value.trim()
    if (!text) return
    setBusy(true)
    const current = ++generation
    let requestWorkspace = workspace
    let userMessage: HTMLElement | undefined
    let answerMessage: HTMLElement | undefined
    let partial = ''
    let sources: AiSource[] = []
    let unsubscribe: (() => void) | undefined
    let renderTimer: number | undefined
    const requestId = crypto.randomUUID()
    const paint = (): void => {
      if (renderTimer !== undefined) window.clearTimeout(renderTimer)
      renderTimer = undefined
      if (!answerMessage) return
      const follow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80
      renderAnswer(answerMessage.querySelector<HTMLElement>('.ai-answer')!, partial)
      if (follow) messages.scrollTop = messages.scrollHeight
    }
    const markIncomplete = (label: string): void => {
      if (!answerMessage) { userMessage?.remove(); return }
      paint()
      answerMessage.classList.add('ai-msg--incomplete')
      const note = document.createElement('div')
      note.className = 'ai-turn-note'
      note.textContent = label + ' · 回答不完整，未加入后续上下文'
      answerMessage.appendChild(note)
      renderSources(answerMessage, sources)
    }
    try {
      const nextWorkspace = await deps.getWorkspace()
      if (nextWorkspace !== workspace) {
        // 当前请求尚未提交，无需取消；先载入目标工作区会话。
        busy = false
        syncWorkspace(nextWorkspace)
        busy = true
      }
      if (current !== generation) return
      requestWorkspace = workspace
      question.value = ''
      userMessage = addMessage('user', text)
      status.textContent = '正在检索资料并生成回答…'
      unsubscribe = window.api.onAiEvent(event => {
        if (event.requestId !== requestId || current !== generation) return
        if (event.type === 'stage') {
          const labels = { rewriting: '正在理解追问…', local: '正在检索本地文档…', web: '正在搜索网页…', answering: '正在生成回答…' }
          status.textContent = labels[event.stage]
          if (event.stage === 'local') void ragStatus.refresh()
        } else if (event.type === 'sources') sources = event.sources
        else {
          partial += event.text
          if (!answerMessage) answerMessage = addMessage('ai', '')
          if (renderTimer === undefined) renderTimer = window.setTimeout(paint, 50)
        }
      })
      const result = await window.api.aiQuery({ ...config(), requestId, question: text, history: turns.slice(-6) })
      if (current !== generation) return
      if (!result.ok) {
        markIncomplete('生成失败')
        question.value = text
        status.textContent = result.error
        return
      }
      const data: AiQueryResponse = result.value
      const turn: AiTurn = { question: text, answer: data.answer, sources: data.sources }
      turns.push(turn)
      turns = turns.slice(-30)
      if (!answerMessage) answerMessage = addMessage('ai', data.answer)
      else renderAnswer(answerMessage.querySelector<HTMLElement>('.ai-answer')!, data.answer)
      renderSources(answerMessage, data.sources)
      ragStatus.setOutcome(data)
      const saved = saveSession(workspace, turns)
      status.textContent = [
        data.retrievalMode === 'rag' ? '本地混合检索' : data.retrievalMode === 'keyword' ? '本地关键词检索' : '',
        ...data.notices, saved ? '' : '会话保存失败，本次仍可继续问答'
      ].filter(Boolean).join(' · ')
      if (data.retrievalQuery !== text) status.title = '本轮检索问题：' + data.retrievalQuery
    } catch {
      if (current === generation) {
        markIncomplete('连接中断')
        question.value = text
        status.textContent = '请求失败，请检查模型配置后重试'
      }
    } finally {
      unsubscribe?.()
      if (renderTimer !== undefined) window.clearTimeout(renderTimer)
      if (current !== generation) {
        if (requestWorkspace === workspace) {
          markIncomplete('已停止')
          question.value = text
          status.textContent = '已停止，本轮未加入对话'
        }
      }
      setBusy(false)
      question.focus()
    }
  }
  sendButton.addEventListener('click', () => void send())
  question.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void send()
    }
  })
  void (async () => {
    try {
      const [cfg, ws] = await Promise.all([window.api.getAiConfig(), deps.getWorkspace()])
      provider.value = cfg.provider
      model.value = cfg.model
      apiKey.value = cfg.apiKey
      baseUrl.value = cfg.baseUrl
      local.checked = cfg.useLocal
      web.checked = cfg.useWeb
      syncWorkspace(ws)
      if (!cfg.model || (!cfg.apiKey && ['openrouter', 'siliconcloud'].includes(cfg.provider))) {
        configBody.style.display = 'flex'
        configToggle.setAttribute('aria-expanded', 'true')
      }
    } catch { status.textContent = '初始化失败，请重新打开应用' }
    finally { initialized = true; setBusy(false) }
  })()
  return { workspaceChanged: syncWorkspace }
}
