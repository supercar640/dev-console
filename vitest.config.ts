import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// 순수 로직(electron/pty/* 등) 단위 테스트. node 환경, Electron/node-pty 네이티브
// 불필요(테스트는 가짜 spawn 주입). @shared 별칭은 tsconfig와 동일하게 맞춘다.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts', 'shared/**/*.test.ts']
  }
})
