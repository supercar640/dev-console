// 멀티 프로젝트 터미널(PTY) 상태 라우팅(순수). 프로젝트별 sessionId/status/command.
import type { SessionInfo } from '@shared/types'

export type TerminalStatus = SessionInfo['status'] // 'running' | 'exited'

export interface TerminalState {
  sessionId: string | null
  status: TerminalStatus | null
  command: string
}

export interface MultiTerminalState {
  byProject: Record<string, TerminalState>
  sessionIndex: Record<string, string> // sessionId → projectId
}

const DEFAULT_COMMAND = 'powershell'

export function initialMultiTerminalState(): MultiTerminalState {
  return { byProject: {}, sessionIndex: {} }
}

export function terminalStateOf(s: MultiTerminalState, projectId: string): TerminalState {
  return s.byProject[projectId] ?? { sessionId: null, status: null, command: DEFAULT_COMMAND }
}

function withProject(s: MultiTerminalState, projectId: string, next: TerminalState): MultiTerminalState {
  return { ...s, byProject: { ...s.byProject, [projectId]: next } }
}

export function setCommandForProject(s: MultiTerminalState, projectId: string, command: string): MultiTerminalState {
  return withProject(s, projectId, { ...terminalStateOf(s, projectId), command })
}

/** 세션 시작 등록: running + 인덱스(이전 세션 인덱스 제거). command는 유지. */
export function startTerminalForProject(s: MultiTerminalState, projectId: string, sessionId: string): MultiTerminalState {
  const prev = s.byProject[projectId]
  const sessionIndex = { ...s.sessionIndex }
  if (prev?.sessionId) delete sessionIndex[prev.sessionId]
  sessionIndex[sessionId] = projectId
  const command = prev?.command ?? DEFAULT_COMMAND
  return {
    byProject: { ...s.byProject, [projectId]: { sessionId, status: 'running', command } },
    sessionIndex
  }
}

/** 명시적 정지(렌더러): 세션/상태 비움, command 유지, 인덱스 제거. */
export function stopTerminalForProject(s: MultiTerminalState, projectId: string): MultiTerminalState {
  const prev = terminalStateOf(s, projectId)
  const sessionIndex = { ...s.sessionIndex }
  if (prev.sessionId) delete sessionIndex[prev.sessionId]
  return {
    byProject: { ...s.byProject, [projectId]: { sessionId: null, status: null, command: prev.command } },
    sessionIndex
  }
}

/** Main 상태 변경(예: PTY 종료) 라우팅: sessionId→projectId. */
export function routeTerminalStatus(s: MultiTerminalState, info: SessionInfo): MultiTerminalState {
  const pid = s.sessionIndex[info.sessionId]
  if (pid === undefined) return s
  const cur = terminalStateOf(s, pid)
  if (cur.sessionId !== info.sessionId) return s
  return withProject(s, pid, { ...cur, status: info.status })
}

/** sessionId의 소속 projectId(없으면 null). */
export function projectOfTerminalSession(s: MultiTerminalState, sessionId: string): string | null {
  return s.sessionIndex[sessionId] ?? null
}
