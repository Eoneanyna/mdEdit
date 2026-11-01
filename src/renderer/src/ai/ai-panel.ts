import type { AiQueryResponse, AiSource } from '@shared/ipc'

interface AiPanelDeps {
  getWorkspace: () => Promise<string | null>
}

export function createAiPanel(container: HTMLElement, deps: AiPanelDeps): void {
  container.innerHTML = `
    <div class="ai-panel">
      <div class="ai-panel__config-header">
        <button class="ai-panel__toggle" id="ai-config-toggle" type="button">配置</button>
        <button class="ai-btn" id="ai-savecfg" type="button">保存配置</button>
      </div>
      <div class="ai-panel__config" id="ai-config-body" style="display:none">
        <select class="ai-select" id="ai-provider">
          <option value="openrouter">OpenRouter</option>
          <option value="siliconcloud">SiliconCloud</option>
          <option value="ollama">Ollama</option>
          <option value="custom">自定义</option>
        </select>
        <input class="ai-input" id="ai-model" placeholder="模型名,如 deepseek/deepseek-chat-v3-0324:free(OpenRouter)或 deepseek-ai/DeepSeek-V3(SiliconCloud)" />
        <input class="ai-input" id="ai-key" type="password" placeholder="API Key（Ollama 可留空）" />
        <input class="ai-input" id="ai-baseurl" placeholder="Base URL（可选）" />
        <div class="ai-panel__row">
          <label class="ai-check"><input type="checkbox" id="ai-local" checked /> 搜索本地 .md</label>
          <label class="ai-check"><input type="checkbox" id="ai-web" /> 搜索网页</label>
        </div>
        <div class="ai-panel__hint" id="ai-workspace-hint"></div>
      </div>
      <div class="ai-panel__messages" id="ai-messages"></div>
      <div class="ai-panel__sources" id="ai-sources"></div>
      <div class="ai-panel__input">
        <textarea class="ai-textarea" id="ai-question" placeholder="问问本地文档或让 AI 帮忙..."></textarea>
        <button class="ai-btn ai-btn--primary" id="ai-send" type="button">发送</button>
      </div>
    </div>
  `

  const providerEl = container.querySelector<HTMLSelectElement>('#ai-provider')!
  const modelEl = container.querySelector<HTMLInputElement>('#ai-model')!
  const keyEl = container.querySelector<HTMLInputElement>('#ai-key')!
  const baseEl = container.querySelector<HTMLInputElement>('#ai-baseurl')!
  const localEl = container.querySelector<HTMLInputElement>('#ai-local')!
  const webEl = container.querySelector<HTMLInputElement>('#ai-web')!
  const saveBtn = container.querySelector<HTMLButtonElement>('#ai-savecfg')!
  const configToggle = container.querySelector<HTMLButtonElement>('#ai-config-toggle')
  const configBody = container.querySelector<HTMLDivElement>('#ai-config-body')
  if (configToggle && configBody) {
    configToggle.addEventListener('click', () => {
      const hidden = configBody.style.display === 'none'
      configBody.style.display = hidden ? 'flex' : 'none'
      configToggle.textContent = hidden ? '配置 ▲' : '配置'
    })
  }
  const hintEl = container.querySelector<HTMLDivElement>('#ai-workspace-hint')!
  const msgEl = container.querySelector<HTMLDivElement>('#ai-messages')!
  const srcEl = container.querySelector<HTMLDivElement>('#ai-sources')!
  const qEl = container.querySelector<HTMLTextAreaElement>('#ai-question')!
  const sendBtn = container.querySelector<HTMLButtonElement>('#ai-send')!

  void deps.getWorkspace().then((ws) => {
    hintEl.textContent = ws ? '工作区：' + ws : '未打开工作区，仅能使用网页搜索或通用回答'
  })

  void (window.api as any).getAiConfig().then((cfg: any) => {
    if (!cfg) return
    providerEl.value = cfg.provider || 'openrouter'
    modelEl.value = cfg.model || ''
    keyEl.value = cfg.apiKey || ''
    baseEl.value = cfg.baseUrl || ''
    localEl.checked = cfg.useLocal !== false
    webEl.checked = !!cfg.useWeb
  })

  saveBtn.addEventListener('click', () => {
    const cfg = {
      provider: providerEl.value,
      model: modelEl.value,
      apiKey: keyEl.value,
      baseUrl: baseEl.value,
      useLocal: localEl.checked,
      useWeb: webEl.checked
    }
    void (window.api as any).setAiConfig(cfg)
    saveBtn.textContent = '已保存'
    setTimeout(() => (saveBtn.textContent = '保存配置'), 1000)
  })

  providerEl.addEventListener('change', () => {
    if (providerEl.value === 'openrouter' && !baseEl.value) baseEl.value = 'https://openrouter.ai/api/v1'
    if (providerEl.value === 'siliconcloud' && !baseEl.value) baseEl.value = 'https://api.siliconflow.cn/v1'
    if (providerEl.value === 'ollama' && !baseEl.value) baseEl.value = 'http://localhost:11434/v1'
  })

  function addMsg(role: 'user' | 'ai', text: string) {
    const div = document.createElement('div')
    div.className = 'ai-msg ai-msg--' + role
    div.textContent = text
    msgEl.appendChild(div)
    msgEl.scrollTop = msgEl.scrollHeight
  }

  function renderSources(sources: AiSource[]) {
    srcEl.innerHTML = ''
    if (!sources || sources.length === 0) return
    const title = document.createElement('div')
    title.className = 'ai-sources__title'
    title.textContent = '搜索到的相关信息'
    srcEl.appendChild(title)
    for (const s of sources) {
      const item = document.createElement('div')
      item.className = 'ai-source-item'
      item.innerHTML = `<span class="ai-source-item__id">[${s.id}]</span> <span class="ai-source-item__name">${escapeHtml(s.title)}</span>`
      item.addEventListener('click', () => {
        if (s.type === 'local' && s.path) {
          void (window.api as any).openLocalFile(s.path)
        } else if (s.type === 'web' && s.url) {
          void (window.api as any).openExternal(s.url)
        }
      })
      const snip = document.createElement('div')
      snip.className = 'ai-source-item__snip'
      snip.textContent = s.snippet
      item.appendChild(snip)
      srcEl.appendChild(item)
    }
  }

  function escapeHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  async function send() {
    const question = qEl.value.trim()
    if (!question) return
    qEl.value = ''
    addMsg('user', question)
    sendBtn.disabled = true
    sendBtn.textContent = '思考中...'
    srcEl.innerHTML = ''
    try {
      const cfg = {
        provider: providerEl.value,
        model: modelEl.value,
        apiKey: keyEl.value,
        baseUrl: baseEl.value,
        useLocal: localEl.checked,
        useWeb: webEl.checked,
        question
      }
      const res: any = await (window.api as any).aiQuery(cfg)
      if (res && res.ok) {
        const data = res.value as AiQueryResponse
        addMsg('ai', data.answer)
        renderSources(data.sources)
      } else {
        addMsg('ai', '错误：' + (res?.error || '未知错误'))
      }
    } catch (e: any) {
      addMsg('ai', '错误：' + e.message)
    } finally {
      sendBtn.disabled = false
      sendBtn.textContent = '发送'
    }
  }

  sendBtn.addEventListener('click', () => void send())
  qEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  })
}
