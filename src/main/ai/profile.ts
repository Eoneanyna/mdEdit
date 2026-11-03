import { mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { AiPrivacySettings, AiProfile } from '@shared/ipc'

export const DEFAULT_PRIVACY: AiPrivacySettings = { persistHistory: true, personalize: true, autoLearn: true, localOnly: false }
export const DEFAULT_PREFERENCES = '# 个人 AI 偏好\n\n此文件仅保存在本机。启用个性化时会随问题发送给所选模型。\n可在这里补充回答风格；偏好不作为文档事实或资料引用。\n\n## 手动偏好\n\n- 默认使用中文，术语可附英文。\n\n<!-- mdedit:learned:start -->\n## 自动学习的表达偏好\n\n尚无记录。仅从你明确提出的风格请求中学习，不记录身份或敏感信息。\n<!-- mdedit:learned:end -->\n'
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')

/** 仅归纳明确的表达习惯；不读取回答、网页或笔记，不进行身份画像。 */
export function extractPreferences(question: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = question.replace(/(\x60\x60\x60|~~~)[\s\S]*?\1/g, '').split(/[。！？\n]/).map(s => s.trim()).filter(s => !/^[>“"'\x60]/.test(s))
  for (const line of lines) {
    if (!/^(?:请(?:以后|今后)|以后|今后|我(?:更)?喜欢|我希望|please always)/i.test(line) || /不要|不必|不用|别记|仅本次|这次|本次|临时/.test(line)) continue
    if (/^(?:请(?:以后|今后)?|以后请?|今后请?|我(?:更)?喜欢|我希望)(?:回答|回复|讲解)?(?:尽量|都|更)?(?:简短|简洁|精简)(?:一点|些|回答|回复|$)/.test(line) || /^please always (?:answer|reply) (?:briefly|concisely)/i.test(line)) result['回答长度'] = '简洁，先给结论'
    if (/^(?:请(?:以后|今后)?|以后请?|今后请?|我(?:更)?喜欢|我希望)(?:回答|回复|讲解)?(?:尽量|都|更)?详细(?:一点|些|回答|解释|讲解|$)/.test(line)) result['回答长度'] = '详细，解释步骤与原因'
    if (/^(?:请(?:以后|今后)?|以后请?|今后请?|我(?:更)?喜欢)(?:都)?(?:用|使用)?(?:中文|汉语)(?:回答|回复|讲解|$)/.test(line)) result['回答语言'] = '中文'
    if (/^(?:请(?:以后|今后)?|以后请?|今后请?|我(?:更)?喜欢)(?:都)?(?:用|使用)?(?:英文|英语)(?:回答|回复|讲解|$)/.test(line)) result['回答语言'] = '英文'
    if (/^(?:请(?:以后|今后)?|以后请?|今后请?|我(?:更)?喜欢)(?:都)?(?:用|使用)?(?:列表|分点)(?:回答|回复|解释|呈现|$)/.test(line)) result['组织方式'] = '优先分点列出'
    if (/^(?:请(?:以后|今后)?|以后请?|今后请?|我(?:更)?喜欢)(?:都)?(?:用|使用)?表格(?:回答|回复|比较|对比|呈现|$)/.test(line)) result['组织方式'] = '比较信息时优先使用表格'
    if (/^(?:请(?:以后|今后)?|以后请?|今后请?|我(?:更)?喜欢)(?:都)?(?:多)?(?:举例|给例子|结合例子)(?:解释|说明|讲解|$)/.test(line)) result['举例习惯'] = '解释概念时附具体例子'
  }
  return result
}

export class AiProfileStore {
  readonly path: string
  private privacyPath: string
  private undo: { before: string; after: string } | null = null
  constructor(private directory: string) { this.path = join(directory, 'preferences.md'); this.privacyPath = join(directory, 'privacy.json') }
  private write(path: string, text: string): void {
    mkdirSync(this.directory, { recursive: true })
    const temp = path + '.' + randomUUID() + '.tmp'
    writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, path)
  }
  private readMarkdown(): string {
    try {
      if (statSync(this.path).size > 64000) throw new Error('偏好文件过大，请在本机整理后重新加载')
      return readFileSync(this.path, 'utf8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.write(this.path, DEFAULT_PREFERENCES)
      return DEFAULT_PREFERENCES
    }
  }
  getPrivacy(): AiPrivacySettings {
    try {
      const saved = JSON.parse(readFileSync(this.privacyPath, 'utf8'))
      return Object.fromEntries(Object.entries(DEFAULT_PRIVACY).map(([key, value]) => [key, typeof saved[key] === 'boolean' ? saved[key] : value])) as unknown as AiPrivacySettings
    } catch { return { ...DEFAULT_PRIVACY } }
  }
  setPrivacy(settings: AiPrivacySettings): void {
    const clean = Object.fromEntries(Object.keys(DEFAULT_PRIVACY).map(key => {
      if (typeof settings?.[key as keyof AiPrivacySettings] !== 'boolean') throw new Error('隐私设置格式无效')
      return [key, settings[key as keyof AiPrivacySettings]]
    }))
    this.write(this.privacyPath, JSON.stringify(clean, null, 2))
  }
  get(): AiProfile {
    const markdown = this.readMarkdown()
    return { markdown, path: this.path, revision: hash(markdown), privacy: this.getPrivacy(), canUndo: !!this.undo && this.undo.after === hash(markdown) }
  }
  save(markdown: string, revision: string): AiProfile {
    if (typeof markdown !== 'string' || markdown.length > 8000) throw new Error('偏好文件不能超过 8000 字符')
    if (this.get().revision !== revision) throw new Error('偏好文件已在其他地方修改，请重新加载后再保存')
    this.write(this.path, markdown); this.undo = null
    return this.get()
  }
  clear(): AiProfile { this.write(this.path, DEFAULT_PREFERENCES); this.undo = null; return this.get() }
  undoLearning(): AiProfile {
    const state = this.get()
    if (!this.undo || this.undo.after !== state.revision) throw new Error('没有可撤销的自动更新，或文件已被手动修改')
    this.write(this.path, this.undo.before); this.undo = null
    return this.get()
  }
  learn(question: string): string[] {
    const privacy = this.getPrivacy()
    if (!privacy.personalize || !privacy.autoLearn) return []
    const changes = extractPreferences(question)
    if (!Object.keys(changes).length) return []
    const state = this.get()
    const section = /<!-- mdedit:learned:start -->[\s\S]*?<!-- mdedit:learned:end -->/
    const old = state.markdown.match(section)?.[0] || ''
    const values: Record<string, string> = {}
    for (const match of old.matchAll(/^- ([^：\n]+)：([^\n]+)$/gm)) values[match[1]] = match[2]
    const learned = Object.entries(changes).filter(([key, value]) => values[key] !== value)
    if (!learned.length) return []
    Object.assign(values, changes)
    const replacement = '<!-- mdedit:learned:start -->\n## 自动学习的表达偏好\n\n' + Object.entries(values).map(([key, value]) => '- ' + key + '：' + value).join('\n') + '\n<!-- mdedit:learned:end -->'
    const next = old ? state.markdown.replace(section, replacement) : state.markdown + '\n' + replacement + '\n'
    if (next.length > 8000) throw new Error('偏好文件已满，请手动整理')
    this.write(this.path, next); this.undo = { before: state.markdown, after: hash(next) }
    return learned.map(([key, value]) => key + '：' + value)
  }
}

export function enforceLocalPrivacy(req: import('@shared/ipc').AiQueryRequest, settings: AiPrivacySettings): void {
  if (!settings.localOnly) return
  const url = new URL(req.baseUrl || (req.provider === 'ollama' ? 'http://localhost:11434/v1' : 'https://invalid.example'))
  if (!['http:', 'https:'].includes(url.protocol) || !['ollama', 'custom'].includes(req.provider) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || req.useWeb) {
    throw new Error('仅本机模式只允许本机模型地址，并禁用网页搜索；请调整模型配置或关闭仅本机模式')
  }
}
