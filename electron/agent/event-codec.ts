// Main측 순수 직렬화/복원 규칙. better-sqlite3 미import → node vitest 로 검증 가능.
import type { AgentEvent, SessionStatus } from '@shared/types'

/** AgentEvent → events.payload_json 문자열. */
export function encodeEvent(event: AgentEvent): string {
  return JSON.stringify(event)
}

const EVENT_TYPES = new Set<AgentEvent['type']>([
  'message', 'tool_use', 'tool_result', 'permission_request',
  'user_input_required', 'usage', 'error', 'session_end'
])

/** payload_json → AgentEvent. 깨졌거나(파싱 실패) 미지 타입이면 null(복원 시 건너뜀). */
export function decodeEvent(payloadJson: string | null): AgentEvent | null {
  if (payloadJson === null) return null
  let parsed: unknown
  try { parsed = JSON.parse(payloadJson) } catch { return null }
  if (typeof parsed !== 'object' || parsed === null) return null
  const type = (parsed as { type?: unknown }).type
  if (typeof type !== 'string' || !EVENT_TYPES.has(type as AgentEvent['type'])) return null
  return parsed as AgentEvent
}

const LIVE_STATUSES = new Set<SessionStatus>(['running', 'waiting_user', 'idle'])

/** 복원 시 세션 상태 결정: 미종료(ended_at 없음)인데 살아있던 상태면 비정상 종료(crashed)로 강등. */
export function resolveRestoredStatus(storedStatus: SessionStatus, endedAt: string | null): SessionStatus {
  if (endedAt === null && LIVE_STATUSES.has(storedStatus)) return 'crashed'
  return storedStatus
}
