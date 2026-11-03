const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { Arch } = require('builder-util')
module.exports = async context => {
  const folder = join(context.packager.projectDir, 'build/rag-service/mdedit-rag')
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))
  const arch = /^(AMD64|x86_64|x64)$/i.test(manifest.machine) ? 'x64' : /^(arm64|aarch64)$/i.test(manifest.machine) ? 'arm64' : manifest.machine
  if (manifest.platform !== context.electronPlatformName || arch !== Arch[context.arch] || manifest.protocol !== 2 ||
      !existsSync(join(folder, context.electronPlatformName === 'win32' ? 'mdedit-rag.exe' : 'mdedit-rag'))) {
    throw new Error('内置检索平台/架构不匹配。请在目标系统和架构运行 npm run build:rag，再打包。')
  }
}
