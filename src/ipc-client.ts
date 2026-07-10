import type {
  CreateProjectInput, Project, StartSessionInput, SessionInfo,
  AgentStartInput, AgentSessionInfo, AgentEventPayload, PermissionDecision, PermissionRequest,
  RestoredSession
} from '@shared/types'

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

export const dialogApi = {
  openDirectory: (): Promise<string | null> => window.api.dialog.openDirectory()
}

export const filesApi = {
  pickForReference: (): Promise<string[]> => window.api.files.pickForReference()
}

export const agentsApi = {
  start: (input: AgentStartInput): Promise<AgentSessionInfo> => window.api.agents.start(input),
  send: (sessionId: string, text: string): Promise<void> => window.api.agents.send(sessionId, text),
  respondPermission: (sessionId: string, requestId: string, decision: PermissionDecision): Promise<void> =>
    window.api.agents.respondPermission(sessionId, requestId, decision),
  interrupt: (sessionId: string): Promise<void> => window.api.agents.interrupt(sessionId),
  stop: (sessionId: string): Promise<void> => window.api.agents.stop(sessionId),
  onEvent: (cb: (payload: AgentEventPayload) => void): (() => void) => window.api.agents.onEvent(cb),
  onStatusChange: (cb: (info: AgentSessionInfo) => void): (() => void) => window.api.agents.onStatusChange(cb),
  onPermissionRequest: (cb: (req: PermissionRequest) => void): (() => void) =>
    window.api.agents.onPermissionRequest(cb),
  onFocusSession: (cb: (sessionId: string) => void): (() => void) =>
    window.api.agents.onFocusSession(cb),
  loadHistory: (): Promise<RestoredSession[]> => window.api.agents.loadHistory()
}
