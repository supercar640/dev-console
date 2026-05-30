// Main 소유 단일 Agent 세션 매니저 (M2 PtyManager 역할 대응).
// queryFnFactory 를 주입받아 테스트 가능. 실제 배선은 main.ts 에서 sdk-query 주입.
import type {
  AgentEvent, AgentSessionInfo, AgentStartInput, PermissionDecision, PermissionRequest
} from '@shared/types'
import { ClaudeAgentSession, type QueryFn } from './claude-agent-session'

export class ClaudeAgentManager {
  private session: ClaudeAgentSession | null = null
  private currentId: string | null = null
  private seq = 0

  private eventCb: ((sessionId: string, e: AgentEvent) => void) | null = null
  private statusCb: ((i: AgentSessionInfo) => void) | null = null
  private permCb: ((r: PermissionRequest) => void) | null = null

  /** queryFnFactory: 세션마다 새 QueryFn 을 만들어 준다(실 구현은 sdk-query 모듈). */
  constructor(private readonly queryFnFactory: () => QueryFn) {}

  onEvent(cb: (sessionId: string, e: AgentEvent) => void): void { this.eventCb = cb }
  onStatus(cb: (i: AgentSessionInfo) => void): void { this.statusCb = cb }
  onPermissionRequest(cb: (r: PermissionRequest) => void): void { this.permCb = cb }

  start(input: AgentStartInput): AgentSessionInfo {
    if (this.session) this.stop(this.currentId!)
    const id = `a${++this.seq}`
    const session = new ClaudeAgentSession(id, this.queryFnFactory())
    session.onEvent((e) => this.eventCb?.(id, e))
    session.onStatus((i) => this.statusCb?.(i))
    session.onPermissionRequest((r) => this.permCb?.(r))
    this.session = session
    this.currentId = id
    session.start({ cwd: input.cwd, model: input.model, firstMessage: input.firstMessage })
    return { sessionId: id, status: 'running' }
  }

  send(sessionId: string, text: string): void {
    if (this.currentId === sessionId) this.session?.send(text)
  }

  respondPermission(sessionId: string, requestId: string, decision: PermissionDecision): void {
    if (this.currentId === sessionId) this.session?.respondPermission(requestId, decision)
  }

  async interrupt(sessionId: string): Promise<void> {
    if (this.currentId === sessionId) await this.session?.interrupt()
  }

  status(sessionId: string): AgentSessionInfo | null {
    return this.session && this.currentId === sessionId ? this.session.info() : null
  }

  stop(sessionId: string): void {
    if (!this.session || this.currentId !== sessionId) return
    this.session.stop()
    this.session = null
    this.currentId = null
  }

  disposeAll(): void {
    if (this.currentId) this.stop(this.currentId)
  }
}
