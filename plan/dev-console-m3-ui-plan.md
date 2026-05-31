# M3 UI Implementation Plan (Agent 뷰 · 인라인 승인 · 알림 · 듀얼채널)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M3 엔진(머지됨) 위에 Agent 채널 화면을 얹어, 대화·도구사용을 보고 권한/질문을 인라인 카드로 승인/거부하며, 사람 대기/유휴 시 윈도우 네이티브 알림 + 배지로 호출되는 UI를 완성한다.

**Architecture:** 순수 로직은 테스트 가능한 단위로 분리한다 — 렌더러 상태전이는 `agent-reducer`(순수 함수, node vitest), Main 알림은 `AgentNotifier`(의존성 주입 fake). React 컴포넌트(얇은 뷰)는 수동 스모크로 검증. 엔진 매니저의 단일 콜백 제약상 IPC 브로드캐스트와 notifier를 한 콜백에서 함께 호출한다.

**Tech Stack:** React 18 + TypeScript(strict) · Zustand · Electron Main(`Notification`, `app.setBadgeCount`) · vitest(node, fake 주입) · 기존 `agentsApi`(preload).

**설계 출처:** `plan/dev-console-m3-ui-design.md`. 결정: 인라인 승인 카드 / 채널 탭 / 듀얼채널=경고 후 허용 / waiting_user·idle 알림 / 새 agent 스토어.

**범위 밖:** 이벤트 SQLite 적재·멀티세션(M4), 모델/Effort 드롭다운(별도), **진짜 시스템 트레이 아이콘은 M6 트레이 상주로 이월** — M3 "배지"는 `app.setBadgeCount`(작업표시줄 배지, 아이콘 에셋 불필요)로 구현. *(설계의 "Tray 생성"을 이 한 가지로 축소 — 마스터 확인 필요.)*

---

## 파일 구조

### 렌더러 (`src/`)
- `stores/agent-reducer.ts` *(생성, 순수·테스트)* — 상태 + 전이 함수.
- `stores/agent.ts` *(생성)* — Zustand. reducer + `agentsApi` 구독 + 액션.
- `views/Workspace.tsx` *(생성)* — 채널 탭 + 듀얼채널 경고 가드.
- `views/AgentView.tsx` *(생성)* — 대화 로그 + 입력 + 상태/컨트롤 + 인라인 승인.
- `components/AgentEventItem.tsx` *(생성)* — 로그 1줄 렌더.
- `components/PermissionCard.tsx` *(생성)* — 인라인 승인 카드.
- `App.tsx` *(수정)* — Workspace 라우팅 + focusSession.
- `styles.css` *(수정)* — 채널 탭/대화/카드/배지 스타일.

### Main (`electron/`)
- `agent/notifier.ts` *(생성, fake 주입·테스트)* — waiting_user/permission → 알림, idle 60초 → 알림, 배지.
- `ipc/agents.ts` *(수정)* — notifier 호출 + `agent:focusSession` 브로드캐스트.
- `ipc/index.ts` *(수정)* — notifier 전달.
- `main.ts` *(수정)* — notifier 실제 배선(Notification/setBadgeCount/click→focus).
- `preload.ts` *(수정)* — `onFocusSession`.
- `shared/types.ts` *(수정)* — `agents.onFocusSession`.
- `src/ipc-client.ts` *(수정)* — `agentsApi.onFocusSession`.

### 설정
- `vitest.config.ts` *(수정)* — include에 `src/**/*.test.ts` 추가(렌더러 순수 로직 테스트).

---

## Task 1: 테스트 인프라 + focusSession 계약

**Files:**
- Modify: `vitest.config.ts`
- Modify: `shared/types.ts`
- Modify: `electron/preload.ts`
- Modify: `src/ipc-client.ts`
- Modify: `electron/ipc/agents.ts`

- [ ] **Step 1: vitest include에 src 추가**

`vitest.config.ts`의 `include` 배열을 교체:
```typescript
    include: ['electron/**/*.test.ts', 'shared/**/*.test.ts', 'src/**/*.test.ts']
```

- [ ] **Step 2: `shared/types.ts` — onFocusSession 추가**

`DevConsoleApi.agents` 안 `onPermissionRequest` 다음 줄에 추가:
```typescript
    onFocusSession(cb: (sessionId: string) => void): () => void
```

