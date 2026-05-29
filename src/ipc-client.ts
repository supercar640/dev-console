import type { CreateProjectInput, Project, StartSessionInput, SessionInfo } from '@shared/types'

// Thin typed wrapper over the contextBridge surface (window.api).
// Renderer code imports from here, never touches window.api directly.
export const projectsApi = {
  list: (): Promise<Project[]> => window.api.projects.list(),
  create: (input: CreateProjectInput): Promise<Project> => window.api.projects.create(input),
  delete: (id: string): Promise<void> => window.api.projects.delete(id)
}

export const sessionsApi = {
  start: (input: StartSessionInput): Promise<SessionInfo> => window.api.sessions.start(input),
  stop: (sessionId: string): Promise<void> => window.api.sessions.stop(sessionId),
  send: (sessionId: string, data: string): Promise<void> => window.api.sessions.send(sessionId, data),
  resize: (sessionId: string, cols: number, rows: number): Promise<void> =>
    window.api.sessions.resize(sessionId, cols, rows),
  attachTerminal: (sessionId: string): Promise<SessionInfo | null> =>
    window.api.sessions.attachTerminal(sessionId),
  detachTerminal: (sessionId: string): Promise<void> => window.api.sessions.detachTerminal(sessionId),
  onTerminalData: (cb: (sessionId: string, data: Uint8Array) => void): (() => void) =>
    window.api.sessions.onTerminalData(cb),
  onStatusChange: (cb: (info: SessionInfo) => void): (() => void) =>
    window.api.sessions.onStatusChange(cb)
}
