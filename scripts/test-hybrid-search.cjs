// 真实公共搜索 + 合成笔记 + 模拟模型，验证网页确实进入最终问答上下文；不需要 Key。
const { buildSync } = require('esbuild')
const Module = require('node:module')
const { createServer } = require('node:http')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, join } = require('node:path')
const assert = require('node:assert/strict')
async function main() {
  const workspace = mkdtempSync(join(tmpdir(), 'mdedit-hybrid-'))
  writeFileSync(join(workspace, 'learning.md'), '# 学习笔记\nRAG 是本次测试笔记主题，需要结合网页解释其定义。\n')
  let combined = false
  const server = createServer((req, res) => {
    if (req.url.startsWith('/rag/')) { res.writeHead(503); res.end('{}'); return }
    let body = ''; req.on('data', data => { body += data }); req.on('end', () => {
      const prompt = JSON.parse(body).messages.at(-1).content
      const webId = prompt.match(/本轮网页引用编号：(\d+)/)?.[1]
      combined = !!webId && prompt.includes('本次测试笔记主题') && prompt.includes('外部网页（')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: combined ? `笔记将 RAG 作为学习主题 [1]，网页提供相关定义 [${webId}]。` : '未取得网页依据。' } }] }))
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const previous = process.env.MDEDIT_RAG_URL
  process.env.MDEDIT_RAG_URL = 'http://127.0.0.1:' + server.address().port + '/rag'
  try {
    const filename = resolve(__dirname, '../hybrid-smoke-runtime.cjs')
    const runtime = new Module(filename, module); runtime.filename = filename; runtime.paths = module.paths
    const code = buildSync({ entryPoints: [resolve(__dirname, '../src/main/ai/query.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
    runtime._compile(code, filename)
    const result = await runtime.exports.queryAi({ provider: 'custom', model: 'isolated-test', apiKey: '',
      baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', question: 'RAG的定义是什么', mode: 'notes-web', useLocal: true, useWeb: true }, workspace, AbortSignal.timeout(40000))
    assert.ok(result.sources.some(s => s.type === 'local'))
    assert.ok(result.sources.some(s => s.type === 'web'), '本机搜索无可用结果：' + JSON.stringify(result.webSearch))
    assert.ok(combined, '最终模型请求没有同时收到本地与网页资料')
    console.log(JSON.stringify({ result: 'PASS: real public web + synthetic notes reach the same answer prompt', webSearch: result.webSearch,
      sources: result.sources.map(s => ({ id: s.id, type: s.type, title: s.title, kind: s.webKind, url: s.url })) }, null, 2))
  } finally {
    if (previous === undefined) delete process.env.MDEDIT_RAG_URL; else process.env.MDEDIT_RAG_URL = previous
    server.closeAllConnections(); await new Promise(r => server.close(r))
    rmSync(workspace, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