- [ ] **Step 3: `electron/preload.ts` — onFocusSession 노출**

`agents` 객체의 `onPermissionRequest` 블록 다음에 추가:
```typescript
    ,
    onFocusSession: (cb: (sessionId: string) => void) => {
      const listener = (_e: IpcRendererEvent, sessionId: string): void => cb(sessionId)
      ipcRenderer.on('agent:focusSession', listener)
      return () => ipcRenderer.removeListener('agent:focusSession', listener)
    }
```
(쉼표 위치 주의 — 기존 마지막 메서드 뒤에 쉼표를 두고 추가.)

- [ ] **Step 4: `src/ipc-client.ts` — onFocusSession 래퍼**

`agentsApi`의 `onPermissionRequest` 다음에 추가:
```typescript
  ,
  onFocusSession: (cb: (sessionId: string) => void): (() => void) =>
    window.api.agents.onFocusSession(cb)
```

- [ ] **Step 5: `electron/ipc/agents.ts` — focusSession 브로드캐스트 함수 노출**

`registerAgentHandlers` 시그니처는 Task 8에서 notifier를 받도록 바꾼다. 지금은 broadcast 헬퍼가 이미 있으니 `agent:focusSession`을 보낼 수 있는 상태만 확인(추가 코드 없음 — Task 8에서 사용).

- [ ] **Step 6: 타입체크**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts shared/types.ts electron/preload.ts src/ipc-client.ts
git commit -m "feat(m3-ui): onFocusSession IPC contract + enable src/ vitest"
```

---

## Task 2: 렌더러 상태전이 (agent-reducer, 순수 TDD)

**Files:**
- Create: `src/stores/agent-reducer.ts`
- Test: `src/stores/agent-reducer.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/stores/agent-reducer.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import {
  initialAgentState, startSession, appendEvent, appendUser,
  setStatus, addPending, removePending
} from './agent-reducer'
import type { PermissionRequest } from '@shared/types'

const req = (id: string, sid = 'a1'): PermissionRequest =>
  ({ requestId: id, sessionId: sid, toolName: 'Write', input: {}, kind: 'tool' })

