const { _electron: electron } = require('@playwright/test')
const { createServer } = require('node:http')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'mdedit-packaged-'))
  const workspace = join(directory, 'notes'); require('node:fs').mkdirSync(workspace)
  writeFileSync(join(workspace, '项目.md'), '# 青岚项目\n青岚项目负责人是林知远。\n')
  const server = createServer((req, res) => {
    let body = ''; req.on('data', data => { body += data }); req.on('end', () => {
      const input = JSON.parse(body)
      assert.ok(input.messages.at(-1).content.includes('林知远'))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '青岚项目负责人是林知远 [1]' } }] }))
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  let app
  try {
    app = await electron.launch({ executablePath: resolve(process.argv[2] || 'release/win-unpacked/mdEdit.exe'),
      args: ['--user-data-dir=' + join(directory, 'profile')],
      env: { ...process.env, PATH: '', MDEDIT_RAG_URL: '' } })
    const win = await app.firstWindow()
    await win.waitForFunction(() => !!window.api)
    let state
    for (let i = 0; i < 60; i++) {
      state = await win.evaluate(() => window.api.getRagStatus())
      if (state.serviceState === 'running') break
      await new Promise(r => setTimeout(r, 250))
    }
    assert.equal(state.serviceState, 'running'); assert.equal(state.managed, true)
    await win.evaluate(workspace => window.api.setLastWorkspace(workspace), workspace)
    const result = await win.evaluate(baseUrl => window.api.aiQuery({ provider: 'custom', model: 'smoke', apiKey: '', baseUrl,
      question: '青岚项目负责人是谁？', useLocal: true, useWeb: false, mode: 'notes' }), 'http://127.0.0.1:' + server.address().port + '/v1')
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.value.retrievalMode, 'rag'); assert.ok(result.value.answer.includes('林知远'))
    assert.equal(result.value.sources[0].type, 'local')
    const profile = await win.evaluate(() => window.api.getAiProfile())
    assert.ok(profile.path.startsWith(directory)); assert.ok(profile.markdown.includes('个人 AI 偏好'))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:ai-toggle'))
    await win.locator('#ai-send').waitFor({ state: 'visible' })
    await win.screenshot({ path: resolve('release/ai-preview.png') })
    console.log('PASS: packaged Electron starts managed RAG without Python PATH and answers with local citations; screenshot release/ai-preview.png')
    await app.close(); app = undefined
  } finally {
    if (app) { try { await app.close() } catch {} }
    server.closeAllConnections(); await new Promise(r => server.close(r))
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
