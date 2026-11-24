// 从安装包 resources/rag-service 或本机构建目录执行，无系统 Python PATH。
const { spawn } = require('node:child_process')
const { createServer } = require('node:net')
const { mkdtempSync, writeFileSync, rmSync, existsSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
async function main() {
  const binary = resolve(process.argv[2] || join(__dirname, '../build/rag-service/mdedit-rag', process.platform === 'win32' ? 'mdedit-rag.exe' : 'mdedit-rag'))
  const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r))
  const port = socket.address().port; await new Promise(r => socket.close(r))
  const directory = mkdtempSync(join(tmpdir(), 'mdedit-bundle-'))
  const token = 'isolated-smoke-token'
  // CI 的英文 Windows runner 默认控制台编码不是 UTF-8;冻结程序里的中文日志
  // 会在写 stdout/stderr 时抛 UnicodeEncodeError,表现为进程启动后立刻退出。
  // 显式开启 UTF-8 模式,让产物行为与开发者本机一致。
  const child = spawn(binary, ['--port', String(port)], { windowsHide: true,
    env: { ...process.env, PATH: '', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
      MDEDIT_EMBEDDER: 'hash', MDEDIT_RAG_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  const capture = chunk => { logs = (logs + chunk.toString('utf8')).slice(-6000) }
  // 两个流都要收:Python 启动期异常可能走 stdout,只收 stderr 会拿到空日志。
  child.stdout?.on('data', capture)
  child.stderr?.on('data', capture)
  child.on('error', error => { logs += '\n[spawn error] ' + error.message })
  const base = 'http://127.0.0.1:' + port
  try {
    let ready = false
    for (let i = 0; i < 60; i++) {
      try { const response = await fetch(base + '/health', { headers: { 'x-mdedit-token': token }, signal: AbortSignal.timeout(400) }); if (response.ok) { ready = true; break } } catch {}
      if (child.exitCode !== null) break
      await new Promise(r => setTimeout(r, 250))
    }
    // 失败时把可直接定位的信息一次性打进 CI 日志,避免只能看到空的一条断言。
    assert.ok(ready, [
      'bundled service failed:',
      ' binary=' + binary,
      ' exists=' + existsSync(binary),
      ' size=' + (existsSync(binary) ? statSync(binary).size : 0),
      ' pid=' + child.pid,
      ' exitCode=' + child.exitCode,
      ' signal=' + child.signalCode,
      ' platform=' + process.platform + '/' + process.arch,
      '\n--- service output ---\n' + logs
    ].join(''))
    assert.equal((await fetch(base + '/health')).status, 401)
    writeFileSync(join(directory, 'note.md'), '# 青岚项目\n青岚项目负责人是林知远。\n')
    const post = async (path, body) => {
      const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mdedit-token': token }, body: JSON.stringify(body) })
      const text = await response.clone().text()
      if (response.status !== 200) {
        // 500 的响应体只有 "Internal Server Error",必须把服务端输出与状态
        // 一起带上,否则 CI annotation 里看不到 Python traceback,无法定位。
        let health = '(unavailable)'
        try {
          health = await (await fetch(base + '/health', { headers: { 'x-mdedit-token': token } })).text()
        } catch { /* 服务可能已退出 */ }
        throw new Error([
          `POST ${path} -> ${response.status}`, text,
          '--- health ---', health,
          '--- service output ---', logs
        ].join('\n'))
      }
      return response.json()
    }
    await post('/index', { workspace: directory })
    const result = await post('/search', { query: '青岚项目负责人', top_k: 3 })
    assert.ok(JSON.stringify(result).includes('林知远'), 'retrieval did not find note')
    console.log('PASS: frozen RAG starts with empty PATH, rejects unauthenticated access and retrieves local Markdown')
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await Promise.race([
        new Promise(r => child.once('exit', r)),
        new Promise(r => { const timer = setTimeout(r, 3000); timer.unref() })
      ])
      // 冻结程序若派生了子进程并持有管道,残留会让 CI job 收不了尾。
      if (child.exitCode === null && child.pid && process.platform === 'win32') {
        require('node:child_process').spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
      }
    }
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => {
  const message = String((error && error.message) || error)
  // 无仓库管理员权限时读不到 Actions 的 job 日志,但 check-run annotation 公开可读。
  // 用 workflow command 把完整诊断挂到失败步骤上,便于直接定位。
  if (process.env.GITHUB_ACTIONS) {
    const escaped = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
    process.stderr.write('::error title=Bundled RAG smoke::' + escaped + '\n')
  }
  console.error(message)
  process.exitCode = 1
})
