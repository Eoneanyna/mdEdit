// 构建机需要 Python；最终安装包用户无需 Python 或额外下载模型。
const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')
const root = join(__dirname, '..')
const local = join(root, 'rag-service', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const candidates = [process.env.MDEDIT_BUILD_PYTHON, existsSync(local) && local, 'python3', 'python'].filter(Boolean)
for (const python of candidates) {
  const probe = spawnSync(python, ['-c', 'import sys; assert sys.version_info >= (3, 10)'], { windowsHide: true, stdio: 'ignore' })
  if (probe.status !== 0) continue
  const result = spawnSync(python, [join(__dirname, 'build-rag.py')], { cwd: root, windowsHide: true, stdio: 'inherit' })
  process.exit(result.status ?? 1)
}
console.error('构建检索服务需要 Python 3.10+，可用 MDEDIT_BUILD_PYTHON 指定解释器。')
process.exit(1)
