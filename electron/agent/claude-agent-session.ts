// 주입된 queryFn 위의 단일 Agent 실행 세션. 다중 턴 입력 큐 + canUseTool + 상태머신.
// queryFn 을 주입받으므로 SDK 없이 단위 테스트 가능(가짜 queryFn). 실제 배선은 sdk-query.ts.
import type {
  AgentEvent, AgentSessionInfo, PermissionDecision, PermissionRequest, SessionStatus
} from '@shared/types'
import { parseSdkMessage, type SdkMessage } from './event-parser'

export interface SdkUserMessage { type: 'user'; message: { role: 'user'; content: string } }

export type CanUseToolResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

export type CanUseToolFn = (toolName: string, input: Record<string, unknown>) => Promise<CanUseToolResult>

export interface SdkQueryParams {
  prompt: AsyncIterable<SdkUserMessage>
  canUseTool: CanUseToolFn
  cwd: string
  model?: string
}

export interface SdkQueryHandle extends AsyncIterable<SdkMessage> {
  interrupt?(): Promise<void>
}

export type QueryFn = (params: SdkQueryParams) => SdkQueryHandle

export interface AgentSessionStartOpts { cwd: string; model?: string; firstMessage?: string }

/** 1턴 result 후 다음 입력을 밀어넣을 수 있는 비동기 입력 큐. */
function makeInputQueue(): {
  push(m: SdkUserMessage): void
  end(): void
  iterable: AsyncIterable<SdkUserMessage>
} {
  const items: SdkUserMessage[] = []
  const waiters: Array<(r: IteratorResult<SdkUserMessage>) => void> = []
  let done = false
  return {
    push(m) {
      if (waiters.length) waiters.shift()!({ value: m, done: false })
      else items.push(m)
    },
    end() {
      done = true
      while (waiters.length) waiters.shift()!({ value: undefined as never, done: true })
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          if (items.length) { yield items.shift()!; continue }
          if (done) return
          const r = await new Promise<IteratorResult<SdkUserMessage>>((res) => waiters.push(res))
          if (r.done) return
          yield r.value
        }
      }
    }
  }
}

let reqSeq = 0

export class ClaudeAgentSession {
  private status: SessionStatus = 'idle'
  private queue = makeInputQueue()
  private handle: SdkQueryHandle | null = null
  private pending = new Map<string, (r: CanUseToolResult) => void>()

  private eventCb: ((e: AgentEvent) => void) | null = null
  private statusCb: ((i: AgentSessionInfo) => void) | null = null
  private permCb: ((r: PermissionRequest) => void) | null = null

  constructor(private readonly id: string, private readonly queryFn: QueryFn) {}

  onEvent(cb: (e: AgentEvent) => void): void { this.eventCb = cb }
  onStatus(cb: (i: AgentSessionInfo) => void): void { this.statusCb = cb }
  onPermissionRequest(cb: (r: PermissionRequest) => void): void { this.permCb = cb }

  info(): AgentSessionInfo { return { sessionId: this.id, status: this.status } }

  start(opts: AgentSessionStartOpts): void {
    if (opts.firstMessage !== undefined) this.queue.push(toUserMsg(opts.firstMessage))
    this.handle = this.queryFn({
      prompt: this.queue.iterable,
      canUseTool: (name, input) => this.handlePermission(name, input),
      cwd: opts.cwd,
      model: opts.model
    })
    this.setStatus('running')
    void this.consume()
  }

  send(text: string): void {
    this.queue.push(toUserMsg(text))
    if (this.status === 'idle') this.setStatus('running')
  }

  respondPermission(requestId: string, decision: PermissionDecision): void {
    const resolve = this.pending.get(requestId)
    if (!resolve) return
    this.pending.delete(requestId)
    if (decision.behavior === 'allow') resolve({ behavior: 'allow', updatedInput: {} })
    else resolve({ behavior: 'deny', message: decision.message ?? 'Denied by user' })
    if (this.pending.size === 0 && this.status === 'waiting_user') this.setStatus('running')
  }

  async interrupt(): Promise<void> { await this.handle?.interrupt?.() }

  stop(): void {
    for (const [, resolve] of this.pending) resolve({ behavior: 'deny', message: 'Session stopped' })
    this.pending.clear()
    this.queue.end()
    void this.handle?.interrupt?.()
    this.setStatus('done')
  }

  // --- 내부 ---

  private handlePermission(toolName: string, input: Record<string, unknown>): Promise<CanUseToolResult> {
    const requestId = `p${++reqSeq}`
    const kind: PermissionRequest['kind'] = toolName === 'AskUserQuestion' ? 'question' : 'tool'
    this.setStatus('waiting_user')
    if (kind === 'question') {
      this.emit({ type: 'user_input_required', prompt: safeJson(input) })
    } else {
      this.emit({ type: 'permission_request', description: `${toolName}: ${safeJson(input).slice(0, 200)}` })
    }
    this.permCb?.({ requestId, sessionId: this.id, toolName, input, kind })
    return new Promise<CanUseToolResult>((resolve) => {
      this.pending.set(requestId, (r) =>
        resolve(r.behavior === 'allow' ? { behavior: 'allow', updatedInput: input } : r)
      )
    })
  }

  private async consume(): Promise<void> {
    if (!this.handle) return
    try {
      for await (const msg of this.handle) {
        for (const e of parseSdkMessage(msg)) this.emit(e)
        if ((msg as { type: string }).type === 'result' && this.pending.size === 0) this.setStatus('idle')
      }
      this.setStatus('done')
    } catch (err) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : String(err), recoverable: false })
      this.setStatus('crashed')
    }
  }

  private emit(e: AgentEvent): void { this.eventCb?.(e) }

  private setStatus(s: SessionStatus): void {
    this.status = s
    this.statusCb?.({ sessionId: this.id, status: s })
  }
}

function toUserMsg(text: string): SdkUserMessage {
  return { type: 'user', message: { role: 'user', content: text } }
}
function safeJson(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}
