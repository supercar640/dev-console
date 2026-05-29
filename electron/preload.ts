import { contextBridge, ipcRenderer } from 'electron'
import type { CreateProjectInput, DevConsoleApi } from '@shared/types'

// Renderer is a view only — it talks to Main exclusively through this bridge.
// No Node APIs are exposed; only the typed channels in DevConsoleApi.
const api: DevConsoleApi = {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input: CreateProjectInput) => ipcRenderer.invoke('projects:create', input),
    delete: (id: string) => ipcRenderer.invoke('projects:delete', id)
  }
}

contextBridge.exposeInMainWorld('api', api)
