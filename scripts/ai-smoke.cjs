// 手动真实 API 测试：从标准输入读取 Key，不写入文件、环境配置或日志。
// Get-Content <安全来源> | node scripts/ai-smoke.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { spawn } = require('node:child_process')
const net = require('node:net')
const { buildSync } = require('esbuild')
const apiKey = fs.readFileSync(0, 'utf8').trim()
if (!apiKey) throw new Error('请通过标准输入传入 OpenRouter Key')
function loadQuery() {
const code = buildSync({ entryPoints: [path.resolve(__dirname, '../src/main/ai/query.ts')], bundle: true,
  platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
const runtime = new Module(path.resolve(__dirname, '../smoke-runtime.cjs'), module)
runtime.filename = path.resolve(__dirname, '../smoke-runtime.cjs')
runtime.paths = module.paths
runtime._compile(code, runtime.filename)
return runtime.exports.queryAi
}

async function run() {
  let service
  const python = process.argv[2]
  if (python) {
    const reservation = net.createServer()
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const port = reservation.address().port
    await new Promise(resolve => reservation.close(resolve))
    process.env.MDEDIT_RAG_URL = 'http://127.0.0.1:' + port
    service = spawn(path.resolve(python), ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: path.resolve(__dirname, '../rag-service'), stdio: 'ignore', windowsHide: true,
      env: { ...process.env, MDEDIT_EMBEDDER: 'hash' }
    })
    let startupError
    service.on('error', error => { startupError = error })
    let healthy = false
    for (let i = 0; i < 60; i++) {
      if (startupError || service.exitCode !== null) break
      try {
        const response = await fetch(process.env.MDEDIT_RAG_URL + '/health', { signal: AbortSignal.timeout(500) })
        if (response.ok) { healthy = true; break }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    if (!healthy) { service.kill(); throw new Error('独立 RAG 测试服务启动失败') }
  }
  const queryAi = loadQuery()
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mdedit-ai-smoke-'))
  const document = path.join(workspace, '青岚项目.md')
  const content = date => '# 青岚项目\n负责人：林知远。\n验收日期：' + date + '。\n验收需提交测试报告。'
  fs.writeFileSync(document, content('2026年12月8日'), 'utf8')
  const config = { provider: 'openrouter', model: process.env.MDEDIT_SMOKE_MODEL || 'openrouter/free',
    apiKey, useLocal: true, useWeb: false }
  const history = []
  const questions = ['青岚项目验收日期是什么？', '它的负责人是谁？', '它的验收日期现在改成哪天？']
  try {
    for (let i = 0; i < questions.length; i++) {
      if (i === 2) fs.writeFileSync(document, content('2026年12月18日'), 'utf8')
      const result = await queryAi({ ...config, question: questions[i], history }, workspace)
      const correct = i === 0 ? /12\D*8/.test(result.answer) : i === 1 ? result.answer.includes('林知远') : /12\D*18/.test(result.answer)
      const sourced = result.sources.some(s => s.path === document)
      const cited = /\[1\]/.test(result.answer)
      const citationHandled = cited || result.notices.some(n => n.includes('未标注有效引用'))
      console.log(JSON.stringify({ turn: i + 1, mode: result.retrievalMode, correct, sourced, cited,
        retrievalQuery: result.retrievalQuery, answer: result.answer, notices: result.notices }))
      if (!correct || !sourced || !citationHandled) throw new Error('多轮检索验收未通过')
      history.push({ question: questions[i], answer: result.answer, sources: result.sources })
    }
    console.log('PASS: 本地检索、指代追问、文件修改后重新检索')
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
    if (service) service.kill()
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1 })
