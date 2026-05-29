import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CreateProjectInput,
  DevConsoleApi,
  StartSessionInput,
  SessionInfo,
  TerminalDataPayload
} from '@shared/types'

// Renderer is a view only — it talks to Main exclusively through this bridge.
// No Node APIs are exposed; only the typed channels in DevConsoleApi.
const api: DevConsoleApi = {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input: CreateProjectInput) => ipcRenderer.invoke('projects:create', input),
    delete: (id: string) => ipcRenderer.invoke('projects:delete', id)
  },
  sessions: {
    start: (input: StartSessionInput) => ipcRenderer.invoke('sessions:start', input),
    stop: (sessionId: string) => ipcRenderer.invoke('sessions:stop', { sessionId }),
    send: (sessionId: string, data: string) => ipcRenderer.invoke('sessions:send', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('sessions:resize', { sessionId, cols, rows }),
    attachTerminal: (sessionId: string) => ipcRenderer.invoke('sessions:attachTerminal', { sessionId }),
    detachTerminal: (sessionId: string) => ipcRenderer.invoke('sessions:detachTerminal', { sessionId }),
    onTerminalData: (cb) => {
      const listener = (_e: IpcRendererEvent, payload: TerminalDataPayload): void =>
        cb(payload.sessionId, payload.data)
      ipcRenderer.on('session:terminalData', listener)
      return () => ipcRenderer.removeListener('session:terminalData', listener)
    },
    onStatusChange: (cb) => {
      const listener = (_e: IpcRendererEvent, info: SessionInfo): void => cb(info)
      ipcRenderer.on('session:statusChange', listener)
      return () => ipcRenderer.removeListener('session:statusChange', listener)
    }
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory')
  }
}

contextBridge.exposeInMainWorld('api', api)
