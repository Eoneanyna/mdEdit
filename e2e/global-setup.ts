import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

// package.json 为 commonjs,Playwright 将 TS 转译为 CJS,用 __dirname 定位项目根
const root = resolve(__dirname, '..')

/**
 * 测试前产出最新构建;e2e 跑的是真实打包产物而非源码。
 * 直接用 node 调 electron-vite 入口,避免 Windows 上 spawn npm(.cmd) 的差异。
 */
export default function globalSetup(): void {
  execFileSync(process.execPath, [resolve(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'], {
    cwd: root,
    stdio: 'inherit'
  })
}