describe('agent-reducer', () => {
  it('startSession은 running 으로 리셋한다', () => {
    let s = initialAgentState()
    s = appendUser(s, 'old')
    s = startSession(s, 'a1')
    expect(s).toMatchObject({ sessionId: 'a1', status: 'running', log: [], pending: [] })
  })

  it('appendEvent / appendUser 는 증가하는 id 로 로그에 쌓인다', () => {
    let s = startSession(initialAgentState(), 'a1')
    s = appendUser(s, '안녕')
    s = appendEvent(s, { type: 'message', role: 'assistant', text: '하이' })
    expect(s.log).toEqual([
      { id: 0, kind: 'user', text: '안녕' },
      { id: 1, kind: 'event', event: { type: 'message', role: 'assistant', text: '하이' } }
    ])
  })

  it('setStatus 는 현재 세션만 반영(다른 sessionId 무시)', () => {
    let s = startSession(initialAgentState(), 'a1')
    s = setStatus(s, { sessionId: 'a2', status: 'idle' })
    expect(s.status).toBe('running')
    s = setStatus(s, { sessionId: 'a1', status: 'waiting_user' })
    expect(s.status).toBe('waiting_user')
  })

  it('addPending / removePending', () => {
    let s = startSession(initialAgentState(), 'a1')
    s = addPending(s, req('p1'))
    s = addPending(s, req('p2'))
    expect(s.pending.map((p) => p.requestId)).toEqual(['p1', 'p2'])
    s = removePending(s, 'p1')
    expect(s.pending.map((p) => p.requestId)).toEqual(['p2'])
  })

  it('addPending 은 다른 세션의 요청을 무시', () => {
    let s = startSession(initialAgentState(), 'a1')
    s = addPending(s, req('p1', 'other'))
    expect(s.pending).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/stores/agent-reducer.test.ts`
Expected: FAIL ("Cannot find module './agent-reducer'").

- [ ] **Step 3: 구현**

`src/stores/agent-reducer.ts`:
```typescript
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
}

export function initialAgentState(): AgentState {
  return { sessionId: null, status: null, log: [], pending: [], nextId: 0 }
}

export function startSession(_s: AgentState, sessionId: string): AgentState {
  return { sessionId, status: 'running', log: [], pending: [], nextId: 0 }
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
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/stores/agent-reducer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/agent-reducer.ts src/stores/agent-reducer.test.ts
git commit -m "feat(m3-ui): pure agent state reducer"
```

---

## Task 3: Main 알림 (AgentNotifier, fake 주입 TDD)

**Files:**
- Create: `electron/agent/notifier.ts`
- Test: `electron/agent/notifier.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`electron/agent/notifier.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentNotifier, type NotifyOpts } from './notifier'
import type { PermissionRequest } from '@shared/types'

const req: PermissionRequest = { requestId: 'p1', sessionId: 'a1', toolName: 'Write', input: {}, kind: 'tool' }

describe('AgentNotifier', () => {
  let notes: NotifyOpts[]
  let badges: number[]
  let n: AgentNotifier
  beforeEach(() => {
    vi.useFakeTimers()
    notes = []; badges = []
    n = new AgentNotifier({ notify: (o) => notes.push(o), setBadgeCount: (c) => badges.push(c), idleMs: 1000 })
  })
  afterEach(() => vi.useRealTimers())

  it('권한 요청 → 알림 1회 + 배지 1', () => {
    n.onPermissionRequest(req)
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toContain('Write')
    expect(notes[0].sessionId).toBe('a1')
    expect(badges.at(-1)).toBe(1)
  })

  it('running 진입 시 배지 0으로(대기 해제)', () => {
    n.onPermissionRequest(req)
    n.onStatus({ sessionId: 'a1', status: 'running' })
    expect(badges.at(-1)).toBe(0)
  })

  it('idle 60초(여기선 1000ms) 지속 → 지시 대기 알림', () => {
    n.onStatus({ sessionId: 'a1', status: 'idle' })
    expect(notes).toHaveLength(0)
    vi.advanceTimersByTime(1000)
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toContain('지시 대기')
  })

  it('idle 후 타이머 만료 전 상태 변경 → 알림 없음', () => {
    n.onStatus({ sessionId: 'a1', status: 'idle' })
    n.onStatus({ sessionId: 'a1', status: 'running' })
    vi.advanceTimersByTime(1000)
    expect(notes).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run electron/agent/notifier.test.ts`
Expected: FAIL ("Cannot find module './notifier'").

- [ ] **Step 3: 구현**

`electron/agent/notifier.ts`:
```typescript
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
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run electron/agent/notifier.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/agent/notifier.ts electron/agent/notifier.test.ts
git commit -m "feat(m3-ui): AgentNotifier (native alert + badge + idle timer, DI)"
```

---

## Task 4: Agent Zustand 스토어

reducer + `agentsApi` 구독 + 액션. IPC side-effect라 단위 테스트 없음(reducer가 검증됨). typecheck로 검증.

**Files:**
- Create: `src/stores/agent.ts`

- [ ] **Step 1: 구현**

`src/stores/agent.ts`:
```typescript
import { create } from 'zustand'
import { agentsApi } from '@/ipc-client'
import {
  type AgentState, type LogItem,
  initialAgentState, startSession, appendEvent, appendUser, setStatus, addPending, removePending
} from './agent-reducer'

interface AgentStore extends AgentState {
  focusTick: number // focusSession 수신 시 증가 → 뷰가 반응(탭 전환/스크롤)
  start: (projectId: string, cwd: string, firstMessage?: string) => Promise<void>
  send: (text: string) => Promise<void>
  approve: (requestId: string) => Promise<void>
  deny: (requestId: string, message?: string) => Promise<void>
  interrupt: () => Promise<void>
  stop: () => Promise<void>
}

export const useAgentStore = create<AgentStore>((set, get) => {
  // 1회 구독: Main 이벤트를 reducer 로 reduce.
  agentsApi.onEvent(({ sessionId, event }) => {
    if (sessionId === get().sessionId) set((s) => appendEvent(s as AgentState, event))
  })
  agentsApi.onStatusChange((info) => set((s) => setStatus(s as AgentState, info)))
  agentsApi.onPermissionRequest((req) => set((s) => addPending(s as AgentState, req)))
  agentsApi.onFocusSession((sessionId) => {
    if (sessionId === get().sessionId) set((s) => ({ focusTick: s.focusTick + 1 }))
  })

  return {
    ...initialAgentState(),
    focusTick: 0,
    start: async (projectId, cwd, firstMessage) => {
      const info = await agentsApi.start({ projectId, cwd, firstMessage })
      set((s) => ({ ...startSession(s as AgentState, info.sessionId), focusTick: s.focusTick }))
    },
    send: async (text) => {
      const id = get().sessionId
      if (!id) return
      set((s) => appendUser(s as AgentState, text))
      await agentsApi.send(id, text)
    },
    approve: async (requestId) => {
      const id = get().sessionId
      if (!id) return
      set((s) => removePending(s as AgentState, requestId))
      await agentsApi.respondPermission(id, requestId, { behavior: 'allow' })
    },
    deny: async (requestId, message) => {
      const id = get().sessionId
      if (!id) return
      set((s) => removePending(s as AgentState, requestId))
      await agentsApi.respondPermission(id, requestId, { behavior: 'deny', message })
    },
    interrupt: async () => {
      const id = get().sessionId
      if (id) await agentsApi.interrupt(id)
    },
    stop: async () => {
      const id = get().sessionId
      if (id) await agentsApi.stop(id)
    }
  }
})

export type { LogItem }
```

- [ ] **Step 2: 타입체크**

Run: `pnpm run typecheck:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/stores/agent.ts
git commit -m "feat(m3-ui): agent Zustand store (reducer + agentsApi subscriptions)"
```

---

## Task 5: 표시 컴포넌트 (AgentEventItem, PermissionCard)

**Files:**
- Create: `src/components/AgentEventItem.tsx`
- Create: `src/components/PermissionCard.tsx`

- [ ] **Step 1: `AgentEventItem.tsx` 작성**

```tsx
import type { LogItem } from '@/stores/agent-reducer'

export default function AgentEventItem({ item }: { item: LogItem }): React.JSX.Element | null {
  if (item.kind === 'user') {
    return <div className="ev ev--user">{item.text}</div>
  }
  const e = item.event
  switch (e.type) {
    case 'message':
      return <div className="ev ev--assistant">{e.text}</div>
    case 'tool_use':
      return <div className="ev ev--tool">▸ {e.name} <code>{short(e.input)}</code></div>
    case 'tool_result':
      return <div className="ev ev--tool-result">◂ {e.name}</div>
    case 'usage':
      return <div className="ev ev--usage">↑{e.tokens.input} ↓{e.tokens.output} tokens</div>
    case 'error':
      return <div className="ev ev--error">⚠ {e.message}</div>
    case 'session_end':
      return <div className="ev ev--system">— 세션 종료 ({e.reason}) —</div>
    default:
      return null
  }
}

function short(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 120 ? s.slice(0, 120) + '…' : s
}
```

- [ ] **Step 2: `PermissionCard.tsx` 작성**

```tsx
import type { PermissionRequest } from '@shared/types'

export default function PermissionCard({
  req, onApprove, onDeny
}: {
  req: PermissionRequest
  onApprove: () => void
  onDeny: () => void
}): React.JSX.Element {
  const title = req.kind === 'question' ? '질문 — 답이 필요합니다' : `승인 필요 — ${req.toolName}`
  return (
    <div className="perm-card">
      <div className="perm-card__title">⚠️ {title}</div>
      <code className="perm-card__detail">{JSON.stringify(req.input)}</code>
      <div className="perm-card__actions">
        <button className="btn btn--primary" onClick={onApprove}>승인</button>
        <button className="btn btn--ghost-danger" onClick={onDeny}>거부</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 타입체크**

Run: `pnpm run typecheck:web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/AgentEventItem.tsx src/components/PermissionCard.tsx
git commit -m "feat(m3-ui): AgentEventItem + PermissionCard components"
```

---

## Task 6: AgentView

**Files:**
- Create: `src/views/AgentView.tsx`

- [ ] **Step 1: 구현**

`src/views/AgentView.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'
import type { Project, SessionStatus } from '@shared/types'
import { useAgentStore } from '@/stores/agent'
import AgentEventItem from '@/components/AgentEventItem'
import PermissionCard from '@/components/PermissionCard'

export default function AgentView({ project }: { project: Project }): React.JSX.Element {
  const { sessionId, status, log, pending, focusTick, start, send, approve, deny, interrupt, stop } = useAgentStore()
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  // 새 로그/포커스 시 맨 아래로 스크롤.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log.length, focusTick])

  const submit = (): void => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    if (!sessionId) void start(project.id, project.workspacePath, text)
    else void send(text)
  }

  return (
    <div className="agent">
      <div className="agent__bar">
        <span className={`badge badge--${status ?? 'none'}`}>{statusLabel(status)}</span>
        <span className="agent__spacer" />
        <button className="btn" onClick={() => void interrupt()} disabled={status !== 'running'}>중단</button>
        <button className="btn btn--ghost-danger" onClick={() => void stop()} disabled={!sessionId}>정지</button>
      </div>

      <div className="agent__log" ref={logRef}>
        {log.length === 0 && <div className="empty">아래에 지시를 입력해 에이전트를 시작하세요.</div>}
        {log.map((item) => <AgentEventItem key={item.id} item={item} />)}
        {pending.map((req) => (
          <PermissionCard key={req.requestId} req={req}
            onApprove={() => void approve(req.requestId)}
            onDeny={() => void deny(req.requestId, '사용자가 거부함')} />
        ))}
      </div>

      <div className="agent__input">
        <input className="input" value={draft} placeholder="에이전트에게 지시…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        <button className="btn btn--primary" onClick={submit}>{sessionId ? '전송' : '시작'}</button>
      </div>
    </div>
  )
}

function statusLabel(s: SessionStatus | null): string {
  switch (s) {
    case 'running': return '● 실행 중'
    case 'waiting_user': return '⏸ 사람 대기'
    case 'idle': return '○ 유휴'
    case 'crashed': return '✕ 비정상 종료'
    case 'done': return '✓ 완료'
    default: return '대기'
  }
}
```

- [ ] **Step 2: 타입체크**

Run: `pnpm run typecheck:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/views/AgentView.tsx
git commit -m "feat(m3-ui): AgentView (log + input + status + inline approval)"
```

---

## Task 7: Workspace (채널 탭 + 듀얼채널 가드) + App 라우팅

**Files:**
- Create: `src/views/Workspace.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: `Workspace.tsx` 작성**

`src/views/Workspace.tsx`:
```tsx
import { useState } from 'react'
import type { Project } from '@shared/types'
import AgentView from './AgentView'
import Terminal from './Terminal'
import { useAgentStore } from '@/stores/agent'
import { useSessionStore } from '@/stores/session'

type Channel = 'agent' | 'terminal'

export default function Workspace({
  project, onBack
}: {
  project: Project
  onBack: () => void
}): React.JSX.Element {
  const [channel, setChannel] = useState<Channel>('agent')
  const agentRunning = useAgentStore((s) => s.sessionId !== null && s.status !== 'done' && s.status !== 'crashed')
  const terminalRunning = useSessionStore((s) => s.sessionId !== null)

  // 듀얼채널: 보기 전환은 자유. 다른 채널이 실행 중이면 경고(차단 아님 — 확인 시 전환).
  const switchTo = (next: Channel): void => {
    if (next === channel) return
    const otherRunning = next === 'agent' ? terminalRunning : agentRunning
    if (otherRunning) {
      const other = next === 'agent' ? '터미널' : '에이전트'
      const ok = window.confirm(
        `${other} 채널이 실행 중입니다. 같은 폴더라 파일 충돌이 날 수 있습니다.\n` +
        `그래도 ${next === 'agent' ? '에이전트' : '터미널'} 채널로 전환할까요? (두 채널이 동시에 실행됩니다)`
      )
      if (!ok) return
    }
    setChannel(next)
  }

  return (
    <section className="workspace">
      <div className="workspace__bar">
        <button className="btn" onClick={onBack}>← 대시보드</button>
        <span className="workspace__name">{project.name}</span>
        <div className="tabs">
          <button className={`tab ${channel === 'agent' ? 'tab--on' : ''}`} onClick={() => switchTo('agent')}>🤖 에이전트</button>
          <button className={`tab ${channel === 'terminal' ? 'tab--on' : ''}`} onClick={() => switchTo('terminal')}>⌨️ 터미널</button>
        </div>
      </div>
      <div className="workspace__body">
        {channel === 'agent' ? <AgentView project={project} /> : <Terminal project={project} onBack={onBack} embedded />}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: `Terminal.tsx` 에 `embedded` prop 추가(뒤로가기 바 중복 방지)**

`src/views/Terminal.tsx`의 시그니처와 back 버튼을 수정:
```tsx
export default function Terminal({
  project,
  onBack,
  embedded = false
}: {
  project: Project
  onBack: () => void
  embedded?: boolean
}): React.JSX.Element {
```
그리고 `terminal__bar` 안의 `← 대시보드` 버튼을 조건부로:
```tsx
        {!embedded && (
          <button className="btn" onClick={onBack}>← 대시보드</button>
        )}
```

- [ ] **Step 3: `src/App.tsx` 수정 — Workspace 라우팅**

```tsx
import { useState } from 'react'
import Dashboard from './views/Dashboard'
import Workspace from './views/Workspace'
import type { Project } from '@shared/types'

export default function App(): React.JSX.Element {
  const [active, setActive] = useState<Project | null>(null)

  return (
    <div className="app">
      <header className="app__topbar">
        <span className="app__brand">개발 상황판</span>
        <span className="app__tag">DEV CONSOLE · M3</span>
      </header>
      <main className="app__main">
        {active ? (
          <Workspace project={active} onBack={() => setActive(null)} />
        ) : (
          <Dashboard onOpenTerminal={setActive} />
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 4: 타입체크**

Run: `pnpm run typecheck:web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/Workspace.tsx src/views/Terminal.tsx src/App.tsx
git commit -m "feat(m3-ui): Workspace channel tabs + dual-channel warn guard"
```

---

## Task 8: Main 배선 (notifier 실제 + focusSession)

**Files:**
- Modify: `electron/ipc/agents.ts`
- Modify: `electron/ipc/index.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: `electron/ipc/agents.ts` — notifier 호출 + focusSession**

`registerAgentHandlers` 가 notifier 를 받게 하고, 단일 콜백 안에서 브로드캐스트 + notifier 를 함께 호출:
```typescript
import { ipcMain, BrowserWindow } from 'electron'
import type { ClaudeAgentManager } from '../agent/agent-manager'
import type { AgentNotifier } from '../agent/notifier'
import type {
  AgentStartInput, AgentSessionInfo, AgentEventPayload, PermissionDecision, PermissionRequest
} from '@shared/types'

export function registerAgentHandlers(agentManager: ClaudeAgentManager, notifier: AgentNotifier): void {
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
  }

  agentManager.onEvent((sessionId, event) => {
    const payload: AgentEventPayload = { sessionId, event }
    broadcast('agent:event', payload)
  })
  agentManager.onStatus((info: AgentSessionInfo) => {
    broadcast('agent:statusChange', info)
    notifier.onStatus(info)
  })
  agentManager.onPermissionRequest((req: PermissionRequest) => {
    broadcast('agent:permissionRequest', req)
    notifier.onPermissionRequest(req)
  })

  ipcMain.handle('agents:start', (_e, input: AgentStartInput): AgentSessionInfo => agentManager.start(input))
  ipcMain.handle('agents:send', (_e, { sessionId, text }: { sessionId: string; text: string }): void =>
    agentManager.send(sessionId, text))
  ipcMain.handle('agents:respondPermission',
    (_e, a: { sessionId: string; requestId: string; decision: PermissionDecision }): void =>
      agentManager.respondPermission(a.sessionId, a.requestId, a.decision))
  ipcMain.handle('agents:interrupt', (_e, { sessionId }: { sessionId: string }): Promise<void> =>
    agentManager.interrupt(sessionId))
  ipcMain.handle('agents:stop', (_e, { sessionId }: { sessionId: string }): void =>
    agentManager.stop(sessionId))
}
```

- [ ] **Step 2: `electron/ipc/index.ts` — notifier 전달**

```typescript
import { registerProjectHandlers } from './projects'
import { registerSessionHandlers } from './sessions'
import { registerDialogHandlers } from './dialog'
import { registerAgentHandlers } from './agents'
import type { PtyManager } from '../pty/pty-manager'
import type { ClaudeAgentManager } from '../agent/agent-manager'
import type { AgentNotifier } from '../agent/notifier'

export function registerIpcHandlers(
  ptyManager: PtyManager,
  agentManager: ClaudeAgentManager,
  notifier: AgentNotifier
): void {
  registerProjectHandlers()
  registerSessionHandlers(ptyManager)
  registerDialogHandlers()
  registerAgentHandlers(agentManager, notifier)
}
```

- [ ] **Step 3: `electron/main.ts` — notifier 생성 + 배선 + dispose**

import 추가:
```typescript
import { app, BrowserWindow, Notification } from 'electron'
import { AgentNotifier } from './agent/notifier'
```
(기존 `import { app, BrowserWindow } from 'electron'` 를 위 줄로 교체.)

`agentManager` 생성 아래에 notifier 생성:
```typescript
// 알림(M3 UI) — Main 소유. Electron Notification + 작업표시줄 배지.
// (진짜 시스템 트레이 아이콘은 M6 트레이 상주로 이월.)
const notifier = new AgentNotifier({
  notify: ({ title, body, sessionId }) => {
    if (!Notification.isSupported()) return
    const note = new Notification({ title, body })
    note.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.focus()
      win.webContents.send('agent:focusSession', sessionId)
    })
    note.show()
  },
  setBadgeCount: (n) => { app.setBadgeCount(n) }
})
```

`registerIpcHandlers(ptyManager, agentManager)` → `registerIpcHandlers(ptyManager, agentManager, notifier)`.

`will-quit` 의 `agentManager.disposeAll()` 아래에 `notifier.dispose()` 추가.

- [ ] **Step 4: 타입체크 + 전체 테스트**

Run: `pnpm run typecheck && pnpm test`
Expected: PASS (기존 + 신규 reducer/notifier 테스트, 라이브는 skip).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/agents.ts electron/ipc/index.ts electron/main.ts
git commit -m "feat(m3-ui): wire AgentNotifier + focusSession into Main"
```

---

## Task 9: 스타일

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 끝에 M3 UI 스타일 추가**

`src/styles.css` 맨 끝에 추가:
```css
/* M3 — Agent 채널 UI */
.workspace { display: flex; flex-direction: column; height: 100%; gap: 10px; }
.workspace__bar { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.workspace__name { font-weight: 500; }
.workspace__body { flex: 1; min-height: 0; display: flex; }

.tabs { display: flex; gap: 4px; margin-left: auto; }
.tab {
  font-family: var(--font-sans); font-size: 12px; padding: 5px 12px;
  background: var(--bg-elevated); color: var(--text-secondary);
  border: 1px solid var(--border); cursor: pointer;
}
.tab--on { background: var(--accent); color: #121110; border-color: var(--accent); font-weight: 600; }

.agent { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 8px; }
.agent__bar { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.agent__spacer { flex: 1; }
.agent__log {
  flex: 1; min-height: 0; overflow-y: auto; padding: 10px;
  background: var(--bg-surface); border: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 6px;
}
.agent__input { display: flex; gap: 8px; flex-shrink: 0; }

.badge { font-family: var(--font-mono); font-size: 11px; padding: 2px 10px; border-radius: 10px; white-space: nowrap; }
.badge--running { background: rgba(139,156,247,0.18); color: var(--accent-hover); }
.badge--waiting_user { background: rgba(232,163,61,0.22); color: #e8a33d; animation: blink 1.2s ease-in-out infinite; }
.badge--idle { background: rgba(168,162,158,0.15); color: var(--text-secondary); }
.badge--crashed { background: rgba(239,68,68,0.15); color: var(--danger); }
.badge--done { background: rgba(120,200,140,0.15); color: #78c88c; }
.badge--none { color: var(--text-tertiary); }
@keyframes blink { 50% { opacity: 0.45; } }

.ev { font-size: 13px; line-height: 1.5; max-width: 90%; }
.ev--user { align-self: flex-end; background: var(--accent); color: #121110; padding: 6px 10px; border-radius: 8px; }
.ev--assistant { background: var(--bg-elevated); padding: 6px 10px; border-radius: 8px; }
.ev--tool, .ev--tool-result { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
.ev--tool code { color: var(--text-tertiary); }
.ev--usage { font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); }
.ev--error { color: var(--danger); }
.ev--system { text-align: center; color: var(--text-tertiary); font-size: 11px; }

.perm-card {
  border-left: 3px solid #e8a33d; background: rgba(232,163,61,0.10);
  padding: 10px 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 6px;
}
.perm-card__title { font-weight: 600; }
.perm-card__detail { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); word-break: break-all; }
.perm-card__actions { display: flex; gap: 8px; margin-top: 2px; }
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "style(m3-ui): Agent channel styles (tabs, log, badges, permission card)"
```

---

## Task 10: 수동 E2E 스모크 + 빌드

**Files:** (없음 — 검증)

- [ ] **Step 1: 전체 그린**

Run: `pnpm test && pnpm run typecheck && pnpm build`
Expected: 모두 PASS/green.

- [ ] **Step 2: 앱 스모크 (`pnpm dev`)**

1. 프로젝트 추가/열기 → 작업공간 뷰 + 채널 탭 표시.
2. 에이전트 탭에서 "poc.txt 파일 만들어줘" 입력 → 전송.
   - 대화 로그에 assistant/tool_use 흐름.
   - **인라인 주황 승인 카드**(Write) + 상태 "⏸ 사람 대기" 깜빡임.
   - **윈도우 토스트 알림** + 작업표시줄 배지(1).
3. 카드 "거부" → claude 거부 인지 메시지, 배지 0.
4. 토스트 클릭 → 창 포커스(+ 에이전트 탭).
5. 에이전트 실행 중 "터미널" 탭 클릭 → **파일충돌 경고 confirm** → 확인 시 전환(둘 다 실행).
6. (선택) 아무 입력 없이 60초 → "지시 대기" 토스트.

- [ ] **Step 3: 발견 수정만 커밋(있으면)**

---

## Self-Review (작성자 체크)

**1. 스펙 커버리지(설계 문서 대비):**
- 인라인 승인 카드 → Task 5 PermissionCard + Task 6 AgentView. ✅
- 채널 탭/내비 → Task 7 Workspace + App. ✅
- 듀얼채널 경고 후 허용 → Task 7 `switchTo` confirm(차단 아님). ✅
- waiting_user 알림 + 배지 → Task 3 notifier + Task 8 배선. ✅
- 유휴 60초 알림 → Task 3 onStatus('idle') 타이머. ✅
- 토스트 클릭 점프 → Task 8 click→focus+focusSession, Task 4 store focusTick. ✅
- 대화 로그 이벤트 투영 → Task 2 reducer + Task 5 AgentEventItem. ✅
- 새 agent 스토어 → Task 4. ✅

**2. 플레이스홀더 스캔:** 모든 코드 스텝 실제 코드. TODO/TBD 없음. ✅

**3. 타입 일관성:**
- reducer 함수명(`startSession/appendEvent/appendUser/setStatus/addPending/removePending`)이 Task 2 정의 ↔ Task 4 store 사용 일치. ✅
- `registerIpcHandlers(ptyManager, agentManager, notifier)` 3-인자가 Task 8 index.ts ↔ main.ts 일치. ✅
- `AgentNotifier`/`NotifierDeps`/`NotifyOpts` Task 3 ↔ Task 8 일치. ✅
- `agentsApi.onFocusSession` Task 1(계약) ↔ Task 4(사용) 일치. ✅

**미해결/주의(마스터 확인):**
- ① **트레이 배지 = `app.setBadgeCount`(작업표시줄)** 로 축소, 진짜 시스템 트레이 아이콘은 M6 이월(설계의 "Tray 생성" 조정).
- ② `window.confirm` 사용(듀얼채널 경고) — Electron 렌더러에서 동작하나, 후속에 커스텀 모달로 교체 가능.
- ③ 명세 §2-2 "동시 금지" → "경고 후 허용" 본 PR 머지 후 spec.md 반영 필요.

---

## Execution Handoff

계획 완료. 저장: `plan/dev-console-m3-ui-plan.md`.
구현 코딩은 **Codex 위임**, Claude 가 태스크별 검증·테스트·커밋 리드. 브랜치 `m3-agent-ui` → push → PR.
