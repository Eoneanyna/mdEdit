// 无答案边界评测。--offline 验证零资料拒答；真实模型 Key 从 stdin 读取，不落盘。
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const Module = require('node:module')
const { buildSync } = require('esbuild')
const offline = process.argv.includes('--offline')
const apiKey = offline ? '' : fs.readFileSync(0, 'utf8').trim()
if (!offline && !apiKey) throw new Error('请从标准输入提供 OpenRouter Key，或使用 --offline')
if (offline) process.env.MDEDIT_RAG_URL = 'http://127.0.0.1:1'
const runtime = new Module(path.resolve(__dirname, '../grounding-runtime.cjs'), module)
runtime.filename = path.resolve(__dirname, '../grounding-runtime.cjs')
runtime.paths = module.paths
runtime._compile(buildSync({ entryPoints: [path.resolve(__dirname, '../src/main/ai/query.ts')], bundle: true,
  platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, runtime.filename)
const { queryAi } = runtime.exports
const root = path.resolve(__dirname, '../rag-service')
const cases = JSON.parse(fs.readFileSync(path.join(root, 'evals/grounding-cases.json'), 'utf8')).cases
async function run() {
  const rows = []
  if (offline) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mdedit-refusal-'))
    fs.writeFileSync(path.join(workspace, '项目.md'), '# 青岚项目\n负责人：林知远。')
    try {
      for (const question of ['火星大气压强是多少帕斯卡', '蓝鲸的妊娠周期有几个月', '贝多芬第五交响曲首演在哪里']) {
        const result = await queryAi({ provider: 'ollama', model: 'unused', question, useLocal: true, useWeb: false }, workspace, AbortSignal.timeout(3000))
        const pass = !result.sources.length && result.answer.includes('未在本轮资料中找到足够依据')
        rows.push({ question, pass, answer: result.answer, sources: result.sources.length })
      }
    } finally { fs.rmSync(workspace, { recursive: true, force: true }) }
  } else {
    for (const item of cases) {
      try {
        const context = { kind: item.kind || 'document', name: '合成测试文档.md', path: null, content: item.content,
          documentHash: crypto.createHash('sha256').update(item.content).digest('hex'), dirty: true, allowUnsaved: true,
          ...(item.kind === 'selection' ? { selectionFrom: 1, selectionTo: item.content.length + 1 } : {}) }
        const result = await queryAi({ provider: 'openrouter', model: process.env.MDEDIT_SMOKE_MODEL || 'openrouter/free',
          apiKey, question: item.question, useLocal: false, useWeb: false, context }, null)
        const checks = [...item.must.map(pattern => new RegExp(pattern).test(result.answer)),
          ...(item.forbid || []).map(pattern => !new RegExp(pattern).test(result.answer))]
        const pass = checks.every(Boolean)
        rows.push({ id: item.id, question: item.question, pass, answer: result.answer, notices: result.notices })
        console.log(JSON.stringify(rows.at(-1)))
      } catch (error) {
        rows.push({ id: item.id, blocked: true, error: error.message })
        // 限流/认证/网络异常时停止，避免反复消耗额度；未运行的题不能计为通过。
        break
      }
    }
  }
  const report = { mode: offline ? 'offline-zero-evidence' : 'real-model-grounding', total: offline ? 3 : cases.length,
    completed: rows.filter(r => !r.blocked).length, passed: rows.filter(r => r.pass).length,
    note: '规则检查不等价于语义正确性，真实答案仍需人工核对。', rows }
  const output = path.join(root, 'evals/results-grounding-' + Date.now() + '.json')
  fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify(report))
  console.log('Report: ' + output)
  if (report.passed !== report.total) process.exitCode = 1
}
run().catch(error => { console.error(error.message); process.exitCode = 1 })
