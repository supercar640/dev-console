// Main 알림 책임 — Agent 매니저의 status/permission 을 받아 네이티브 알림 + 배지.
// Electron API 를 직접 부르지 않고 주입받은 deps 로 → fake 주입 단위 테스트.
import type { AgentSessionInfo, PermissionRequest } from '@shared/types'

export interface NotifyOpts { title: string; body: string; sessionId: string }
export interface NotifierDeps {
  notify(opts: NotifyOpts): void
  setBadgeCount(n: number): void
  idleMs?: number
}

export class AgentNotifier {
  private readonly waiting = new Set<string>()
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly idleMs: number

  constructor(private readonly deps: NotifierDeps) {
    this.idleMs = deps.idleMs ?? 60_000
  }

  onPermissionRequest(req: PermissionRequest): void {
    this.clearIdle(req.sessionId)
    this.waiting.add(req.sessionId)
    this.deps.setBadgeCount(this.waiting.size)
    const body = req.kind === 'question' ? '질문에 답해주세요.' : `${req.toolName} 실행 승인이 필요합니다.`
    this.deps.notify({ title: '에이전트 — 사람 대기', body, sessionId: req.sessionId })
  }

  onStatus(info: AgentSessionInfo): void {
    const sid = info.sessionId
    if (info.status === 'waiting_user') {
      this.clearIdle(sid)
      this.waiting.add(sid)
      this.deps.setBadgeCount(this.waiting.size)
      return
    }
    this.unwait(sid)
    this.clearIdle(sid)
    if (info.status === 'idle') {
      this.idleTimers.set(sid, setTimeout(() => {
        this.deps.notify({ title: '에이전트 — 지시 대기', body: '에이전트가 다음 지시를 기다립니다.', sessionId: sid })
      }, this.idleMs))
    }
  }

  dispose(): void {
    for (const t of this.idleTimers.values()) clearTimeout(t)
    this.idleTimers.clear()
    this.waiting.clear()
    this.deps.setBadgeCount(0)
  }

  private unwait(sid: string): void {
    if (this.waiting.delete(sid)) this.deps.setBadgeCount(this.waiting.size)
  }
  private clearIdle(sid: string): void {
    const t = this.idleTimers.get(sid)
    if (t) { clearTimeout(t); this.idleTimers.delete(sid) }
  }
}
