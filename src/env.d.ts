/// <reference types="vite/client" />
import type { DevConsoleApi } from '@shared/types'

declare global {
  interface Window {
    api: DevConsoleApi
  }
}

export {}
