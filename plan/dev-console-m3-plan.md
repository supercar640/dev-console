# M3 Agent 엔진 구현 계획 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Main 프로세스가 공식 Agent SDK로 Claude Code를 headless 다중 턴 세션으로 구동하고, 그 메시지를 정규화된 `AgentEvent`로 변환하며, 권한/질문 요청을 UI가 승인/거부할 수 있도록 IPC로 노출하는 **Agent 채널 엔진**을 만든다. (UI — 네이티브 알림·트레이 배지·듀얼채널 토글 — 은 후속 계획.)

**Architecture:** M2 `PtyManager` 패턴을 미러링한다. 의존성 주입(`queryFn`)으로 SDK를 끊어 단위 테스트 가능하게 하고, 순수 변환기(`event-parser`)·세션 런타임(`claude-agent-session`)·단일 세션 소유자(`agent-manager`)로 책임을 쪼갠다. `canUseTool` 콜백이 권한/질문 신호의 단일 출처다(stream-json 직접 파싱 아님 — 근거: `dev-console-direction.md` §2-bis, 버그 #34046).

**Tech Stack:** Electron Main(Node) · TypeScript(strict) · `@anthropic-ai/claude-agent-sdk` 0.3.158 · vitest(가짜 queryFn 주입, 코로케이트 `*.test.ts`) · 기존 IPC(`ipcMain.handle` + `webContents.send`) · contextBridge.

**범위 밖(후속 M3-UI 계획):** Electron `Notification`·트레이 배지·듀얼채널(Agent/Terminal) 토글·렌더러 화면. 본 계획은 **IPC 경계까지** + 수동 스모크로 끝낸다. 또한 이벤트 SQLite 적재는 **M4**라 여기서 제외(엔진은 인메모리).

---

## 파일 구조 (책임 경계)

생성:
- `electron/agent/event-parser.ts` — 순수 함수. SDK 메시지 1개 → `AgentEvent[]`. 상태 없음 → TDD 최적.
- `electron/agent/event-parser.test.ts`
- `electron/agent/claude-agent-session.ts` — 주입된 `queryFn` 위의 단일 실행 세션. 스트리밍 입력 큐(다중 턴 `send`), `canUseTool`→권한/질문 이벤트 + 보류 resolver, 상태머신(running/waiting_user/idle/crashed/done), `onEvent`/`onStatus`.
- `electron/agent/claude-agent-session.test.ts`
- `electron/agent/agent-manager.ts` — Main 소유 단일 세션 매니저(`PtyManager` 역할 대응). 세션 콜백을 밖으로 라우팅.
- `electron/agent/agent-manager.test.ts`
- `electron/agent/sdk-query.ts` — 실제 SDK `query()` 배선(`node-pty.ts`에 대응하는 "진짜 구현"). 단위 테스트 대상 아님(PoC로 이미 검증).
- `electron/ipc/agents.ts` — `registerAgentHandlers(agentManager)`.

수정:
- `shared/types.ts` — Agent IPC 계약 타입 추가 + `DevConsoleApi`에 `agents` 네임스페이스.
- `electron/ipc/index.ts` — agents 핸들러 등록.
- `electron/main.ts` — `ClaudeAgentManager`를 실제 `sdk-query`로 생성해 주입.
- `electron/preload.ts` — `agents` API 노출.
- `src/ipc-client.ts` — `agentsApi` 래퍼.
- `package.json` — `@anthropic-ai/claude-agent-sdk` 의존성.
- `pnpm-workspace.yaml` — (필요 시) SDK 빌드 스크립트 allow.

---

## Task 1: 의존성 추가 + 공유 타입 계약

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `pnpm-workspace.yaml` (allowBuilds — 필요 시)
- Modify: `shared/types.ts`

- [ ] **Step 1: SDK 의존성 설치**

Run:
```
pnpm add @anthropic-ai/claude-agent-sdk@0.3.158
```
Expected: `package.json` dependencies에 추가됨. 설치 성공.

- [ ] **Step 2: SDK 번들 바이너리 resolve 검증 (pnpm 빌드 스크립트 차단 확인)**

pnpm 11은 의존성 빌드 스크립트를 기본 차단한다. SDK는 번들 바이너리를 lazy 추출하므로 보통 postinstall이 불필요하지만 확인한다.

Run (격리 PoC가 이미 동일 버전으로 동작함을 재확인):
```
node -e "import('@anthropic-ai/claude-agent-sdk').then(m=>console.log('query:', typeof m.query))"
```
Expected: `query: function`.
- 만약 런타임에 바이너리 추출 실패가 보고되면 `pnpm-workspace.yaml` `allowBuilds:`에 `@anthropic-ai/claude-agent-sdk: true` 한 줄 추가 후 `pnpm install` 재실행. (그렇지 않으면 수정 불필요.)

- [ ] **Step 3: `shared/types.ts`에 Agent IPC 계약 추가**

기존 `AgentEvent`/`SessionStatus` 정의 **아래**, `DevConsoleApi` 인터페이스 **위**에 추가:

```typescript
/** M3 Agent 채널 — 세션 시작 입력. */
export interface AgentStartInput {
  projectId: string
  cwd: string
  model?: string
  /** 시작과 동시에 보낼 첫 사용자 메시지(없으면 send로 첫 턴 시작). */
  firstMessage?: string
}

/** M3 Agent 세션 런타임 정보 (lifecycle = SessionStatus). */
export interface AgentSessionInfo {
  sessionId: string
  status: SessionStatus
}

/** waiting_user 상태에서 UI로 올라가는 승인/질문 요청. */
export interface PermissionRequest {
  requestId: string
  sessionId: string
  toolName: string
  input: unknown
  /** AskUserQuestion = 'question', 그 외 도구 = 'tool'. */
  kind: 'tool' | 'question'
}

/** UI가 돌려주는 권한 결정. */
export type PermissionDecision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message?: string }

/** Main → Renderer: 정규화 이벤트 1건. */
export interface AgentEventPayload {
  sessionId: string
  event: AgentEvent
}
```

그리고 `DevConsoleApi` 인터페이스 안에 `sessions` 블록 뒤에 `agents` 추가:

```typescript
  agents: {
    start(input: AgentStartInput): Promise<AgentSessionInfo>
    send(sessionId: string, text: string): Promise<void>
    respondPermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>
    interrupt(sessionId: string): Promise<void>
    stop(sessionId: string): Promise<void>
    /** 구독 등록. 반환 함수 호출 시 해제. */
    onEvent(cb: (payload: AgentEventPayload) => void): () => void
    onStatusChange(cb: (info: AgentSessionInfo) => void): () => void
    onPermissionRequest(cb: (req: PermissionRequest) => void): () => void
  }
```

- [ ] **Step 4: 타입체크**

Run: `pnpm run typecheck`
Expected: PASS (구현이 아직이라 DevConsoleApi 미구현 에러는 preload/ipc-client를 아직 안 건드렸으니 없음 — 인터페이스만 확장).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml shared/types.ts
git commit -m "feat(m3): add Agent SDK dependency + agent IPC contract types"
```

---

## Task 2: 이벤트 파서 (SDK 메시지 → AgentEvent)

순수·무상태 변환기. 권한/질문은 여기서 나오지 않는다(그건 세션의 canUseTool 담당). 여기선 message/tool_use/tool_result/usage/error만.

**Files:**
- Create: `electron/agent/event-parser.ts`
- Test: `electron/agent/event-parser.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`electron/agent/event-parser.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { parseSdkMessage, type SdkMessage } from './event-parser'

describe('parseSdkMessage', () => {
  it('assistant 텍스트 블록 → message 이벤트', () => {
    const msg: SdkMessage = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '안녕하세요' }] }
    }
    expect(parseSdkMessage(msg)).toEqual([{ type: 'message', role: 'assistant', text: '안녕하세요' }])
  })

  it('assistant tool_use 블록 → tool_use 이벤트, thinking/빈 텍스트는 무시', () => {
    const msg: SdkMessage = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '...' },
          { type: 'text', text: '   ' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }
        ]
      }
    }
    expect(parseSdkMessage(msg)).toEqual([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }])
  })

  it('user tool_result 블록 → tool_result 이벤트(name=tool_use_id), 문자열 content(replay)는 무시', () => {
    const toolResult: SdkMessage = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }] }
    }
    expect(parseSdkMessage(toolResult)).toEqual([{ type: 'tool_result', name: 't1', output: 'done' }])

    const replay: SdkMessage = { type: 'user', message: { role: 'user', content: 'hi' } }
    expect(parseSdkMessage(replay)).toEqual([])
  })

  it('result(success) → usage 이벤트', () => {
    const msg: SdkMessage = {
      type: 'result', subtype: 'success', is_error: false, result: 'ok',
      usage: { input_tokens: 10, output_tokens: 3 }
    }
    expect(parseSdkMessage(msg)).toEqual([{ type: 'usage', tokens: { input: 10, output: 3 } }])
  })

  it('result(error) → error + usage', () => {
    const msg: SdkMessage = {
      type: 'result', subtype: 'error_during_execution', is_error: true, result: '터졌다',
      usage: { input_tokens: 1, output_tokens: 0 }
    }
    expect(parseSdkMessage(msg)).toEqual([
      { type: 'error', message: '터졌다', recoverable: false },
      { type: 'usage', tokens: { input: 1, output: 0 } }
    ])
  })

  it('system:init / rate_limit_event / 미지의 타입 → 빈 배열', () => {
    expect(parseSdkMessage({ type: 'system', subtype: 'init' } as SdkMessage)).toEqual([])
    expect(parseSdkMessage({ type: 'rate_limit_event' } as SdkMessage)).toEqual([])
    expect(parseSdkMessage({ type: 'nope' } as unknown as SdkMessage)).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run electron/agent/event-parser.test.ts`
Expected: FAIL ("Cannot find module './event-parser'").

- [ ] **Step 3: 최소 구현**

`electron/agent/event-parser.ts`:
```typescript
// SDK 메시지 → 정규화 AgentEvent 변환 (spec 부록 B). 순수·무상태.
// 권한/질문(permission_request / user_input_required)은 여기서 나오지 않는다 —
// 그건 claude-agent-session 의 canUseTool 콜백이 합성한다(direction.md §2-bis).
import type { AgentEvent } from '@shared/types'

/** SDK 메시지의 느슨한 부분집합. 우리가 실제로 읽는 필드만 선언한다. */
export type SdkMessage =
  | { type: 'assistant'; message: { role: 'assistant'; content: SdkContentBlock[] | string } }
  | { type: 'user'; message: { role: 'user'; content: SdkContentBlock[] | string } }
  | { type: 'result'; subtype: string; is_error: boolean; result?: string; usage?: SdkUsage }
  | { type: 'system'; subtype: string }
  | { type: 'rate_limit_event' }
  | { type: string }

type SdkContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown }
  | { type: string; [k: string]: unknown }

interface SdkUsage { input_tokens: number; output_tokens: number }

export function parseSdkMessage(msg: SdkMessage): AgentEvent[] {
  switch (msg.type) {
    case 'assistant':
      return blocksOf(msg).flatMap((b): AgentEvent[] => {
        if (b.type === 'text') {
          const text = (b as { text: string }).text
          return text.trim() ? [{ type: 'message', role: 'assistant', text }] : []
        }
        if (b.type === 'tool_use') {
          const tu = b as { name: string; input: unknown }
          return [{ type: 'tool_use', name: tu.name, input: tu.input }]
        }
        return [] // thinking 등 무시
      })
    case 'user':
      return blocksOf(msg).flatMap((b): AgentEvent[] => {
        if (b.type === 'tool_result') {
          const tr = b as { tool_use_id: string; content: unknown }
          return [{ type: 'tool_result', name: tr.tool_use_id, output: tr.content }]
        }
        return []
      })
    case 'result': {
      const r = msg as { is_error: boolean; result?: string; usage?: SdkUsage }
      const out: AgentEvent[] = []
      if (r.is_error) out.push({ type: 'error', message: r.result ?? 'unknown error', recoverable: false })
      if (r.usage) out.push({ type: 'usage', tokens: { input: r.usage.input_tokens, output: r.usage.output_tokens } })
      return out
    }
    default:
      return []
  }
}

function blocksOf(msg: { message: { content: SdkContentBlock[] | string } }): SdkContentBlock[] {
  const c = msg.message.content
  return Array.isArray(c) ? c : []
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run electron/agent/event-parser.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/agent/event-parser.ts electron/agent/event-parser.test.ts
git commit -m "feat(m3): SDK message → AgentEvent parser (pure)"
```

---

## Task 3: 세션 런타임 (claude-agent-session)

주입된 `queryFn` 위에서 한 세션을 돈다. 다중 턴 입력 큐 + `canUseTool`(권한/질문) + 상태머신.

**Files:**
- Create: `electron/agent/claude-agent-session.ts`
- Test: `electron/agent/claude-agent-session.test.ts`

- [ ] **Step 1: 인터페이스/타입 + 실패 테스트 작성**

`electron/agent/claude-agent-session.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { ClaudeAgentSession, type QueryFn, type SdkQueryParams } from './claude-agent-session'
import type { AgentEvent, PermissionRequest, SessionStatus } from '@shared/types'
import type { SdkMessage } from './event-parser'

/** 스크립트된 메시지를 흘려주는 가짜 queryFn. canUseTool 호출도 시뮬레이트. */
function fakeQuery(script: (p: SdkQueryParams) => AsyncIterable<SdkMessage>): QueryFn {
  return (p) => {
    const it = script(p)[Symbol.asyncIterator]()
    return { [Symbol.asyncIterator]: () => it, interrupt: vi.fn(async () => {}) }
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('ClaudeAgentSession', () => {
  it('start는 running 상태로 전이하고 첫 메시지를 큐에 넣는다', async () => {
    const seen: SdkUserSeen[] = []
    type SdkUserSeen = { content: string }
    const session = new ClaudeAgentSession(
      'a1',
      fakeQuery(async function* (p) {
        for await (const m of p.prompt) seen.push({ content: (m.message.content as string) })
        yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }
      })
    )
    const statuses: SessionStatus[] = []
    session.onStatus((i) => statuses.push(i.status))
    session.start({ cwd: 'C:\\', firstMessage: '안녕' })
    await flush()
    expect(statuses[0]).toBe('running')
    expect(seen[0]?.content).toBe('안녕')
  })

  it('assistant/result 메시지를 파서로 변환해 onEvent로 흘리고, result 후 idle', async () => {
    const events: AgentEvent[] = []
    const statuses: SessionStatus[] = []
    const session = new ClaudeAgentSession(
      'a1',
      fakeQuery(async function* () {
        yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '하이' }] } }
        yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 2, output_tokens: 1 } }
      })
    )
    session.onEvent((e) => events.push(e))
    session.onStatus((i) => statuses.push(i.status))
    session.start({ cwd: 'C:\\', firstMessage: 'go' })
    await flush(); await flush()
    expect(events).toContainEqual({ type: 'message', role: 'assistant', text: '하이' })
    expect(events).toContainEqual({ type: 'usage', tokens: { input: 2, output: 1 } })
    expect(statuses.at(-1)).toBe('idle')
  })

  it('canUseTool(Bash) 발화 시 permission_request + waiting_user, respondPermission(allow)로 진행', async () => {
    const reqs: PermissionRequest[] = []
    const events: AgentEvent[] = []
    let decision: { behavior: string } | null = null
    const session = new ClaudeAgentSession(
      'a1',
      fakeQuery(async function* (p) {
        decision = await p.canUseTool('Bash', { command: 'rm -rf x' })
        yield { type: 'result', subtype: 'success', is_error: false, result: 'done', usage: { input_tokens: 1, output_tokens: 1 } }
      })
    )
    session.onPermissionRequest((r) => reqs.push(r))
    session.onEvent((e) => events.push(e))
    session.start({ cwd: 'C:\\', firstMessage: 'go' })
    await flush()
    expect(reqs).toHaveLength(1)
    expect(reqs[0].toolName).toBe('Bash')
    expect(reqs[0].kind).toBe('tool')
    expect(events).toContainEqual({ type: 'permission_request', description: expect.stringContaining('Bash') })
    expect(session.info().status).toBe('waiting_user')

    session.respondPermission(reqs[0].requestId, { behavior: 'allow' })
    await flush()
    expect(decision).toEqual({ behavior: 'allow', updatedInput: { command: 'rm -rf x' } })
  })

  it('canUseTool(AskUserQuestion) → user_input_required + kind=question', async () => {
    const reqs: PermissionRequest[] = []
    const events: AgentEvent[] = []
    const session = new ClaudeAgentSession(
      'a1',
      fakeQuery(async function* (p) {
        await p.canUseTool('AskUserQuestion', { questions: [{ question: '어느 DB?' }] })
        yield { type: 'result', subtype: 'success', is_error: false, result: 'x', usage: { input_tokens: 1, output_tokens: 1 } }
      })
    )
    session.onPermissionRequest((r) => reqs.push(r))
    session.onEvent((e) => events.push(e))
    session.start({ cwd: 'C:\\', firstMessage: 'go' })
    await flush()
    expect(reqs[0].kind).toBe('question')
    expect(events.some((e) => e.type === 'user_input_required')).toBe(true)
  })

  it('respondPermission(deny)는 deny 메시지를 SDK로 돌려준다', async () => {
    let decision: { behavior: string; message?: string } | null = null
    const reqs: PermissionRequest[] = []
    const session = new ClaudeAgentSession(
      'a1',
      fakeQuery(async function* (p) {
        decision = await p.canUseTool('Write', { file_path: 'x' })
        yield { type: 'result', subtype: 'success', is_error: false, result: 'x', usage: { input_tokens: 1, output_tokens: 1 } }
      })
    )
    session.onPermissionRequest((r) => reqs.push(r))
    session.start({ cwd: 'C:\\', firstMessage: 'go' })
    await flush()
    session.respondPermission(reqs[0].requestId, { behavior: 'deny', message: '거부' })
    await flush()
    expect(decision).toEqual({ behavior: 'deny', message: '거부' })
  })

  it('이터레이션 정상 종료 시 done, 예외 시 crashed + error 이벤트', async () => {
    const okStatuses: SessionStatus[] = []
    const ok = new ClaudeAgentSession('a1', fakeQuery(async function* () { /* 즉시 종료 */ }))
    ok.onStatus((i) => okStatuses.push(i.status))
    ok.start({ cwd: 'C:\\' })
    await flush()
    expect(okStatuses.at(-1)).toBe('done')

    const crashStatuses: SessionStatus[] = []
    const crashEvents: AgentEvent[] = []
    const bad = new ClaudeAgentSession('a1', fakeQuery(async function* () { throw new Error('boom') }))
    bad.onStatus((i) => crashStatuses.push(i.status))
    bad.onEvent((e) => crashEvents.push(e))
    bad.start({ cwd: 'C:\\' })
    await flush()
    expect(crashStatuses.at(-1)).toBe('crashed')
    expect(crashEvents).toContainEqual({ type: 'error', message: 'boom', recoverable: false })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run electron/agent/claude-agent-session.test.ts`
Expected: FAIL ("Cannot find module './claude-agent-session'").

- [ ] **Step 3: 구현**

`electron/agent/claude-agent-session.ts`:
```typescript
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
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run electron/agent/claude-agent-session.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/agent/claude-agent-session.ts electron/agent/claude-agent-session.test.ts
git commit -m "feat(m3): ClaudeAgentSession — DI queryFn, multi-turn queue, canUseTool, state machine"
```

---

## Task 4: 단일 세션 매니저 (agent-manager)

`PtyManager` 역할 대응. Main이 소유하는 단일 Agent 세션 + 콜백 라우팅.

**Files:**
- Create: `electron/agent/agent-manager.ts`
- Test: `electron/agent/agent-manager.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`electron/agent/agent-manager.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { ClaudeAgentManager } from './agent-manager'
import type { QueryFn } from './claude-agent-session'
import type { AgentEvent, AgentSessionInfo } from '@shared/types'
import type { SdkMessage } from './event-parser'

const flush = () => new Promise((r) => setTimeout(r, 0))
const fakeQuery: QueryFn = () => ({
  async *[Symbol.asyncIterator](): AsyncIterator<SdkMessage> {
    yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }
  }
})

