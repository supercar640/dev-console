// Main 소유 단일 Agent 세션 매니저 (M2 PtyManager 역할 대응).
// queryFnFactory 를 주입받아 테스트 가능. 실제 배선은 main.ts 에서 sdk-query 주입.
import { randomUUID } from 'node:crypto'
import type {
  AgentEvent, AgentSessionInfo, AgentStartInput, PermissionDecision, PermissionRequest
} from '@shared/types'
import { ClaudeAgentSession, type QueryFn } from './claude-agent-session'

export class ClaudeAgentManager {
  private sessions = new Map<string, ClaudeAgentSession>()

  private eventCb: ((sessionId: string, e: AgentEvent) => void) | null = null
  private statusCb: ((i: AgentSessionInfo) => void) | null = null
  private permCb: ((r: PermissionRequest) => void) | null = null

  /** queryFnFactory: 세션마다 새 QueryFn 을 만들어 준다(실 구현은 sdk-query 모듈). */
  constructor(private readonly queryFnFactory: () => QueryFn) {}

  onEvent(cb: (sessionId: string, e: AgentEvent) => void): void { this.eventCb = cb }
  onStatus(cb: (i: AgentSessionInfo) => void): void { this.statusCb = cb }
  onPermissionRequest(cb: (r: PermissionRequest) => void): void { this.permCb = cb }

  start(input: AgentStartInput): AgentSessionInfo {
    // M4a: 멀티 세션 — 교체하지 않고 Map에 추가한다.
    // M4b: 영속화를 위해 재시작 충돌 없는 UUID를 사용(인메모리 카운터 폐기).
    const id = randomUUID()
    const session = new ClaudeAgentSession(id, this.queryFnFactory())
    session.onEvent((e) => this.eventCb?.(id, e))
    session.onStatus((i) => this.statusCb?.(i))
    session.onPermissionRequest((r) => this.permCb?.(r))
    this.sessions.set(id, session)
    session.start({ cwd: input.cwd, model: input.model, firstMessage: input.firstMessage })
    return { sessionId: id, status: 'running' }
  }

  send(sessionId: string, text: string): void {
    this.sessions.get(sessionId)?.send(text)
  }

  respondPermission(sessionId: string, requestId: string, decision: PermissionDecision): void {
    this.sessions.get(sessionId)?.respondPermission(requestId, decision)
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.sessions.get(sessionId)?.interrupt()
  }

  status(sessionId: string): AgentSessionInfo | null {
    return this.sessions.get(sessionId)?.info() ?? null
  }

  stop(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (!s) return
    s.stop()
    this.sessions.delete(sessionId)
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.stop(id)
  }
}
