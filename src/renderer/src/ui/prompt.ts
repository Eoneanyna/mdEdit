export interface PromptOptions {
  title: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  /** 预选中的字符范围,例如只选中文件名主干而不含扩展名 */
  selectRange?: [number, number]
  /** 返回错误文案表示不通过,返回 null 表示可提交 */
  validate?: (value: string) => string | null
}

/**
 * 输入对话框。Electron 的渲染进程不支持 window.prompt,
 * 因此自行实现;返回 null 表示用户取消。
 */
export function showPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const mask = document.createElement('div')
    mask.className = 'prompt-mask'
    mask.innerHTML = `
      <div class="prompt" role="dialog">
        <div class="prompt__title"></div>
        <input class="prompt__input" type="text" spellcheck="false" />
        <div class="prompt__error"></div>
        <div class="prompt__actions">
          <button class="prompt__btn" type="button" data-act="cancel">取消</button>
          <button class="prompt__btn prompt__btn--primary" type="button" data-act="ok"></button>
        </div>
      </div>
    `

    const titleEl = mask.querySelector<HTMLElement>('.prompt__title')!
    const input = mask.querySelector<HTMLInputElement>('.prompt__input')!
    const errorEl = mask.querySelector<HTMLElement>('.prompt__error')!
    const okButton = mask.querySelector<HTMLElement>('[data-act="ok"]')!

    titleEl.textContent = options.title
    okButton.textContent = options.confirmLabel ?? '确定'
    input.value = options.defaultValue ?? ''
    if (options.placeholder) input.placeholder = options.placeholder

    let settled = false
    function close(value: string | null): void {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', onKeyDown, true)
      mask.remove()
      resolve(value)
    }

    function submit(): void {
      const value = input.value.trim()
      const error = options.validate?.(value) ?? (value ? null : '名称不能为空')
      if (error) {
        errorEl.textContent = error
        input.focus()
        return
      }
      close(value)
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(null)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        submit()
      }
    }

    // 输入即清除上一次的错误提示,避免旧文案滞留
    input.addEventListener('input', () => (errorEl.textContent = ''))

    mask.addEventListener('mousedown', (event) => {
      if (event.target === mask) close(null)
    })

    mask.addEventListener('click', (event) => {
      const act = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
      if (act === 'cancel') close(null)
      else if (act === 'ok') submit()
    })

    document.addEventListener('keydown', onKeyDown, true)
    document.body.appendChild(mask)

    input.focus()
    if (options.selectRange) input.setSelectionRange(...options.selectRange)
    else input.select()
  })
}