describe('ClaudeAgentManager', () => {
  it('start는 running 정보를 반환하고 이벤트/상태를 밖으로 라우팅한다', async () => {
    const mgr = new ClaudeAgentManager(() => fakeQuery)
    const events: Array<{ sessionId: string; event: AgentEvent }> = []
    const statuses: AgentSessionInfo[] = []
    mgr.onEvent((sid, e) => events.push({ sessionId: sid, event: e }))
    mgr.onStatus((i) => statuses.push(i))
    const info = mgr.start({ projectId: 'p1', cwd: 'C:\\' })
    expect(info.status).toBe('running')
    await flush(); await flush()
    expect(events.some((x) => x.event.type === 'message')).toBe(true)
    expect(statuses.at(-1)?.status).toBe('idle')
  })

  it('start 재호출 시 이전 세션을 정리(교체)한다', () => {
    const mgr = new ClaudeAgentManager(() => fakeQuery)
    const first = mgr.start({ projectId: 'p1', cwd: 'C:\\' })
    const second = mgr.start({ projectId: 'p1', cwd: 'C:\\' })
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(mgr.status(first.sessionId)).toBeNull()
  })

  it('알 수 없는 sessionId로의 send/respond는 무시(throw 안 함)', () => {
    const mgr = new ClaudeAgentManager(() => fakeQuery)
    mgr.start({ projectId: 'p1', cwd: 'C:\\' })
    expect(() => mgr.send('nope', 'x')).not.toThrow()
    expect(() => mgr.respondPermission('nope', 'rq', { behavior: 'allow' })).not.toThrow()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run electron/agent/agent-manager.test.ts`
Expected: FAIL ("Cannot find module './agent-manager'").

- [ ] **Step 3: 구현**

`electron/agent/agent-manager.ts`:
```typescript
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
```

> 주: 테스트의 `respondPermission('nope','rq',...)` 시그니처에 맞춰 매니저는 `(sessionId, requestId, decision)` 3-인자. preload/IPC도 동일하게 sessionId를 함께 전달한다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run electron/agent/agent-manager.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/agent/agent-manager.ts electron/agent/agent-manager.test.ts
git commit -m "feat(m3): ClaudeAgentManager — single-session owner, callback routing"
```

---

## Task 5: 실제 SDK 배선 (sdk-query)

`node-pty.ts`에 대응하는 "진짜 구현". 단위 테스트 대상 아님(격리 PoC `hitl/m3-poc/sdk-proof.mjs`가 동일 버전으로 검증 완료). typecheck로만 검증.

**Files:**
- Create: `electron/agent/sdk-query.ts`

- [ ] **Step 1: 구현 작성**

`electron/agent/sdk-query.ts`:
```typescript
// 실제 Agent SDK 배선. ClaudeAgentSession 에 주입할 QueryFn 을 만든다.
// PoC 근거: settingSources:[] 로 유저 defaultMode:auto 격리, permissionMode:'default' 라야
// 권한 필요한 도구에서 canUseTool 이 발화한다(direction.md §2-bis).
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { QueryFn, SdkQueryHandle } from './claude-agent-session'
import type { SdkMessage } from './event-parser'

export function createSdkQueryFn(): QueryFn {
  return (params): SdkQueryHandle => {
    const q = query({
      prompt: params.prompt as never,
      options: {
        cwd: params.cwd,
        model: params.model,
        permissionMode: 'default',
        settingSources: [],
        canUseTool: async (toolName, input) => params.canUseTool(toolName, input as Record<string, unknown>)
      }
    })
    return {
      [Symbol.asyncIterator]: () => q[Symbol.asyncIterator]() as AsyncIterator<SdkMessage>,
      interrupt: () => q.interrupt()
    }
  }
}
```

- [ ] **Step 2: 타입체크**

Run: `pnpm run typecheck:node`
Expected: PASS. (SDK 타입과 우리 느슨한 SdkMessage 사이 캐스팅은 `as never`/`as AsyncIterator<SdkMessage>`로 명시적 경계 처리.)

- [ ] **Step 3: Commit**

```bash
git add electron/agent/sdk-query.ts
git commit -m "feat(m3): real Agent SDK query wiring (settingSources:[] + canUseTool)"
```

---

## Task 6: IPC 핸들러 + Main 배선

**Files:**
- Create: `electron/ipc/agents.ts`
- Modify: `electron/ipc/index.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: `electron/ipc/agents.ts` 작성**

```typescript
import { ipcMain, BrowserWindow } from 'electron'
import type { ClaudeAgentManager } from '../agent/agent-manager'
import type {
  AgentStartInput, AgentSessionInfo, AgentEventPayload, PermissionDecision, PermissionRequest
} from '@shared/types'

export function registerAgentHandlers(agentManager: ClaudeAgentManager): void {
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
  }

  agentManager.onEvent((sessionId, event) => {
    const payload: AgentEventPayload = { sessionId, event }
    broadcast('agent:event', payload)
  })
  agentManager.onStatus((info: AgentSessionInfo) => broadcast('agent:statusChange', info))
  agentManager.onPermissionRequest((req: PermissionRequest) => broadcast('agent:permissionRequest', req))

  ipcMain.handle('agents:start', (_e, input: AgentStartInput): AgentSessionInfo =>
    agentManager.start(input)
  )
  ipcMain.handle('agents:send', (_e, { sessionId, text }: { sessionId: string; text: string }): void =>
    agentManager.send(sessionId, text)
  )
  ipcMain.handle(
    'agents:respondPermission',
    (_e, a: { sessionId: string; requestId: string; decision: PermissionDecision }): void =>
      agentManager.respondPermission(a.sessionId, a.requestId, a.decision)
  )
  ipcMain.handle('agents:interrupt', (_e, { sessionId }: { sessionId: string }): Promise<void> =>
    agentManager.interrupt(sessionId)
  )
  ipcMain.handle('agents:stop', (_e, { sessionId }: { sessionId: string }): void =>
    agentManager.stop(sessionId)
  )
}
```

- [ ] **Step 2: `electron/ipc/index.ts` 수정**

```typescript
import { registerProjectHandlers } from './projects'
import { registerSessionHandlers } from './sessions'
import { registerDialogHandlers } from './dialog'
import { registerAgentHandlers } from './agents'
import type { PtyManager } from '../pty/pty-manager'
import type { ClaudeAgentManager } from '../agent/agent-manager'

export function registerIpcHandlers(ptyManager: PtyManager, agentManager: ClaudeAgentManager): void {
  registerProjectHandlers()
  registerSessionHandlers(ptyManager)
  registerDialogHandlers()
  registerAgentHandlers(agentManager)
}
```

- [ ] **Step 3: `electron/main.ts` 수정 (import + 인스턴스 + 등록 + dispose)**

상단 import 추가:
```typescript
import { ClaudeAgentManager } from './agent/agent-manager'
import { createSdkQueryFn } from './agent/sdk-query'
```
`ptyManager` 생성 아래에 추가:
```typescript
// Agent 채널(M3) — Main 소유. 세션마다 실제 SDK queryFn 을 새로 만든다.
const agentManager = new ClaudeAgentManager(() => createSdkQueryFn())
```
`registerIpcHandlers(ptyManager)` → `registerIpcHandlers(ptyManager, agentManager)`.
`will-quit` 핸들러의 `ptyManager.disposeAll()` 아래에 `agentManager.disposeAll()` 추가.

- [ ] **Step 4: 타입체크 + 전체 테스트**

Run: `pnpm run typecheck && pnpm test`
Expected: PASS (기존 19 + 신규 파서/세션/매니저 테스트).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/agents.ts electron/ipc/index.ts electron/main.ts
git commit -m "feat(m3): wire Agent IPC handlers + AgentManager into Main"
```

---

## Task 7: 렌더러 브릿지 (preload + ipc-client)

UI 구현은 후속이지만, 경계를 닫아 `DevConsoleApi`를 충족시키고 수동 스모크를 가능케 한다.

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/ipc-client.ts`

- [ ] **Step 1: `electron/preload.ts` 수정**

import에 `AgentStartInput, AgentSessionInfo, AgentEventPayload, PermissionDecision, PermissionRequest` 추가. `api` 객체의 `sessions` 뒤에 `agents` 추가:
```typescript
  agents: {
    start: (input: AgentStartInput) => ipcRenderer.invoke('agents:start', input),
    send: (sessionId: string, text: string) => ipcRenderer.invoke('agents:send', { sessionId, text }),
    respondPermission: (sessionId: string, requestId: string, decision: PermissionDecision) =>
      ipcRenderer.invoke('agents:respondPermission', { sessionId, requestId, decision }),
    interrupt: (sessionId: string) => ipcRenderer.invoke('agents:interrupt', { sessionId }),
    stop: (sessionId: string) => ipcRenderer.invoke('agents:stop', { sessionId }),
    onEvent: (cb: (payload: AgentEventPayload) => void) => {
      const listener = (_e: IpcRendererEvent, payload: AgentEventPayload): void => cb(payload)
      ipcRenderer.on('agent:event', listener)
      return () => ipcRenderer.removeListener('agent:event', listener)
    },
    onStatusChange: (cb: (info: AgentSessionInfo) => void) => {
      const listener = (_e: IpcRendererEvent, info: AgentSessionInfo): void => cb(info)
      ipcRenderer.on('agent:statusChange', listener)
      return () => ipcRenderer.removeListener('agent:statusChange', listener)
    },
    onPermissionRequest: (cb: (req: PermissionRequest) => void) => {
      const listener = (_e: IpcRendererEvent, req: PermissionRequest): void => cb(req)
      ipcRenderer.on('agent:permissionRequest', listener)
      return () => ipcRenderer.removeListener('agent:permissionRequest', listener)
    }
  }
```
> 주: `respondPermission`은 Task 1에서 이미 3-인자(`sessionId, requestId, decision`)로 정의됨. preload는 sessionId를 명시 인자로 받아 그대로 IPC payload에 싣는다(전역 추적 불필요). 위 `agents` 블록의 해당 줄을 다음으로 쓴다:
```typescript
    respondPermission: (sessionId: string, requestId: string, decision: PermissionDecision) =>
      ipcRenderer.invoke('agents:respondPermission', { sessionId, requestId, decision }),
```

- [ ] **Step 2: `src/ipc-client.ts` 수정**

```typescript
import type {
  CreateProjectInput, Project, StartSessionInput, SessionInfo,
  AgentStartInput, AgentSessionInfo, AgentEventPayload, PermissionDecision, PermissionRequest
} from '@shared/types'

export const agentsApi = {
  start: (input: AgentStartInput): Promise<AgentSessionInfo> => window.api.agents.start(input),
  send: (sessionId: string, text: string): Promise<void> => window.api.agents.send(sessionId, text),
  respondPermission: (sessionId: string, requestId: string, decision: PermissionDecision): Promise<void> =>
    window.api.agents.respondPermission(sessionId, requestId, decision),
  interrupt: (sessionId: string): Promise<void> => window.api.agents.interrupt(sessionId),
  stop: (sessionId: string): Promise<void> => window.api.agents.stop(sessionId),
  onEvent: (cb: (payload: AgentEventPayload) => void): (() => void) => window.api.agents.onEvent(cb),
  onStatusChange: (cb: (info: AgentSessionInfo) => void): (() => void) => window.api.agents.onStatusChange(cb),
  onPermissionRequest: (cb: (req: PermissionRequest) => void): (() => void) =>
    window.api.agents.onPermissionRequest(cb)
}
```

- [ ] **Step 3: 타입체크**

Run: `pnpm run typecheck`
Expected: PASS (web + node 모두; `DevConsoleApi` 완전 구현됨).

- [ ] **Step 4: Commit**

```bash
git add electron/preload.ts src/ipc-client.ts shared/types.ts
git commit -m "feat(m3): expose Agent channel to renderer via contextBridge"
```

---

## Task 8: 엔드투엔드 수동 스모크 + 빌드

엔진이 실제 claude에 붙는지 확인(렌더러 UI 없이 DevTools 콘솔에서 `window.api.agents`로). UI는 후속.

**Files:** (없음 — 검증만)

- [ ] **Step 1: 전체 그린 확인**

Run: `pnpm test && pnpm run typecheck && pnpm build`
Expected: 모두 PASS/green.

- [ ] **Step 2: dev 실행 후 콘솔 스모크**

Run: `pnpm dev` → 앱 창의 DevTools 콘솔에서:
```js
const { sessionId } = await window.api.agents.start({ projectId: 'smoke', cwd: 'C:\\AI_project\\testbed\\dev-console' })
window.api.agents.onEvent(p => console.log('EVENT', p))
window.api.agents.onPermissionRequest(r => console.log('PERM', r))
await window.api.agents.send(sessionId, 'Write a file poc.txt with HELLO. Just do it.')
// → PERM 로그(Write 권한 요청)가 떠야 한다. 그 뒤:
await window.api.agents.respondPermission(sessionId, /* PERM.requestId */, { behavior: 'deny', message: 'no' })
```
Expected:
- `EVENT` 로그에 `message`/`tool_use`/`usage` 등이 흐른다.
- Write 시도 시 `PERM` 로그(권한 요청)가 뜨고 status가 `waiting_user`로 바뀐다.
- deny 응답 후 claude가 "거부됨"을 인지하는 후속 `message` 이벤트가 흐른다.
- (검증 포인트: 직접 파싱으로 못 받던 권한 신호가 IPC로 UI 경계까지 도달.)

- [ ] **Step 3: 최종 커밋(있으면)**

스모크에서 발견한 수정만 커밋. 없으면 생략.

```bash
git commit --allow-empty -m "test(m3): manual e2e smoke of Agent engine (console)"
```

---

## Self-Review (작성자 체크)

**1. 스펙 커버리지:**
- 체크리스트 "headless 전환" → Task 5/6 (SDK query 기동). ✅
- "stream-json 이벤트 파서(부록 B)" → Task 2 (parseSdkMessage). ✅
- "질문 대기 감지(권한·질문·idle)" → 권한·질문 = Task 3 canUseTool(permission_request/user_input_required + waiting_user). ⚠️ **N초 idle 타이머는 본 계획에 없음** — 후속 UI 계획 또는 Task 3 확장. (엔진은 result 후 `idle` 상태를 이미 노출하므로 타이머는 매니저/UI 레벨에서 얹기 쉬움. 명시적 항목으로 후속 이월.)
- "네이티브 알림·트레이 배지" → 범위 밖(후속 UI 계획). 의도적.
- "듀얼채널 토글" → 범위 밖(후속). 의도적. (단, 엔진은 Agent 단일 세션이라 Terminal과 동시활성 금지 로직은 UI 토글에서.)

**2. 플레이스홀더 스캔:** 코드 스텝 모두 실제 코드 포함. TODO/TBD 없음. ✅

**3. 타입 일관성:**
- `respondPermission` 3-인자(`sessionId, requestId, decision`)로 types.ts·preload·ipc-client·manager·ipc 전부 통일. (Task 7 Step 1에서 Task 1 시그니처를 3-인자로 정정 지시.) ✅
- `QueryFn`/`SdkQueryParams`/`SdkMessage`가 Task 2·3·5에서 동일 이름·형태. ✅
- 매니저 생성자 `() => QueryFn`(factory) — main.ts(Task 6)·테스트(Task 4) 일치. ✅

**미해결 이월(후속 계획에 명시):** ① N초 idle 알림 타이머 ② tool_result의 `name`이 현재 `tool_use_id`(도구명 상관관계는 세션에 id→name 맵 추가로 개선 가능) ③ 멀티 세션(M4) ④ 이벤트 SQLite 적재(M4).

---

## Execution Handoff

계획 완료. 저장 위치: `plan/dev-console-m3-plan.md`.
구현 코딩은 **Codex 위임**(마스터 워크플로), Claude가 태스크별 검증·테스트 실행·커밋 리드.
