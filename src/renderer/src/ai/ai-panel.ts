import type { AiConfig, AiDocumentContext, AiQueryResponse, AiSource, AiTurn } from '@shared/ipc'
import { loadSessions, saveSessions, emptySessions, newSession, clearAllAiHistory, deleteSavedSession, exportSession, type SessionCollection } from './session'
import { createProfilePanel } from './profile-panel'
import { showPrompt } from '../ui/prompt'
import { renderAnswer } from './markdown'
import { createRagStatus } from './rag-status'
import { loadAnswerMode, saveAnswerMode, webStatusLabel, type AnswerMode } from './web-status'

interface AiPanelDeps {
  getWorkspace: () => Promise<string | null>
  getContext: (kind: 'document' | 'selection', allowUnsaved: boolean) => Promise<AiDocumentContext>
  revealContext: (source: AiSource) => Promise<void>
}
const DEFAULTS: Record<AiConfig['provider'], { baseUrl: string; model: string }> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' },
  siliconcloud: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
  custom: { baseUrl: '', model: '' }
}

export function createAiPanel(container: HTMLElement, deps: AiPanelDeps): { workspaceChanged: (workspace: string) => void } {
  container.innerHTML = `
    <div class="ai-panel">
      <div class="ai-panel__controls">
      <div class="ai-panel__config-header">
        <button class="ai-btn" id="ai-config-toggle" type="button" aria-expanded="false">配置</button>
        <button class="ai-btn" id="ai-clear" type="button">新对话</button>
      </div>
      <div class="ai-panel__config" id="ai-config-body" style="display:none">
        <div class="ai-panel__privacy" id="ai-setup-hint">① 选择模型服务，填写模型与 Key（Ollama 可留空） ② 测试连接并保存 ③ 打开笔记文件夹提问</div>
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
          <button class="ai-btn" id="ai-test-connection" type="button">测试连接</button>
        </div>
        <div class="ai-panel__privacy">连接测试仅发送固定的“回复 OK”请求，不附带笔记、会话或偏好；云端测试可能产生少量费用，最长等待 15 秒。</div>
        <div class="ai-panel__privacy" id="ai-connection-status" role="status" aria-live="polite"></div>
        <div class="ai-panel__privacy">安装包内置轻量检索，无需 Python。选择模型并保存 Key，或连接本机 Ollama 即可开始。云端模型会接收问题、偏好、最近 6 轮问答及本轮资料。未保存内容仅在勾选后发送。会话与偏好以明文保存在本机，不会写回笔记。</div>
      </div>
      <div class="ai-session-row"><select class="ai-select" id="ai-session" aria-label="历史会话"></select><button class="ai-btn" id="ai-session-rename">改名</button><button class="ai-btn" id="ai-session-delete">删除</button><button class="ai-btn" id="ai-session-export">导出</button></div>
      <div id="ai-profile"></div>
      <div class="ai-panel__hint" id="ai-workspace-hint"></div>
      <div class="ai-scope-row">
        <label for="ai-scope">范围</label>
        <select class="ai-select" id="ai-scope" aria-label="问答范围">
          <option value="workspace">工作区文档</option><option value="document">当前文档</option><option value="selection">当前选区</option>
        </select>
        <label class="ai-check" id="ai-unsaved-label" hidden><input type="checkbox" id="ai-unsaved" />包含未保存内容</label>
      </div>
      <div id="ai-rag-status"></div>
      </div>
      <select class="ai-select" id="ai-mode" aria-label="回答模式"><option value="auto">智能助手（按需调用工具）</option><option value="notes">笔记问答（不联网）</option><option value="notes-web">联网搜索＋文档（每轮实时检索）</option><option value="general">通用问答（不联网）</option></select>
      <div class="ai-panel__privacy" id="ai-mode-hint"></div>
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
  const testButton = el<HTMLButtonElement>('ai-test-connection')
  const connectionStatus = el('ai-connection-status')
  const configToggle = el<HTMLButtonElement>('ai-config-toggle')
  const configBody = el('ai-config-body')
  const scope = el<HTMLSelectElement>('ai-scope')
  const unsaved = el<HTMLInputElement>('ai-unsaved')
  let workspace: string | null = null
  let turns: AiTurn[] = []
  let busy = false
  let generation = 0
  let initialized = false
  const sessionSelect = el<HTMLSelectElement>('ai-session')
  const mode = el<HTMLSelectElement>('ai-mode')
  let privacy = { persistHistory: false, personalize: false, autoLearn: false, localOnly: false }
  let collection = emptySessions()
  const memory = new Map<string | null, SessionCollection>()
  const profilePanel = createProfilePanel(el('ai-profile'), next => {
    if (initialized && !privacy.persistHistory && next.persistHistory) {
      const stored = loadSessions(workspace)
      for (const item of stored.sessions) if (item.turns.length && !collection.sessions.some(s => s.id === item.id)) collection.sessions.push(item)
    }
    privacy = next
    if (initialized) persistCurrent()
  }, () => {
    clearAllAiHistory(); memory.clear(); collection = emptySessions(); displaySession(); persistCurrent()
  })
  const ragStatus = createRagStatus(el('ai-rag-status'), () => workspace)
  window.addEventListener('pagehide', () => ragStatus.dispose(), { once: true })

  function config(): AiConfig {
    return { provider: provider.value as AiConfig['provider'], model: model.value.trim(), apiKey: apiKey.value.trim(),
      baseUrl: baseUrl.value.trim(), useLocal: local.checked, useWeb: web.checked }
  }
  function openSource(source: AiSource): void {
    void (async () => {
      if (source.type === 'context') { await deps.revealContext(source); return }
      const result = source.type === 'local' && source.path
        ? await window.api.openLocalFile(source.path, source)
        : source.url && /^https?:\/\//i.test(source.url) ? await window.api.openExternal(source.url) : null
      if (result && !result.ok) status.textContent = result.error
    })().catch(error => { status.textContent = error instanceof Error ? error.message : '打开引用失败' })
  }
  function answerBody(target: HTMLElement, text: string, sources: AiSource[]): void {
    renderAnswer(target, text, { sources, open: openSource })
  }
  function addMessage(role: 'user' | 'ai', text: string, sources: AiSource[] = []): HTMLElement {
    const div = document.createElement('div')
    div.className = 'ai-msg ai-msg--' + role
    if (role === 'ai') {
      const body = document.createElement('div')
      body.className = 'ai-answer'
      answerBody(body, text, sources)
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
      button.textContent = `[${source.id}] ${source.title}${source.heading ? ' · ' + source.heading : ''}${source.startLine ? ' · L' + source.startLine + '–' + source.endLine : ''}${source.type === 'context' ? source.dirty ? ' · 未保存快照' : ' · 编辑快照' : ''}`
      if (source.type === 'web') button.textContent += source.webKind === 'page' ? ' · 网页正文' : ' · 搜索摘要'
      button.title = [source.url, source.retrievedAt ? '获取时间：' + source.retrievedAt : '', source.snippet].filter(Boolean).join('\n')
      button.addEventListener('click', () => openSource(source))
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
    const answer = addMessage('ai', turn.answer, turn.sources)
    renderRetrieval(answer, turn.webSearch, turn.sources)
    renderSources(answer, turn.sources)
  }
  function renderRetrieval(target: HTMLElement, state: AiTurn['webSearch'], sources: AiSource[]): void {
    let badge = target.querySelector<HTMLElement>('.ai-turn-retrieval')
    if (!badge) { badge = document.createElement('div'); badge.className = 'ai-turn-retrieval'; target.prepend(badge) }
    badge.textContent = webStatusLabel(state, sources)
    if (state) badge.title = '本轮联网查询：' + (state.query || '未发起') + '\n' + state.attempts.map(attempt => attempt.engine + '：' +
      ({ ok: '找到相关结果', empty: '没有结果', filtered: '候选均不相关', error: '访问失败或受限' }[attempt.outcome])).join('\n')
  }
  function updateMode(persist = false): void {
    web.checked = mode.value === 'notes-web' || mode.value === 'auto'
    scope.disabled = busy || mode.value === 'general'
    el('ai-mode-hint').textContent = mode.value === 'notes-web'
      ? '每轮联网搜索并筛选网页，与所选文档一起回答；检索问题会发送给搜索引擎。'
      : mode.value === 'auto' ? '助手按需检索、补查或反问；可能将查询发送到搜索引擎。仅本机模式下不会联网。' : mode.value === 'notes' ? '本轮只查文档，不联网。需要实时网络资料请选择“联网搜索＋文档”。' : '只使用模型知识，不联网、不检索文档。'
    if (persist && !saveAnswerMode(mode.value as AnswerMode)) status.textContent = '模式已切换，但保存失败，重启后需重新选择'
  }
  function setBusy(value: boolean): void {
    busy = value
    sendButton.disabled = value || !initialized
    stopButton.hidden = !value
    clearButton.disabled = value
    scope.disabled = value || mode.value === 'general'
    mode.disabled = value
    sessionSelect.disabled = value
    for (const id of ['ai-session-rename', 'ai-session-delete', 'ai-session-export']) el<HTMLButtonElement>(id).disabled = value
    profilePanel.setBusy(value)
    testButton.disabled = value || !initialized
    saveButton.disabled = value || !initialized
    for (const input of [provider, model, apiKey, baseUrl, local, web]) input.disabled = value
    unsaved.disabled = value
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
    collection = initialized && memory.get(workspace) || loadSessions(workspace, privacy.persistHistory)
    memory.set(workspace, collection)
    displaySession()
    el('ai-workspace-hint').textContent = workspace ? '工作区：' + workspace : '未打开工作区，可使用通用问答'
    status.textContent = ''
    ragStatus.clearOutcome()
  }
  configToggle.addEventListener('click', () => {
    const open = configBody.style.display === 'none'
    configBody.style.display = open ? 'flex' : 'none'
    configToggle.setAttribute('aria-expanded', String(open))
  })
  scope.addEventListener('change', () => {
    unsaved.checked = false
    el('ai-unsaved-label').hidden = scope.value === 'workspace'
    status.textContent = scope.value === 'selection' ? '发送时读取编辑器选区；本轮只使用选区和可选网页资料。' : scope.value === 'document' ? '本轮只使用当前文档和可选网页资料。' : ''
  })
  provider.addEventListener('change', () => {
    const defaults = DEFAULTS[provider.value as AiConfig['provider']]
    baseUrl.value = defaults.baseUrl
    model.value = defaults.model
    apiKey.value = ''
  })
  for (const input of [provider, model, apiKey, baseUrl]) input.addEventListener('input', () => {
    connectionStatus.textContent = '配置已修改，请重新测试；测试不会自动保存配置。'
  })
  testButton.addEventListener('click', () => { void (async () => {
    if (busy || !initialized) return
    const current = ++generation
    setBusy(true); sendButton.textContent = '测试中…'
    status.textContent = ''
    connectionStatus.textContent = '正在测试模型连接…'
    try {
      const result = await window.api.testAiConnection(config())
      if (current !== generation) { connectionStatus.textContent = '连接测试已停止'; return }
      connectionStatus.textContent = result.ok
        ? `连接成功：${result.value.model} · ${(result.value.latencyMs / 1000).toFixed(1)} 秒；可保存配置后提问。`
        : result.error + (provider.value === 'ollama' ? '。请确认 Ollama 已运行，且已下载此聊天模型。' : '。请检查模型名称、Key、接口地址及账户额度。')
    } catch { connectionStatus.textContent = '测试失败，请检查连接后重试' }
    finally { if (current !== generation) status.textContent = '连接测试已停止'; setBusy(false) }
  })() })
  saveButton.addEventListener('click', () => {
    void (async () => {
      saveButton.disabled = true
      try { await window.api.setAiConfig(config()); status.textContent = '配置已保存' }
      catch { status.textContent = '配置保存失败，请检查系统凭据存储和文件权限' }
      finally { saveButton.disabled = false }
    })()
  })
  function displaySession(): void {
    const active = collection.sessions.find(s => s.id === collection.activeId) || collection.sessions[0]
    collection.activeId = active.id; turns = active.turns
    messages.replaceChildren(); turns.forEach(renderTurn)
    sessionSelect.replaceChildren(...collection.sessions.map(item => {
      const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; return option
    }))
    sessionSelect.value = active.id
  }
  function persistCurrent(): boolean {
    const active = collection.sessions.find(s => s.id === collection.activeId)!
    active.turns = turns; active.updatedAt = Date.now()
    if (active.title === '新对话' && turns.length) active.title = turns[0].question.slice(0, 30)
    memory.set(workspace, collection)
    for (const option of sessionSelect.options) option.textContent = collection.sessions.find(s => s.id === option.value)!.title
    return saveSessions(workspace, collection, privacy.persistHistory)
  }
  clearButton.addEventListener('click', () => {
    if (busy) return
    if (collection.sessions.length >= 50) { status.textContent = '会话已达 50 个，请先导出并删除旧会话'; return }
    const next = newSession(); collection.sessions.unshift(next); collection.activeId = next.id
    displaySession()
    ragStatus.clearOutcome()
    status.textContent = persistCurrent() ? '已开始新对话，旧对话可在列表中切换' : '会话保存失败'
  })
  sessionSelect.addEventListener('change', () => { collection.activeId = sessionSelect.value; displaySession(); persistCurrent(); ragStatus.clearOutcome() })
  el('ai-session-rename').addEventListener('click', () => { void (async () => {
    const active = collection.sessions.find(s => s.id === collection.activeId)!
    const title = await showPrompt({ title: '会话名称', defaultValue: active.title, validate: value => !value.trim() || value.length > 100 ? '请输入 1–100 字符' : null })
    if (title !== null) { active.title = title.trim(); persistCurrent(); displaySession() }
  })() })
  el('ai-session-delete').addEventListener('click', () => {
    if (!window.confirm('删除当前会话和引用快照吗？')) return
    const deleted = deleteSavedSession(workspace, collection.activeId)
    collection.sessions = collection.sessions.filter(s => s.id !== collection.activeId)
    if (!collection.sessions.length) collection = emptySessions()
    collection.activeId = collection.sessions[0].id; displaySession(); persistCurrent()
    status.textContent = deleted ? '会话已删除' : '本机记录删除失败，请检查本地存储或使用清除全部会话'
  })
  el('ai-session-export').addEventListener('click', () => { void (async () => {
    try {
      const active = collection.sessions.find(s => s.id === collection.activeId)!
      const path = await window.api.chooseSavePath(active.title.replace(/[\\/:*?"<>|]/g, '_') + '.md')
      if (path) { const result = await window.api.writeFile(path, exportSession(active)); status.textContent = result.ok ? '会话已导出' : result.error }
    } catch { status.textContent = '导出失败，请重试' }
  })() })
  mode.addEventListener('change', () => updateMode(true))
  web.addEventListener('change', () => { mode.value = web.checked ? 'notes-web' : 'notes'; updateMode(true) })
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
      answerBody(answerMessage.querySelector<HTMLElement>('.ai-answer')!, partial, sources)
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
      const context = mode.value === 'general' || scope.value === 'workspace' ? undefined : await deps.getContext(scope.value as 'document' | 'selection', unsaved.checked)
      if (current !== generation) return
      question.value = ''
      userMessage = addMessage('user', text)
      status.textContent = '正在检索资料并生成回答…'
      unsubscribe = window.api.onAiEvent(event => {
        if (event.requestId !== requestId || current !== generation) return
        if (event.type === 'tool') {
          status.textContent = `${event.name}：${event.state === 'running' ? '执行中' : event.state === 'done' ? '完成' : '失败'}`
          if (!answerMessage) answerMessage = addMessage('ai', '')
          let trace = answerMessage.querySelector('details.ai-tool-trace')
          if (!trace) {
            trace = document.createElement('details'); trace.className = 'ai-tool-trace'
            const summary = document.createElement('summary'); summary.textContent = '工具执行记录'
            trace.append(summary); answerMessage.prepend(trace)
          }
          const entry = document.createElement('div'); entry.textContent = status.textContent; trace.append(entry)
        } else if (event.type === 'stage') {
          const labels = { rewriting: '正在理解追问…', local: '正在检索本地文档…', web: '正在搜索网页…', answering: '正在生成回答…' }
          status.textContent = labels[event.stage]
          if (event.stage === 'local') void ragStatus.refresh()
        } else if (event.type === 'sources') sources = event.sources
        else if (event.type === 'web-status') status.textContent = webStatusLabel(event.status, sources)
        else if (event.type === 'delta') {
          partial += event.text
          if (!answerMessage) answerMessage = addMessage('ai', '')
          if (renderTimer === undefined) renderTimer = window.setTimeout(paint, 50)
        }
      })
      const result = await window.api.aiQuery({ ...config(), mode: mode.value as AnswerMode, useLocal: mode.value !== 'general' && scope.value === 'workspace' && local.checked,
        context, requestId, question: text, history: turns.slice(-6) })
      if (current !== generation) return
      if (!result.ok) {
        markIncomplete('生成失败')
        question.value = text
        status.textContent = result.error
        return
      }
      const data: AiQueryResponse = result.value
      const turn: AiTurn = { question: text, answer: data.answer, sources: data.sources, webSearch: data.webSearch }
      turns.push(turn)
      turns = turns.slice(-30)
      if (!answerMessage) answerMessage = addMessage('ai', data.answer, data.sources)
      else answerBody(answerMessage.querySelector<HTMLElement>('.ai-answer')!, data.answer, data.sources)
      renderRetrieval(answerMessage, data.webSearch, data.sources)
      renderSources(answerMessage, data.sources)
      ragStatus.setOutcome(data)
      const saved = persistCurrent()
      if (data.learnedPreferences?.length) void profilePanel.refresh().catch(() => {})
      status.textContent = [
        data.retrievalMode === 'rag' ? '本地混合检索' : data.retrievalMode === 'keyword' ? '本地关键词检索' : '',
        ...data.notices, data.learnedPreferences?.length ? '已更新个人偏好，可在设置中撤销' : '', saved ? '' : '会话保存失败，本次仍可继续问答'
      ].filter(Boolean).join(' · ')
      if (data.retrievalQuery !== text) status.title = '本轮检索问题：' + data.retrievalQuery
    } catch (error) {
      if (current === generation) {
        markIncomplete('连接中断')
        question.value = text
        status.textContent = error instanceof Error ? error.message : '请求失败，请检查模型配置后重试'
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
      const [cfg, ws] = await Promise.all([window.api.getAiConfig(), deps.getWorkspace(), profilePanel.load()])
      provider.value = cfg.provider
      model.value = cfg.model
      apiKey.value = cfg.apiKey
      baseUrl.value = cfg.baseUrl
      local.checked = cfg.useLocal
      web.checked = cfg.useWeb
      mode.value = loadAnswerMode(cfg.useWeb)
      updateMode()
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
