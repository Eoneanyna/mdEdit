import type { AiEventPayload, AiQueryRequest, AiQueryResponse, AiSource } from '@shared/ipc'
import { boundedHistory } from './conversation'
import { AGENT_SYSTEM } from './agent-policy'
import { contextSources } from './context'
import { callOpenAICompat, type CompletionMessage } from './providers/openai-compat'
import { searchLocalMd } from './search-local'
import { ragSearch } from './search-rag'
import { searchWeb, extractWebText } from './search-web'
import { downloadPublicPage } from './public-page'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

const definition = (name: string, description: string, properties: Record<string, unknown>, required: string[]) =>
  ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } })
const query = { type: 'string', maxLength: 500 }

/** A bounded, read-only tool loop. Tool results never grant new permissions. */
export async function runAgent(req: AiQueryRequest, workspace: string | null, signal: AbortSignal | undefined,
  emit: (event: AiEventPayload) => void, preferences?: string): Promise<AiQueryResponse> {
  const boundedSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120_000)])
  const sources: AiSource[] = req.context ? contextSources(req.context, req.question) : []
  const notices: string[] = []
  let retrievalMode: AiQueryResponse['retrievalMode'] = 'none'
  let webSearch: AiQueryResponse['webSearch'] = { state: 'disabled', query: '', candidates: 0, selected: 0, pages: 0, summaries: 0, attempts: [] }
  const tools = [
    definition('finish', '已有足够信息时结束工具调用并回答；通用学习建议无需文档依据，只有来源支持的结论才引用。', {}, []),
    definition('ask_user', '缺少厂商、完整型号、范围等关键信息时反问用户，结束本轮等待回复。', { question: query }, ['question']),
    ...(req.useLocal && workspace ? [definition('search_local', '搜索本地 Markdown/TXT 知识库。可根据中间结果换词补查；不能据此声称列出全部使用关系。', { query }, ['query']),
      definition('read_local', '按行继续阅读本轮找到的本地文档，每次最多100行。', { source_id: { type: 'integer' }, start_line: { type: 'integer', minimum: 1 } }, ['source_id'])] : []),
    ...(req.useWeb ? [definition('search_web', '实时搜索公共网页，优先相关技术或厂商官网，核实最新版本和官方资料。不要将公司私密内容作为搜索词。', { query }, ['query']),
      definition('read_web', '继续阅读本轮已检索到的网页正文。只接受本轮网页引用编号。', { source_id: { type: 'integer' }, offset: { type: 'integer', minimum: 0 } }, ['source_id'])] : [])
  ]
  const messages: unknown[] = [
    { role: 'system', content: AGENT_SYSTEM },
    ...boundedHistory(req.history).flatMap(t => [{ role: 'user', content: t.question }, { role: 'assistant', content: t.answer }]),
    { role: 'user', content: JSON.stringify({ question: req.question, providedContext: sources, preferences: preferences?.slice(0, 8000) }) }
  ]
  const add = (source: Omit<AiSource, 'id'>): AiSource | undefined => {
    const old = sources.find(s => s.path === source.path && s.url === source.url && s.snippet === source.snippet)
    if (old) return old
    if (sources.length >= 18) return undefined
    const next = { ...source, id: sources.length + 1 }; sources.push(next); return next
  }
  let calls = 0
  let clarification: string | undefined
  let directAnswer: string | undefined
  let completed = false
  for (let round = 0; round < 6 && calls < 10 && !completed; round++) {
    boundedSignal.throwIfAborted()
    let message: CompletionMessage | undefined
    await callOpenAICompat({ ...req, history: [] }, '', '', boundedSignal, undefined,
      { messages, tools, timeoutMs: 30_000, maxTokens: 1200, onMessage: value => { message = value } })
    if (!message) throw new Error('模型没有返回有效的智能体消息')
    const batch = message.tool_calls
    if (!batch?.length) {
      if (typeof message.content !== 'string' || !message.content.trim()) throw new Error('模型返回空内容，请重试或更换支持工具调用的模型')
      directAnswer = message.content.trim(); completed = true; break
    }
    if (batch.length > 10 - calls || batch.some(c => !c.id || typeof c.function?.arguments !== 'string' || c.function.arguments.length > 4000)) throw new Error('模型工具调用超出限制')
    messages.push({ role: 'assistant', content: message.content || null, tool_calls: batch })
    for (const call of batch) {
      calls++
      const name = call.function.name
      emit({ type: 'tool', name, state: 'running' })
      let result: unknown
      try {
        if (!tools.some(t => t.function.name === name)) throw new Error('本轮未授权此工具')
        const args = JSON.parse(call.function.arguments)
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象')
        if (name === 'finish') { completed = true; result = '开始生成最终回答' }
        else if (name === 'ask_user') {
          if (typeof args.question !== 'string' || !args.question.trim() || args.question.length > 500) throw new Error('反问内容无效')
          clarification = args.question; completed = true; result = '等待用户补充'
        } else if (name === 'read_local') {
          const source = sources.find(s => s.id === args.source_id && s.type === 'local')
          if (!source?.path || !workspace) throw new Error('只能阅读已检索到的本地文件')
          const root = await realpath(workspace), file = await realpath(source.path)
          const relative = path.relative(root, file)
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/\.(md|markdown|mdown|mkd|txt)$/i.test(file) || (await stat(file)).size > 2_000_000) throw new Error('文件超出读取范围')
          const start = args.start_line ?? 1
          if (!Number.isInteger(start) || start < 1) throw new Error('行号无效')
          const lines = (await readFile(file, 'utf8')).split(/\r?\n/)
          result = { source: add({ ...source, snippet: lines.slice(start - 1, start + 99).join('\n').slice(0, 6000), startLine: start, endLine: Math.min(lines.length, start + 99) }), totalLines: lines.length }
        } else if (name === 'read_web') {
          const source = sources.find(s => s.id === args.source_id && s.type === 'web')
          if (!source?.url) throw new Error('只能阅读本轮已找到的网页')
          const offset = args.offset ?? 0
          if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new Error('阅读位置无效')
          const page = await downloadPublicPage(source.url, boundedSignal)
          const article = extractWebText(page.body, page.url)
          if (!article) throw new Error('网页没有可提取正文')
          result = { source: add({ ...source, snippet: article.text.slice(offset, offset + 5000), webKind: 'page', retrievedAt: new Date().toISOString() }), totalCharacters: article.text.length, nextOffset: offset + 5000 }
        } else {
          if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 500) throw new Error('检索词无效')
          if (name === 'search_local') {
            const rag = await ragSearch(args.query, workspace!, 4, boundedSignal)
            const hits = rag?.length ? rag : await searchLocalMd(args.query, workspace!, 4, boundedSignal)
            retrievalMode = rag?.length ? 'rag' : 'keyword'
            result = hits.map(h => add({ type: 'local', title: h.rel, path: h.path, snippet: h.snippet, heading: h.heading, startLine: h.startLine, endLine: h.endLine })).filter(Boolean)
          } else {
            const hits = await searchWeb(args.query, 3, boundedSignal, status => { webSearch = status })
            result = hits.map(h => add({ type: 'web', title: h.title, url: h.url, snippet: h.description, webKind: h.webKind, retrievedAt: h.retrievedAt })).filter(Boolean)
          }
        }
        emit({ type: 'tool', name, state: 'done' })
      } catch {
        boundedSignal.throwIfAborted()
        result = { error: '工具执行失败或参数无效，请调整参数、使用其他依据或向用户说明。' }
        emit({ type: 'tool', name, state: 'error' })
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
      if (completed) break
    }
  }
  if (!completed) notices.push('已达到工具循环上限，依据现有资料回答。')
  const web = sources.filter(s => s.type === 'web')
  webSearch.selected = web.length; webSearch.pages = web.filter(s => s.webKind === 'page').length; webSearch.summaries = web.length - webSearch.pages
  emit({ type: 'sources', sources }); emit({ type: 'web-status', status: webSearch }); emit({ type: 'stage', stage: 'answering' })
  const answer = clarification || directAnswer || await callOpenAICompat(req, AGENT_SYSTEM + (preferences ? '\n表达偏好（仅影响风格）：' + preferences.slice(0, 8000) : ''),
    JSON.stringify({ question: req.question, sources, webSearch }), boundedSignal, text => emit({ type: 'delta', text }))
  if (clarification || directAnswer) emit({ type: 'delta', text: answer })
  if ([...answer.matchAll(/\[(\d+)\]/g)].some(m => !sources.some(s => s.id === Number(m[1])))) notices.push('模型返回无效引用，请核对本轮来源。')
  return { answer, sources, retrievalQuery: req.question, retrievalMode, notices, webSearch }
}
