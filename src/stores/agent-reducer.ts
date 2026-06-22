// Agent 채널 렌더러 상태 + 순수 전이 함수. side-effect 없음 → node vitest 로 검증.
import type { AgentEvent, AgentSessionInfo, PermissionRequest, SessionStatus } from '@shared/types'

export type LogItem =
  | { id: number; kind: 'event'; event: AgentEvent }
  | { id: number; kind: 'user'; text: string }

export interface AgentState {
  sessionId: string | null
  status: SessionStatus | null
  log: LogItem[]
  pending: PermissionRequest[]
  nextId: number
  /** 라이브 세션=true, 복원(읽기 전용) 세션=false. */
  live: boolean
}

export function initialAgentState(): AgentState {
  return { sessionId: null, status: null, log: [], pending: [], nextId: 0, live: true }
}

export function startSession(_s: AgentState, sessionId: string): AgentState {
  return { sessionId, status: 'running', log: [], pending: [], nextId: 0, live: true }
}

export function appendEvent(s: AgentState, event: AgentEvent): AgentState {
  return { ...s, log: [...s.log, { id: s.nextId, kind: 'event', event }], nextId: s.nextId + 1 }
}

export function appendUser(s: AgentState, text: string): AgentState {
  return { ...s, log: [...s.log, { id: s.nextId, kind: 'user', text }], nextId: s.nextId + 1 }
}

export function setStatus(s: AgentState, info: AgentSessionInfo): AgentState {
  if (s.sessionId !== null && info.sessionId !== s.sessionId) return s
  return { ...s, status: info.status }
}

export function addPending(s: AgentState, req: PermissionRequest): AgentState {
  if (s.sessionId !== null && req.sessionId !== s.sessionId) return s
  return { ...s, pending: [...s.pending, req] }
}

export function removePending(s: AgentState, requestId: string): AgentState {
  return { ...s, pending: s.pending.filter((p) => p.requestId !== requestId) }
}
