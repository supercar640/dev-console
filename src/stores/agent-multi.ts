// 멀티 프로젝트 Agent 상태 라우팅(순수). 프로젝트별 AgentState를 보유하고,
// 들어오는 이벤트(sessionId)를 sessionId→projectId 인덱스로 소속 프로젝트에 라우팅한다.
// 단일 프로젝트 전이는 검증된 agent-reducer를 그대로 재사용.
import type { AgentEvent, AgentSessionInfo, PermissionRequest, RestoredSession } from '@shared/types'
import {
  type AgentState, initialAgentState, startSession,
  appendEvent, appendUser, setStatus, addPending, removePending
} from './agent-reducer'
import { restoreAgentState } from './agent-restore'

export interface MultiAgentState {
  byProject: Record<string, AgentState>
  sessionIndex: Record<string, string> // sessionId → projectId
}

export function initialMultiAgentState(): MultiAgentState {
  return { byProject: {}, sessionIndex: {} }
}

/** 프로젝트의 현재 상태(없으면 초기값). 뷰가 활성 프로젝트를 투영할 때 사용. */
export function agentStateOf(s: MultiAgentState, projectId: string): AgentState {
  return s.byProject[projectId] ?? initialAgentState()
}

/** projectId 상태를 새 값으로 치환한 불변 사본. */
function withProject(s: MultiAgentState, projectId: string, next: AgentState): MultiAgentState {
  return { ...s, byProject: { ...s.byProject, [projectId]: next } }
}

/** 세션 시작: 프로젝트 상태를 running으로 리셋 + 인덱스 등록(이전 세션 인덱스는 제거). */
export function startForProject(s: MultiAgentState, projectId: string, sessionId: string): MultiAgentState {
  const prev = s.byProject[projectId]
  const sessionIndex = { ...s.sessionIndex }
  if (prev?.sessionId) delete sessionIndex[prev.sessionId]
  sessionIndex[sessionId] = projectId
  return {
    byProject: { ...s.byProject, [projectId]: startSession(initialAgentState(), sessionId) },
    sessionIndex
  }
}

/** 활성 프로젝트의 사용자 입력 1줄 로그. */
export function appendUserForProject(s: MultiAgentState, projectId: string, text: string): MultiAgentState {
  return withProject(s, projectId, appendUser(agentStateOf(s, projectId), text))
}

/** 권한 응답 후 카드 제거(낙관적). */
export function removePendingForProject(s: MultiAgentState, projectId: string, requestId: string): MultiAgentState {
  return withProject(s, projectId, removePending(agentStateOf(s, projectId), requestId))
}

/** 이벤트 라우팅: sessionId→projectId. 미지의 sessionId면 무시(no-op). */
export function routeEvent(s: MultiAgentState, sessionId: string, event: AgentEvent): MultiAgentState {
  const pid = s.sessionIndex[sessionId]
  if (pid === undefined) return s
  return withProject(s, pid, appendEvent(agentStateOf(s, pid), event))
}

export function routeStatus(s: MultiAgentState, info: AgentSessionInfo): MultiAgentState {
  const pid = s.sessionIndex[info.sessionId]
  if (pid === undefined) return s
  return withProject(s, pid, setStatus(agentStateOf(s, pid), info))
}

export function routePermission(s: MultiAgentState, req: PermissionRequest): MultiAgentState {
  const pid = s.sessionIndex[req.sessionId]
  if (pid === undefined) return s
  return withProject(s, pid, addPending(agentStateOf(s, pid), req))
}

/** sessionId의 소속 projectId(없으면 null). focusSession 점프에 사용. */
export function projectOfSession(s: MultiAgentState, sessionId: string): string | null {
  return s.sessionIndex[sessionId] ?? null
}

/** 복원 세션 주입: 프로젝트 상태를 읽기 전용 복원본으로 채우고 sessionId 인덱스 등록. */
export function hydrateProject(s: MultiAgentState, restored: RestoredSession): MultiAgentState {
  return {
    byProject: { ...s.byProject, [restored.projectId]: restoreAgentState(restored) },
    sessionIndex: { ...s.sessionIndex, [restored.sessionId]: restored.projectId }
  }
}

/** 읽기 전용 복원본을 비우고 새 작업 준비(라이브·빈 상태). 이전 세션 인덱스 제거. */
export function resetForProject(s: MultiAgentState, projectId: string): MultiAgentState {
  const prev = s.byProject[projectId]
  const sessionIndex = { ...s.sessionIndex }
  if (prev?.sessionId) delete sessionIndex[prev.sessionId]
  return {
    byProject: { ...s.byProject, [projectId]: initialAgentState() },
    sessionIndex
  }
}
