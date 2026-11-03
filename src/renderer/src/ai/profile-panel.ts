import type { AiPrivacySettings, AiProfile } from '@shared/ipc'

export function createProfilePanel(container: HTMLElement, onPrivacy: (settings: AiPrivacySettings) => void, clearHistory: () => void) {
  container.innerHTML = `<details class="ai-profile-panel"><summary>个人偏好与隐私</summary>
    <label class="ai-check"><input id="ai-personalize" type="checkbox" />使用本机偏好（云端模型也会收到这些偏好）</label>
    <label class="ai-check"><input id="ai-auto-learn" type="checkbox" />自动记住明确的语言、长度、列表等表达偏好</label>
    <label class="ai-check"><input id="ai-persist-history" type="checkbox" />保存会话到本机（关闭不删除已有记录）</label>
    <label class="ai-check"><input id="ai-local-only" type="checkbox" />仅允许本机模型地址，禁用网页搜索</label>
    <div class="ai-panel__privacy">自动学习只在本机分析你发送的问题，不分析笔记或网页，不额外发送聊天做画像。临时提问和身份信息不会自动写入偏好。</div>
    <div id="ai-preferences-path" class="ai-preferences-path"></div>
    <textarea id="ai-preferences-editor" aria-label="个人偏好 Markdown" maxlength="8000"></textarea>
    <div class="ai-panel__row"><button class="ai-btn" id="ai-preferences-save">保存偏好</button><button class="ai-btn" id="ai-preferences-reload">重新加载</button>
      <button class="ai-btn" id="ai-preferences-undo">撤销自动更新</button><button class="ai-btn" id="ai-preferences-clear">清空偏好</button>
      <button class="ai-btn" id="ai-history-clear-all">清除全部本机会话</button></div>
    <div id="ai-profile-status" role="status"></div></details>`
  const el = <T extends HTMLElement>(id: string): T => container.querySelector<T>('#' + id)!
  const editor = el<HTMLTextAreaElement>('ai-preferences-editor')
  const status = el('ai-profile-status')
  let profile: AiProfile | undefined
  let edited = false
  let busy = false
  let changing = false
  function lock(): void {
    for (const input of container.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>('input,button,textarea')) input.disabled = busy || changing
    if (profile && !busy && !changing) el<HTMLButtonElement>('ai-preferences-undo').disabled = !profile.canUndo
  }
  const flags = { personalize: el<HTMLInputElement>('ai-personalize'), autoLearn: el<HTMLInputElement>('ai-auto-learn'),
    persistHistory: el<HTMLInputElement>('ai-persist-history'), localOnly: el<HTMLInputElement>('ai-local-only') }
  function apply(next: AiProfile): void {
    profile = next
    editor.value = next.markdown; edited = false
    el('ai-preferences-path').textContent = '本机文件：' + next.path
    for (const [key, input] of Object.entries(flags)) input.checked = next.privacy[key as keyof AiPrivacySettings]
    el<HTMLButtonElement>('ai-preferences-undo').disabled = !next.canUndo
    onPrivacy(next.privacy)
    lock()
  }
  async function action(fn: () => Promise<AiProfile>, message: string): Promise<void> {
    changing = true; lock()
    try { apply(await fn()); status.textContent = message }
    catch (error) { status.textContent = error instanceof Error ? error.message : '操作失败，请重试' }
    finally { changing = false; lock() }
  }
  editor.addEventListener('input', () => { edited = true })
  for (const input of Object.values(flags)) input.addEventListener('change', () => {
    void (async () => {
      if (!profile || changing || busy) return
      changing = true; lock()
      const next = Object.fromEntries(Object.entries(flags).map(([key, flag]) => [key, flag.checked])) as unknown as AiPrivacySettings
      try { await window.api.setAiPrivacy(next); profile.privacy = next; onPrivacy(next); status.textContent = '隐私设置已保存' }
      catch { for (const [key, flag] of Object.entries(flags)) flag.checked = profile.privacy[key as keyof AiPrivacySettings]; status.textContent = '隐私设置保存失败' }
      finally { changing = false; lock() }
    })()
  })
  el('ai-preferences-save').addEventListener('click', () => {
    if (profile) void action(() => window.api.saveAiPreferences(editor.value, profile!.revision), '个人偏好已保存')
  })
  el('ai-preferences-reload').addEventListener('click', () => {
    if (edited && !window.confirm('放弃未保存的偏好编辑并重新加载吗？')) return
    void action(() => window.api.getAiProfile(), '已重新加载本机偏好')
  })
  el('ai-preferences-clear').addEventListener('click', () => {
    if (window.confirm('清空手动和自动记录的个人偏好，恢复默认模板吗？')) void action(() => window.api.clearAiPreferences(), '已清空偏好记录')
  })
  el('ai-preferences-undo').addEventListener('click', () => {
    if (edited) { status.textContent = '请先保存或重新加载当前偏好编辑'; return }
    void action(() => window.api.undoAiPreferences(), '已撤销最近一次自动更新')
  })
  el('ai-history-clear-all').addEventListener('click', () => {
    if (window.confirm('清除所有工作区保存在本机的 AI 会话和引用快照吗？此操作不会删除笔记或 API Key。')) {
      clearHistory(); status.textContent = '全部本机会话已清除'
    }
  })
  return {
    setBusy: (value: boolean) => { busy = value; lock() },
    load: async () => { const next = await window.api.getAiProfile(); apply(next); return next },
    refresh: async () => { if (edited) { status.textContent = '本机偏好有更新；当前编辑未覆盖，可先保存或重新加载。'; return } apply(await window.api.getAiProfile()) }
  }
}
