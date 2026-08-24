import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  resolve: {
    alias: {
      '@shared': shared,
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      // Latex 特性已禁用,拦掉 crepe 链式引入的 KaTeX 样式,与 electron.vite.config 保持一致
      'katex/dist/katex.min.css': resolve(__dirname, 'src/renderer/src/styles/empty.css')
    }
  },
  test: {
    // 编辑器测试需要真实 DOM(jsdom 下跑 Crepe/ProseMirror)
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        // rAF 由 pretendToBeVisual 提供,其余缺失 API 见 tests/setup.ts
        pretendToBeVisual: true
      }
    },
    include: ['src/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 20_000
  }
})
