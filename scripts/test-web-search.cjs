// 只发送合成公共问题，不发送本地笔记或凭据。
const { buildSync } = require('esbuild')
const Module = require('node:module')
const { resolve } = require('node:path')
const filename = resolve(__dirname, '../web-smoke-runtime.cjs')
const code = buildSync({ entryPoints: [resolve(__dirname, '../src/main/ai/search-web.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
const runtime = new Module(filename, module); runtime.filename = filename; runtime.paths = module.paths; runtime._compile(code, filename)
runtime.exports.searchWeb(process.argv.slice(2).join(' ') || 'RAG 检索增强生成 定义', 3, AbortSignal.timeout(35000)).then(hits => {
  if (!hits.length) throw new Error('公共搜索无结果；请检查网络或搜索引擎访问限制')
  console.log(JSON.stringify(hits.map(hit => ({ title: hit.title, url: hit.url, kind: hit.webKind, characters: hit.description.length })), null, 2))
}).catch(error => { console.error(error.message); process.exitCode = 1 })
