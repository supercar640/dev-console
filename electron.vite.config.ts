import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Main/preload in electron/, renderer in src/, shared types in shared/ — per spec §8.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('electron/main.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('electron/preload.ts') }
      }
    }
  },
  renderer: {
    root: 'src',
    resolve: {
      alias: { '@shared': resolve('shared'), '@': resolve('src') }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/index.html') }
      }
    }
  }
})
