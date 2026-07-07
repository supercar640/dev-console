// 복원: 저장된 events를 순서대로 재생해 읽기 전용 AgentState 재구성(순수).
// 검증된 agent-reducer 전이(startSession+appendEvent)를 재사용 → 라이브와 동일한 log 보장.
import type { RestoredSession } from '@shared/types'
import { type AgentState, initialAgentState, startSession, appendEvent } from './agent-reducer'

export function restoreAgentState(restored: RestoredSession): AgentState {
  let state = startSession(initialAgentState(), restored.sessionId)
  for (const event of restored.events) state = appendEvent(state, event)
  return { ...state, status: restored.status, live: false }
}
