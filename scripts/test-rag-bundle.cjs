// 从安装包 resources/rag-service 或本机构建目录执行，无系统 Python PATH。
const { spawn } = require('node:child_process')
const { createServer } = require('node:net')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
async function main() {
  const binary = resolve(process.argv[2] || join(__dirname, '../build/rag-service/mdedit-rag', process.platform === 'win32' ? 'mdedit-rag.exe' : 'mdedit-rag'))
  const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r))
  const port = socket.address().port; await new Promise(r => socket.close(r))
  const directory = mkdtempSync(join(tmpdir(), 'mdedit-bundle-'))
  const token = 'isolated-smoke-token'
  const child = spawn(binary, ['--port', String(port)], { windowsHide: true,
    env: { ...process.env, PATH: '', MDEDIT_EMBEDDER: 'hash', MDEDIT_RAG_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''; child.stderr.on('data', b => { logs = (logs + b).slice(-3000) })
  child.on('error', error => { logs += error.message })
  const base = 'http://127.0.0.1:' + port
  try {
    let ready = false
    for (let i = 0; i < 60; i++) {
      try { const response = await fetch(base + '/health', { headers: { 'x-mdedit-token': token }, signal: AbortSignal.timeout(400) }); if (response.ok) { ready = true; break } } catch {}
      if (child.exitCode !== null) break
      await new Promise(r => setTimeout(r, 250))
    }
    assert.ok(ready, 'bundled service failed: ' + logs)
    assert.equal((await fetch(base + '/health')).status, 401)
    writeFileSync(join(directory, 'note.md'), '# 青岚项目\n青岚项目负责人是林知远。\n')
    const post = async (path, body) => {
      const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mdedit-token': token }, body: JSON.stringify(body) })
      assert.equal(response.status, 200, await response.clone().text()); return response.json()
    }
    await post('/index', { workspace: directory })
    const result = await post('/search', { query: '青岚项目负责人', limit: 3 })
    assert.ok(JSON.stringify(result).includes('林知远'), 'retrieval did not find note')
    console.log('PASS: frozen RAG starts with empty PATH, rejects unauthenticated access and retrieves local Markdown')
  } finally {
    child.kill(); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r))
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
