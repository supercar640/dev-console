// 프로젝트의 두 채널(agent/terminal) 상태를 한 점으로 집약 + 점 색 클래스(순수).
// 집약 우선순위(주의 필요 순): waiting_user > running > idle > done > crashed (설계 §3).
// 색: emerald=running/waiting(대기는 깜빡임) · white=idle · gray=done/none · red=crashed.
import type { SessionStatus } from '@shared/types'
import type { TerminalStatus } from './session-multi'

const PRIORITY: SessionStatus[] = ['waiting_user', 'running', 'idle', 'done', 'crashed']

/** 터미널 상태를 SessionStatus 공간으로 정규화. */
function normalizeTerminal(t: TerminalStatus | null): SessionStatus | null {
  if (t === 'running') return 'running'
  if (t === 'exited') return 'done'
  return null
}

/** 두 채널 → 한 상태. 둘 다 없으면 null. */
export function aggregateProjectStatus(
  agentStatus: SessionStatus | null,
  terminalStatus: TerminalStatus | null
): SessionStatus | null {
  const candidates: SessionStatus[] = []
  if (agentStatus) candidates.push(agentStatus)
  const t = normalizeTerminal(terminalStatus)
  if (t) candidates.push(t)
  for (const s of PRIORITY) if (candidates.includes(s)) return s
  return null
}

/** 상태 → 점 색 클래스 suffix. */
export function statusDotClass(status: SessionStatus | null): string {
  switch (status) {
    case 'waiting_user': return 'waiting'
    case 'running': return 'running'
    case 'idle': return 'idle'
    case 'done': return 'done'
    case 'crashed': return 'crashed'
    default: return 'none'
  }
}
