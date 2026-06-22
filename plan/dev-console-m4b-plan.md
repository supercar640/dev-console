# M4b — 이벤트 영속화 + 지난 세션 복원 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에이전트가 만드는 모든 이벤트를 발생 시점에 SQLite에 적재하고, 앱 재시작 시 프로젝트별 "마지막 세션 1건"을 읽기 전용으로 복원한다.

**Architecture:** Main(백엔드)이 `events`/`sessions`/`cli_agents` 테이블을 채운다(쓰기는 기존 broadcast 흐름에 부수효과로 한 줄 추가). 앱 시작 시 렌더러가 `agents:loadHistory` 1회 호출 → 프로젝트별 마지막 세션의 이벤트를 받아 검증된 `agent-reducer`로 재생(replay)해 `live=false` 상태로 화면 복원. 위험한 순수 로직(직렬화·복원 규칙·재생·상태 라우팅)만 자동 테스트하고, DB 왕복(SQL)과 통합은 수동 스모크로 검증.

**Tech Stack:** Electron(Main/Renderer) · TypeScript(strict) · better-sqlite3(동기, Electron ABI 전용) · Zustand · React · vitest(node 환경, colocated `*.test.ts`).

## Global Constraints

- **마이그레이션 없음** — M1의 기존 스키마(`events`/`sessions`/`cli_agents`)를 그대로 채운다. 스키마 변경 금지.
- **저장은 best-effort 부수효과** — 저장 실패가 앱/세션을 멈추면 안 된다. record 호출은 try/catch로 감싸 에러는 로깅만 한다. 기존 broadcast/notifier 흐름은 건드리지 않는다.
- **better-sqlite3는 node vitest에서 로드 불가**(Electron ABI 전용, NODE_MODULE_VERSION 불일치). 따라서 DB를 직접 여는 코드(`agent-store.ts`)는 **단위 테스트 없음** — 위험 로직은 `event-codec.ts`(순수)로 분리해 테스트하고, DB 왕복은 수동 스모크로 검증. (기존 `projects.ts` 등 DB 코드와 동일 패턴.)
- **가짜 진척도 금지**(AGENTS.md 원칙 #4) — 복원 진척도/현재 활동은 별도 저장 없이 기존 `computeProjectProgress(agentState)`가 복원된 `log`에서 산출한다.
- **커밋·푸시는 소유자(마스터) 승인 시 실행**(AGENTS.md). 아래 각 태스크의 Commit 스텝은 TDD 케이던스를 위한 것이며, 실제 커밋은 마스터 승인 후 진행한다. 커밋 메시지는 저장소 관례(한글 conventional commits, 예: `feat(m4b): …`)를 따르고, 커밋 시점에 표준 푸터(Co-Authored-By / Claude-Session)를 붙인다.
- **테스트 실행:** 특정 파일은 `pnpm vitest run <경로>`, 전체는 `pnpm test`. 타입체크는 `pnpm typecheck:node`(Main/shared) · `pnpm typecheck:web`(Renderer) · `pnpm typecheck`(둘 다). 빌드는 `pnpm build`.

---

## 파일 구조 (생성/수정 맵)

**생성 (순수/격리 → TDD):**
- `electron/agent/event-codec.ts` — Main측 순수 직렬화/복원 규칙(better-sqlite3 미import). `encodeEvent`/`decodeEvent`/`resolveRestoredStatus`.
- `electron/agent/event-codec.test.ts` — 라운드트립 + 방어 + 상태 강등 규칙.
- `electron/db/agent-store.ts` — DB 읽기/쓰기 어댑터(better-sqlite3 동기). **단위 테스트 없음**.
- `src/stores/agent-restore.ts` — `RestoredSession → AgentState`(replay, 순수, 렌더러측).
- `src/stores/agent-restore.test.ts` — 재생 동등성 + `live=false` + status 매핑 + 진척도 산출.

**수정:**
- `shared/types.ts` — `RestoredSession` 타입 + `DevConsoleApi.agents.loadHistory()`.
- `electron/agent/agent-manager.ts` — 세션 id `a${seq}` → `randomUUID()`.
- `electron/agent/agent-manager.test.ts` — UUID 형식 가드 테스트 1건 추가.
- `electron/ipc/agents.ts` — `agentStore` 주입, record 배선(start/event/end), `agents:loadHistory` 핸들러.
- `electron/ipc/index.ts` — `registerIpcHandlers`에 `agentStore` 파라미터.
- `electron/main.ts` — `AgentStore` 생성·주입.
- `electron/preload.ts` + `src/ipc-client.ts` — `agents.loadHistory()` 노출.
- `src/stores/agent-reducer.ts` — `AgentState.live` 필드.
- `src/stores/agent-reducer.test.ts` — `live` 불변식.
- `src/stores/agent-multi.ts` — `hydrateProject` + `resetForProject`.
- `src/stores/agent-multi.test.ts` — 두 함수 검증.
- `src/stores/agent.ts` — `loadHistory`/`reset` 액션.
- `src/App.tsx` — 마운트 시 `loadHistory` 1회.
- `src/views/AgentView.tsx` + `src/styles.css` — `live=false` 읽기 전용 UI.

**재사용(변경 없음):** `agent-reducer`의 전이 함수, `project-progress`/`project-status` 셀렉터, `StatusDot`, `Dashboard`/`Sidebar`(복원 상태 자동 투영).

---

## Task 1: event-codec (순수 직렬화/복원 규칙) + RestoredSession 타입

**Files:**
- Create: `electron/agent/event-codec.ts`
- Create: `electron/agent/event-codec.test.ts`
- Modify: `shared/types.ts` (RestoredSession 타입 추가)

**Interfaces:**
- Consumes: `AgentEvent`, `SessionStatus` (`@shared/types`).
- Produces:
  - `encodeEvent(event: AgentEvent): string`
  - `decodeEvent(payloadJson: string | null): AgentEvent | null`
  - `resolveRestoredStatus(storedStatus: SessionStatus, endedAt: string | null): SessionStatus`
  - `interface RestoredSession { projectId: string; sessionId: string; status: SessionStatus; events: AgentEvent[] }`

- [ ] **Step 1: RestoredSession 타입 추가 (shared/types.ts)**

`shared/types.ts`의 `AgentSessionInfo` 인터페이스 바로 다음에 추가:

```ts
/** M4b — 재시작 시 복원되는 "프로젝트별 마지막 세션 1건"(읽기 전용). */
export interface RestoredSession {
  projectId: string
  sessionId: string
  status: SessionStatus
  events: AgentEvent[]
}
```

- [ ] **Step 2: 실패하는 테스트 작성 (event-codec.test.ts)**

```ts
import { describe, it, expect } from 'vitest'
import { encodeEvent, decodeEvent, resolveRestoredStatus } from './event-codec'
import type { AgentEvent } from '@shared/types'

const SAMPLES: AgentEvent[] = [
  { type: 'message', role: 'assistant', text: 'hi\nthere' },
  { type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'a', status: 'completed' }] } },
  { type: 'tool_result', name: 'Bash', output: 'ok' },
  { type: 'permission_request', description: 'Bash: ls' },
  { type: 'user_input_required', prompt: '{"q":1}' },
  { type: 'usage', tokens: { input: 3, output: 5 } },
  { type: 'error', message: 'boom', recoverable: false },
  { type: 'session_end', reason: 'done' }
]

describe('event-codec', () => {
  it('모든 AgentEvent variant를 직렬화→역직렬화하면 원본과 같다', () => {
    for (const e of SAMPLES) {
      expect(decodeEvent(encodeEvent(e))).toEqual(e)
    }
  })

  it('깨진 JSON / null / 미지 타입은 null로 방어한다', () => {
    expect(decodeEvent('{not json')).toBeNull()
    expect(decodeEvent(null)).toBeNull()
    expect(decodeEvent('123')).toBeNull()
    expect(decodeEvent('{"type":"bogus"}')).toBeNull()
  })

  it('미종료(ended_at 없음)+살아있던 상태는 crashed로 강등한다', () => {
    expect(resolveRestoredStatus('running', null)).toBe('crashed')
    expect(resolveRestoredStatus('waiting_user', null)).toBe('crashed')
    expect(resolveRestoredStatus('idle', null)).toBe('crashed')
  })

  it('정상 종료(ended_at 있음)는 저장된 상태를 보존한다', () => {
    expect(resolveRestoredStatus('done', '2026-06-22T00:00:00.000Z')).toBe('done')
    expect(resolveRestoredStatus('crashed', '2026-06-22T00:00:00.000Z')).toBe('crashed')
  })
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `pnpm vitest run electron/agent/event-codec.test.ts`
Expected: FAIL — `Failed to resolve import "./event-codec"` (파일 없음)

- [ ] **Step 4: 최소 구현 작성 (event-codec.ts)**

```ts
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
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run electron/agent/event-codec.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: 타입체크**

Run: `pnpm typecheck:node`
Expected: 에러 없음

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts electron/agent/event-codec.ts electron/agent/event-codec.test.ts
git commit -m "feat(m4b): event-codec 직렬화·복원 규칙 + RestoredSession 타입 (TDD)"
```

---

## Task 2: agent-store (DB 읽기/쓰기 어댑터)

> **단위 테스트 없음** — better-sqlite3는 Electron ABI 전용이라 node vitest에서 DB를 열 수 없다. 위험 로직은 Task 1의 `event-codec`로 분리되어 있고, 이 어댑터의 SQL 왕복은 Task 10 수동 스모크로 검증한다. 검증 게이트는 타입체크.

**Files:**
- Create: `electron/db/agent-store.ts`

**Interfaces:**
- Consumes: `encodeEvent`/`decodeEvent`/`resolveRestoredStatus` (`../agent/event-codec`), `RestoredSession`/`AgentEvent`/`SessionStatus` (`@shared/types`), `Database`(better-sqlite3, type-only).
- Produces:
  - `class AgentStore`
    - `constructor(db: Database.Database)`
    - `recordSessionStart(sessionId: string, projectId: string, startedAt: string): void`
    - `recordEvent(sessionId: string, event: AgentEvent, timestamp: string): void`
    - `recordSessionEnd(sessionId: string, status: SessionStatus, endedAt: string): void`
    - `loadHistory(): RestoredSession[]`

- [ ] **Step 1: 구현 작성 (agent-store.ts)**

```ts
// Agent 이벤트/세션 영속화 어댑터(Main 소유). better-sqlite3 동기 API.
// 단위 테스트 없음(Electron ABI 전용) — 위험 로직은 event-codec(순수)로 분리, SQL은 수동 스모크.
import type Database from 'better-sqlite3'
import type { AgentEvent, RestoredSession, SessionStatus } from '@shared/types'
import { encodeEvent, decodeEvent, resolveRestoredStatus } from '../agent/event-codec'

interface SessionRow {
  sessionId: string
  projectId: string
  status: SessionStatus
  endedAt: string | null
}

export class AgentStore {
  constructor(private readonly db: Database.Database) {}

  /** 세션 시작 1행. cli_agents는 프로젝트당 기본 에이전트 1행을 결정적 id로 lazy upsert. */
  recordSessionStart(sessionId: string, projectId: string, startedAt: string): void {
    const agentId = `default-${projectId}`
    this.db
      .prepare(`INSERT OR IGNORE INTO cli_agents (id, project_id, cli_type) VALUES (?, ?, 'claude')`)
      .run(agentId, projectId)
    this.db
      .prepare(`INSERT INTO sessions (id, agent_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(sessionId, agentId, startedAt)
  }

  /** 이벤트 1행. type = 필터/인덱스용, payload_json = 원형 보존, id ASC = 발생 순서. */
  recordEvent(sessionId: string, event: AgentEvent, timestamp: string): void {
    this.db
      .prepare(`INSERT INTO events (session_id, type, payload_json, timestamp) VALUES (?, ?, ?, ?)`)
      .run(sessionId, event.type, encodeEvent(event), timestamp)
  }

  /** 세션 종료: 상태 + ended_at 갱신. */
  recordSessionEnd(sessionId: string, status: SessionStatus, endedAt: string): void {
    this.db
      .prepare(`UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?`)
      .run(status, endedAt, sessionId)
  }

  /** 프로젝트별 가장 최근 세션 1건 + 그 이벤트를 복원용으로 조회. */
  loadHistory(): RestoredSession[] {
    const rows = this.db
      .prepare(
        `SELECT s.id AS sessionId, a.project_id AS projectId, s.status AS status, s.ended_at AS endedAt
         FROM sessions s
         JOIN cli_agents a ON s.agent_id = a.id
         ORDER BY a.project_id ASC, s.started_at DESC, s.rowid DESC`
      )
      .all() as SessionRow[]

    const seen = new Set<string>()
    const result: RestoredSession[] = []
    for (const row of rows) {
      if (seen.has(row.projectId)) continue // 프로젝트별 최근 1건만(정렬상 첫 행)
      seen.add(row.projectId)
      const eventRows = this.db
        .prepare(`SELECT payload_json AS payloadJson FROM events WHERE session_id = ? ORDER BY id ASC`)
        .all(row.sessionId) as Array<{ payloadJson: string | null }>
      const events = eventRows
        .map((e) => decodeEvent(e.payloadJson))
        .filter((e): e is AgentEvent => e !== null)
      result.push({
        projectId: row.projectId,
        sessionId: row.sessionId,
        status: resolveRestoredStatus(row.status, row.endedAt),
        events
      })
    }
    return result
  }
}
```

- [ ] **Step 2: 타입체크**

Run: `pnpm typecheck:node`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add electron/db/agent-store.ts
git commit -m "feat(m4b): agent-store DB 어댑터 (record start/event/end + loadHistory)"
```

---

## Task 3: 세션 ID를 UUID로 (재시작 PK 충돌 방지)

**Files:**
- Modify: `electron/agent/agent-manager.ts`
- Modify: `electron/agent/agent-manager.test.ts` (가드 테스트 1건 추가)

**Interfaces:**
- 변경 없음(반환 타입 동일). 세션 id 값 형식만 `a1` → UUID. sessionId는 렌더러에서 불투명 라우팅 키로만 쓰여 안전.

- [ ] **Step 1: 실패하는 가드 테스트 추가 (agent-manager.test.ts)**

기존 `describe('ClaudeAgentManager', …)` 블록 안에 테스트 추가:

```ts
  it('세션 id는 재시작 충돌을 피하기 위해 UUID 형식이다', () => {
    const mgr = new ClaudeAgentManager(() => fakeQuery)
    const info = mgr.start({ projectId: 'p1', cwd: 'C:\\' })
    expect(info.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm vitest run electron/agent/agent-manager.test.ts`
Expected: FAIL — `expected 'a1' to match /^[0-9a-f]{8}-…/`

- [ ] **Step 3: 구현 변경 (agent-manager.ts)**

파일 상단 import에 추가:

```ts
import { randomUUID } from 'node:crypto'
```

`private seq = 0` 줄을 삭제하고, `start()`의 id 생성을 교체:

```ts
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
```

- [ ] **Step 4: 전체 매니저 테스트 통과 확인**

Run: `pnpm vitest run electron/agent/agent-manager.test.ts`
Expected: PASS (기존 테스트는 동적 `info.sessionId`를 쓰므로 회귀 없음 + 새 가드 통과)

- [ ] **Step 5: 타입체크**

Run: `pnpm typecheck:node`
Expected: 에러 없음

- [ ] **Step 6: Commit**

```bash
git add electron/agent/agent-manager.ts electron/agent/agent-manager.test.ts
git commit -m "feat(m4b): 세션 id를 randomUUID로 (재시작 PK 충돌 방지)"
```

---

## Task 4: Main 배선 — 저장 부수효과 + loadHistory IPC

> 비-TDD(Electron/IPC). 검증 게이트 = 타입체크 + 빌드. 실제 저장/조회는 Task 10 수동 스모크.

**Files:**
- Modify: `shared/types.ts` (`DevConsoleApi.agents.loadHistory`)
- Modify: `electron/preload.ts`
- Modify: `src/ipc-client.ts`
- Modify: `electron/ipc/agents.ts`
- Modify: `electron/ipc/index.ts`
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: `AgentStore`(Task 2), `RestoredSession`(Task 1), `getDatabase`(`../db`).
- Produces:
  - `DevConsoleApi.agents.loadHistory(): Promise<RestoredSession[]>`
  - `agentsApi.loadHistory(): Promise<RestoredSession[]>` (`src/ipc-client.ts`)
  - `registerAgentHandlers(agentManager, notifier, agentStore)` / `registerIpcHandlers(ptyManager, agentManager, notifier, agentStore)`

- [ ] **Step 1: DevConsoleApi에 loadHistory 추가 (shared/types.ts)**

먼저 import 가능하도록 — `RestoredSession`은 Task 1에서 같은 파일에 정의됨. `DevConsoleApi.agents`의 `onFocusSession` 줄 다음(닫는 `}` 직전)에 추가:

```ts
    onFocusSession(cb: (sessionId: string) => void): () => void
    /** M4b — 재시작 시 프로젝트별 마지막 세션을 복원용으로 일괄 조회. */
    loadHistory(): Promise<RestoredSession[]>
```

- [ ] **Step 2: preload에 loadHistory 노출 (electron/preload.ts)**

`agents` 객체의 `onFocusSession` 블록 다음(닫는 `}` 직전)에 추가:

```ts
    ,
    loadHistory: () => ipcRenderer.invoke('agents:loadHistory')
```

(주의: `onFocusSession`의 블록이 객체의 마지막 멤버이므로 콤마를 앞에 둔다. 또는 `onFocusSession` 블록 끝에 콤마를 붙이고 새 줄로 `loadHistory: …`를 추가해도 된다.)

- [ ] **Step 3: ipc-client에 loadHistory 추가 (src/ipc-client.ts)**

import 라인에 `RestoredSession` 추가:

```ts
import type {
  CreateProjectInput, Project, StartSessionInput, SessionInfo,
  AgentStartInput, AgentSessionInfo, AgentEventPayload, PermissionDecision, PermissionRequest,
  RestoredSession
} from '@shared/types'
```

`agentsApi` 객체의 `onFocusSession` 멤버 다음에 추가:

```ts
  onFocusSession: (cb: (sessionId: string) => void): (() => void) =>
    window.api.agents.onFocusSession(cb),
  loadHistory: (): Promise<RestoredSession[]> => window.api.agents.loadHistory()
```

- [ ] **Step 4: agents.ts — store 주입 + record 배선 + loadHistory 핸들러 (electron/ipc/agents.ts)**

파일 전체를 다음으로 교체:

```ts
import { ipcMain, BrowserWindow } from 'electron'
import type { ClaudeAgentManager } from '../agent/agent-manager'
import type { AgentNotifier } from '../agent/notifier'
import type { AgentStore } from '../db/agent-store'
import type {
  AgentStartInput, AgentSessionInfo, AgentEventPayload, PermissionDecision, PermissionRequest,
  RestoredSession
} from '@shared/types'

export function registerAgentHandlers(
  agentManager: ClaudeAgentManager,
  notifier: AgentNotifier,
  agentStore: AgentStore
): void {
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
  }
  // 저장은 best-effort 부수효과 — 실패해도 앱/세션을 멈추지 않는다(로깅만).
  const safe = (fn: () => void): void => {
    try { fn() } catch (err) { console.error('[agent-store]', err) }
  }

  agentManager.onEvent((sessionId, event) => {
    const payload: AgentEventPayload = { sessionId, event }
    broadcast('agent:event', payload)
    safe(() => agentStore.recordEvent(sessionId, event, new Date().toISOString()))
  })
  agentManager.onStatus((info: AgentSessionInfo) => {
    broadcast('agent:statusChange', info)
    notifier.onStatus(info)
    if (info.status === 'done' || info.status === 'crashed') {
      safe(() => agentStore.recordSessionEnd(info.sessionId, info.status, new Date().toISOString()))
    }
  })
  agentManager.onPermissionRequest((req: PermissionRequest) => {
    broadcast('agent:permissionRequest', req)
    notifier.onPermissionRequest(req)
  })

  ipcMain.handle('agents:start', (_e, input: AgentStartInput): AgentSessionInfo => {
    const info = agentManager.start(input)
    safe(() => agentStore.recordSessionStart(info.sessionId, input.projectId, new Date().toISOString()))
    return info
  })
  ipcMain.handle('agents:send', (_e, { sessionId, text }: { sessionId: string; text: string }): void =>
    agentManager.send(sessionId, text))
  ipcMain.handle('agents:respondPermission',
    (_e, a: { sessionId: string; requestId: string; decision: PermissionDecision }): void =>
      agentManager.respondPermission(a.sessionId, a.requestId, a.decision))
  ipcMain.handle('agents:interrupt', (_e, { sessionId }: { sessionId: string }): Promise<void> =>
    agentManager.interrupt(sessionId))
  ipcMain.handle('agents:stop', (_e, { sessionId }: { sessionId: string }): void =>
    agentManager.stop(sessionId))
  ipcMain.handle('agents:loadHistory', (): RestoredSession[] => agentStore.loadHistory())
}
```

- [ ] **Step 5: index.ts — agentStore 파라미터 전달 (electron/ipc/index.ts)**

파일 전체를 다음으로 교체:

```ts
import { registerProjectHandlers } from './projects'
import { registerSessionHandlers } from './sessions'
import { registerDialogHandlers } from './dialog'
import { registerAgentHandlers } from './agents'
import type { PtyManager } from '../pty/pty-manager'
import type { ClaudeAgentManager } from '../agent/agent-manager'
import type { AgentNotifier } from '../agent/notifier'
import type { AgentStore } from '../db/agent-store'

export function registerIpcHandlers(
  ptyManager: PtyManager,
  agentManager: ClaudeAgentManager,
  notifier: AgentNotifier,
  agentStore: AgentStore
): void {
  registerProjectHandlers()
  registerSessionHandlers(ptyManager)
  registerDialogHandlers()
  registerAgentHandlers(agentManager, notifier, agentStore)
}
```

- [ ] **Step 6: main.ts — AgentStore 생성·주입 (electron/main.ts)**

import 블록에 추가(기존 `./db` import을 확장):

```ts
import { initDatabase, closeDatabase, getDatabase } from './db'
import { AgentStore } from './db/agent-store'
```

`app.whenReady().then(...)` 안에서 `registerIpcHandlers` 호출을 교체:

```ts
app.whenReady().then(() => {
  initDatabase()
  const agentStore = new AgentStore(getDatabase())
  registerIpcHandlers(ptyManager, agentManager, notifier, agentStore)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
```

(`will-quit`는 변경 없음 — `agentManager.disposeAll()`이 각 세션 `stop()` → `onStatus('done')`을 동기 발화하고, `closeDatabase()`는 그 뒤에 호출되므로 종료 시 `recordSessionEnd`가 정상 기록된다.)

- [ ] **Step 7: 타입체크(양쪽) + 빌드**

Run: `pnpm typecheck`
Expected: 에러 없음

Run: `pnpm build`
Expected: 성공(main/preload/renderer 번들 생성)

- [ ] **Step 8: Commit**

```bash
git add shared/types.ts electron/preload.ts src/ipc-client.ts electron/ipc/agents.ts electron/ipc/index.ts electron/main.ts
git commit -m "feat(m4b): Main 저장 배선(start/event/end) + agents:loadHistory IPC"
```

---

## Task 5: agent-reducer에 live 필드 추가

**Files:**
- Modify: `src/stores/agent-reducer.ts`
- Modify: `src/stores/agent-reducer.test.ts` (없으면 생성)

**Interfaces:**
- Produces: `AgentState`에 `live: boolean` 추가. `initialAgentState().live === true`, `startSession(...).live === true`. 전이 함수(`appendEvent`/`appendUser`/`setStatus`/`addPending`/`removePending`)는 `...s`로 `live` 보존.

- [ ] **Step 1: 실패하는 테스트 작성/추가 (agent-reducer.test.ts)**

기존 테스트 파일이 있으면 아래 `describe`를 추가, 없으면 파일을 새로 만든다:

```ts
import { describe, it, expect } from 'vitest'
import { initialAgentState, startSession, appendEvent } from './agent-reducer'

describe('agent-reducer live 필드', () => {
  it('초기 상태와 새 세션은 live=true 다', () => {
    expect(initialAgentState().live).toBe(true)
    expect(startSession(initialAgentState(), 's1').live).toBe(true)
  })

  it('전이 함수는 live 값을 보존한다', () => {
    const restored = { ...startSession(initialAgentState(), 's1'), live: false }
    const next = appendEvent(restored, { type: 'message', role: 'assistant', text: 'x' })
    expect(next.live).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm vitest run src/stores/agent-reducer.test.ts`
Expected: FAIL — `Property 'live' does not exist` (타입) 또는 `expected undefined to be true`

- [ ] **Step 3: 구현 변경 (agent-reducer.ts)**

`AgentState` 인터페이스에 `live` 추가:

```ts
export interface AgentState {
  sessionId: string | null
  status: SessionStatus | null
  log: LogItem[]
  pending: PermissionRequest[]
  nextId: number
  /** 라이브 세션=true, 복원(읽기 전용) 세션=false. */
  live: boolean
}
```

`initialAgentState`와 `startSession`에 `live: true` 추가:

```ts
export function initialAgentState(): AgentState {
  return { sessionId: null, status: null, log: [], pending: [], nextId: 0, live: true }
}

export function startSession(_s: AgentState, sessionId: string): AgentState {
  return { sessionId, status: 'running', log: [], pending: [], nextId: 0, live: true }
}
```

(`appendEvent`/`appendUser`/`setStatus`/`addPending`/`removePending`는 `...s`로 복사하므로 변경 불필요.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/stores/agent-reducer.test.ts`
Expected: PASS

- [ ] **Step 5: 타입체크(web)**

Run: `pnpm typecheck:web`
Expected: 에러 없음

- [ ] **Step 6: Commit**

```bash
git add src/stores/agent-reducer.ts src/stores/agent-reducer.test.ts
git commit -m "feat(m4b): AgentState.live 필드 (라이브/읽기전용 구분)"
```

---

## Task 6: agent-restore (이벤트 재생 → 읽기 전용 상태)

**Files:**
- Create: `src/stores/agent-restore.ts`
- Create: `src/stores/agent-restore.test.ts`

**Interfaces:**
- Consumes: `RestoredSession`(`@shared/types`), `AgentState`/`initialAgentState`/`startSession`/`appendEvent`(`./agent-reducer`).
- Produces: `restoreAgentState(restored: RestoredSession): AgentState` — 이벤트를 순서대로 재생, `live=false`, `status=restored.status`, `sessionId=restored.sessionId`.

- [ ] **Step 1: 실패하는 테스트 작성 (agent-restore.test.ts)**

```ts
import { describe, it, expect } from 'vitest'
import { restoreAgentState } from './agent-restore'
import { initialAgentState, appendEvent } from './agent-reducer'
import { computeProjectProgress } from './project-progress'
import type { RestoredSession } from '@shared/types'

const restored: RestoredSession = {
  projectId: 'p1',
  sessionId: 's-uuid',
  status: 'crashed',
  events: [
    { type: 'message', role: 'assistant', text: '시작합니다' },
    { type: 'tool_use', name: 'TodoWrite', input: { todos: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' }
    ] } }
  ]
}

describe('agent-restore', () => {
  it('이벤트 재생 결과 log가 라이브로 흘렸을 때와 동일하다', () => {
    const live = appendEvent(appendEvent(initialAgentState(), restored.events[0]), restored.events[1])
    const out = restoreAgentState(restored)
    expect(out.log).toEqual(live.log)
  })

  it('복원 상태는 읽기 전용(live=false) + 저장된 status + sessionId 다', () => {
    const out = restoreAgentState(restored)
    expect(out.live).toBe(false)
    expect(out.status).toBe('crashed')
    expect(out.sessionId).toBe('s-uuid')
  })

  it('복원된 log에서 진척도가 올바로 산출된다', () => {
    const progress = computeProjectProgress(restoreAgentState(restored))
    expect(progress.percent).toBe(50)
    expect(progress.current).toBe('b')
    expect(progress.todoCounts).toEqual({ done: 1, total: 2 })
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm vitest run src/stores/agent-restore.test.ts`
Expected: FAIL — `Failed to resolve import "./agent-restore"`

- [ ] **Step 3: 구현 작성 (agent-restore.ts)**

```ts
// 복원: 저장된 events를 순서대로 재생해 읽기 전용 AgentState 재구성(순수).
// 검증된 agent-reducer 전이(startSession+appendEvent)를 재사용 → 라이브와 동일한 log 보장.
import type { RestoredSession } from '@shared/types'
import { type AgentState, initialAgentState, startSession, appendEvent } from './agent-reducer'

export function restoreAgentState(restored: RestoredSession): AgentState {
  let state = startSession(initialAgentState(), restored.sessionId)
  for (const event of restored.events) state = appendEvent(state, event)
  return { ...state, status: restored.status, live: false }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/stores/agent-restore.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 타입체크(web)**

Run: `pnpm typecheck:web`
Expected: 에러 없음

- [ ] **Step 6: Commit**

```bash
git add src/stores/agent-restore.ts src/stores/agent-restore.test.ts
git commit -m "feat(m4b): agent-restore 이벤트 재생 → 읽기전용 상태 (TDD)"
```

---

## Task 7: agent-multi — hydrateProject + resetForProject

**Files:**
- Modify: `src/stores/agent-multi.ts`
- Modify: `src/stores/agent-multi.test.ts` (없으면 생성)

**Interfaces:**
- Consumes: `restoreAgentState`(`./agent-restore`), `RestoredSession`(`@shared/types`), 기존 `initialAgentState`.
- Produces:
  - `hydrateProject(s: MultiAgentState, restored: RestoredSession): MultiAgentState` — `byProject[projectId]=복원본` + `sessionIndex[sessionId]=projectId`.
  - `resetForProject(s: MultiAgentState, projectId: string): MultiAgentState` — `byProject[projectId]=initialAgentState()`(라이브·빈), 이전 sessionId 인덱스 제거.

- [ ] **Step 1: 실패하는 테스트 작성/추가 (agent-multi.test.ts)**

기존 파일이 있으면 아래 `describe`를 추가, 없으면 새로 만든다:

```ts
import { describe, it, expect } from 'vitest'
import { initialMultiAgentState, hydrateProject, resetForProject, agentStateOf } from './agent-multi'
import type { RestoredSession } from '@shared/types'

const restored: RestoredSession = {
  projectId: 'p1',
  sessionId: 's-uuid',
  status: 'done',
  events: [{ type: 'message', role: 'assistant', text: 'hi' }]
}

describe('agent-multi 복원/리셋', () => {
  it('hydrateProject는 읽기 전용 복원본을 채우고 인덱스를 등록한다', () => {
    const s = hydrateProject(initialMultiAgentState(), restored)
    const st = agentStateOf(s, 'p1')
    expect(st.live).toBe(false)
    expect(st.status).toBe('done')
    expect(st.log).toHaveLength(1)
    expect(s.sessionIndex['s-uuid']).toBe('p1')
  })

  it('resetForProject는 라이브 빈 상태로 비우고 이전 sessionId 인덱스를 제거한다', () => {
    const hydrated = hydrateProject(initialMultiAgentState(), restored)
    const reset = resetForProject(hydrated, 'p1')
    const st = agentStateOf(reset, 'p1')
    expect(st.live).toBe(true)
    expect(st.sessionId).toBeNull()
    expect(st.log).toHaveLength(0)
    expect(reset.sessionIndex['s-uuid']).toBeUndefined()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm vitest run src/stores/agent-multi.test.ts`
Expected: FAIL — `hydrateProject is not a function` / import 오류

- [ ] **Step 3: 구현 추가 (agent-multi.ts)**

import 블록을 확장:

```ts
import type { AgentEvent, AgentSessionInfo, PermissionRequest, RestoredSession } from '@shared/types'
import {
  type AgentState, initialAgentState, startSession,
  appendEvent, appendUser, setStatus, addPending, removePending
} from './agent-reducer'
import { restoreAgentState } from './agent-restore'
```

파일 끝(`projectOfSession` 다음)에 두 함수 추가:

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/stores/agent-multi.test.ts`
Expected: PASS

- [ ] **Step 5: 타입체크(web)**

Run: `pnpm typecheck:web`
Expected: 에러 없음

- [ ] **Step 6: Commit**

```bash
git add src/stores/agent-multi.ts src/stores/agent-multi.test.ts
git commit -m "feat(m4b): agent-multi hydrateProject/resetForProject (TDD)"
```

---

## Task 8: 렌더러 배선 — loadHistory/reset 액션 + 앱 시작 시 복원

> 비-TDD(Zustand 스토어 + IPC 구독). 검증 게이트 = 타입체크. 동작은 Task 10 수동 스모크.

**Files:**
- Modify: `src/stores/agent.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `agentsApi.loadHistory`(Task 4), `hydrateProject`/`resetForProject`(Task 7).
- Produces: `AgentStore.loadHistory(): Promise<void>`, `AgentStore.reset(projectId: string): void`.

- [ ] **Step 1: agent.ts — import 확장**

`agent-multi`에서 두 함수를 추가로 import:

```ts
import {
  type MultiAgentState, initialMultiAgentState, agentStateOf,
  startForProject, appendUserForProject, removePendingForProject,
  routeEvent, routeStatus, routePermission, projectOfSession,
  hydrateProject, resetForProject
} from './agent-multi'
```

- [ ] **Step 2: agent.ts — 인터페이스에 액션 선언**

`AgentStore` 인터페이스의 `stop` 줄 다음에 추가:

```ts
  stop: (projectId: string) => Promise<void>
  loadHistory: () => Promise<void>
  reset: (projectId: string) => void
```

- [ ] **Step 3: agent.ts — 액션 구현**

`return { … }` 안, `stop:` 액션 다음에 추가(끝 콤마 주의):

```ts
    stop: async (projectId) => {
      const id = agentStateOf(get(), projectId).sessionId
      if (id) await agentsApi.stop(id)
    },
    loadHistory: async () => {
      const sessions = await agentsApi.loadHistory()
      set((s) => sessions.reduce((acc, r) => hydrateProject(acc, r), s))
    },
    reset: (projectId) => {
      set((s) => resetForProject(s, projectId))
    }
```

- [ ] **Step 4: App.tsx — 마운트 시 복원 1회**

`react`에서 `useEffect` import + `useAgentStore` import 추가:

```tsx
import { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Dashboard from './views/Dashboard'
import Workspace from './views/Workspace'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useAgentStore } from '@/stores/agent'
```

컴포넌트 본문 시작부에 effect 추가:

```tsx
export default function App(): React.JSX.Element {
  const openProjects = useWorkspacesStore((s) => s.openProjects)
  const activeProjectId = useWorkspacesStore((s) => s.activeProjectId)
  const activeProject = openProjects.find((p) => p.id === activeProjectId) ?? null

  // 앱 시작 1회: 프로젝트별 마지막 세션을 읽기 전용으로 복원.
  useEffect(() => {
    void useAgentStore.getState().loadHistory()
  }, [])
```

(이하 `return (…)`는 변경 없음.)

- [ ] **Step 5: 타입체크(web) + 빌드**

Run: `pnpm typecheck:web`
Expected: 에러 없음

Run: `pnpm build`
Expected: 성공

- [ ] **Step 6: Commit**

```bash
git add src/stores/agent.ts src/App.tsx
git commit -m "feat(m4b): 앱 시작 시 loadHistory 복원 + reset 액션"
```

---

## Task 9: AgentView 읽기 전용 UI

> 비-TDD(React 뷰). 검증 게이트 = 타입체크 + 빌드 + Task 10 수동 스모크.

**Files:**
- Modify: `src/views/AgentView.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `useAgentProject`의 `live`(Task 5), `reset` 액션(Task 8).

- [ ] **Step 1: AgentView.tsx — live 반영 + 읽기 전용 처리**

파일 전체를 다음으로 교체:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Project, SessionStatus } from '@shared/types'
import { useAgentStore, useAgentProject } from '@/stores/agent'
import AgentEventItem from '@/components/AgentEventItem'
import PermissionCard from '@/components/PermissionCard'

export default function AgentView({ project }: { project: Project }): React.JSX.Element {
  const { sessionId, status, log, pending, live } = useAgentProject(project.id)
  const focusTick = useAgentStore((s) => s.focusTick)
  const start = useAgentStore((s) => s.start)
  const send = useAgentStore((s) => s.send)
  const approve = useAgentStore((s) => s.approve)
  const deny = useAgentStore((s) => s.deny)
  const interrupt = useAgentStore((s) => s.interrupt)
  const stop = useAgentStore((s) => s.stop)
  const reset = useAgentStore((s) => s.reset)
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
    else void send(project.id, text)
  }

  return (
    <div className="agent">
      {!live && (
        <div className="agent__readonly">
          <span>지난 작업 · 읽기 전용</span>
          <button className="btn btn--primary" onClick={() => reset(project.id)}>▶ 새로 시작</button>
        </div>
      )}

      <div className="agent__bar">
        <span className={`badge badge--${status ?? 'none'}`}>{statusLabel(status)}</span>
        <span className="agent__spacer" />
        <button className="btn" onClick={() => void interrupt(project.id)} disabled={!live || status !== 'running'}>중단</button>
        <button className="btn btn--ghost-danger" onClick={() => void stop(project.id)} disabled={!live || !sessionId}>정지</button>
      </div>

      <div className="agent__log" ref={logRef}>
        {log.length === 0 && <div className="empty">아래에 지시를 입력해 에이전트를 시작하세요.</div>}
        {log.map((item) => <AgentEventItem key={item.id} item={item} />)}
        {live && pending.map((req) => (
          <PermissionCard key={req.requestId} req={req}
            onApprove={() => void approve(project.id, req.requestId)}
            onDeny={() => void deny(project.id, req.requestId, '사용자가 거부함')} />
        ))}
      </div>

      <div className="agent__input">
        <input className="input" value={draft}
          placeholder={live ? '에이전트에게 지시…' : '지난 작업(읽기 전용) — ▶ 새로 시작으로 이어가기'}
          disabled={!live}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        <button className="btn btn--primary" onClick={submit} disabled={!live}>{sessionId ? '전송' : '시작'}</button>
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

- [ ] **Step 2: styles.css — 읽기 전용 배너 스타일**

`.agent__bar { … }` 규칙 바로 앞(384행 부근)에 추가:

```css
.agent__readonly {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-surface);
  font-size: 12px;
  color: var(--text-muted);
}
```

(`--text-muted`가 styles.css에 정의돼 있지 않으면 `color: inherit;`로 대체한다.)

- [ ] **Step 3: 타입체크(web) + 빌드**

Run: `pnpm typecheck:web`
Expected: 에러 없음

Run: `pnpm build`
Expected: 성공

- [ ] **Step 4: 전체 테스트 회귀 확인**

Run: `pnpm test`
Expected: 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/AgentView.tsx src/styles.css
git commit -m "feat(m4b): AgentView 읽기 전용 UI(배너+입력 잠금) + 스타일"
```

---

## Task 10: 수동 스모크 (구현 후 검증)

> DB 적재·조회(`agent-store`)와 라이브 통합(실제 claude로 저장→재시작→복원)은 자동 테스트 불가 → 직접 실행으로 검증한다. `pnpm dev`로 앱을 띄우고 PowerShell PrintWindow로 창을 캡처해 확인.

- [ ] 에이전트로 할 일 목록(TodoWrite 포함) 작업 실행 → 앱 완전 종료 → 재시작 → 대시보드에 그 프로젝트의 진척도 막대·"지금 하는 중"이 복원되고 상태 점이 회색(done).
- [ ] 프로젝트 클릭 → AgentView에 지난 대화/이벤트가 읽기 전용으로 펼쳐지고, 상단 "지난 작업 · 읽기 전용" 배너 + 입력창/버튼 잠김.
- [ ] 배너의 **▶ 새로 시작** 클릭 → 로그 비워지고 라이브 전환(입력 가능). 지시 입력 → 정상 동작.
- [ ] 프로젝트 2개를 각각 작업 후 재시작 → 각자 마지막 세션이 독립 복원(서로 섞이지 않음).
- [ ] 작업 도중 앱을 강제 종료(작업관리자) → 재시작 → 그 세션이 **crashed(빨강)** 로 복원(미종료 강등 규칙).
- [ ] DB 확인(선택): `%APPDATA%/dev-console/dev-console.db`의 `events`/`sessions` 행이 쌓였는지 SQLite 뷰어로 확인.

- [ ] **스모크 통과 후 정리 커밋(필요 시):** 발견된 미세 수정 반영 후 `git commit -m "fix(m4b): 스모크 피드백 반영"`.

---

## 자가 점검(작성자 체크리스트 결과)

- **스펙 커버리지:** 설계 목표 ①저장(Task 2·4) ②복원(Task 6·7·8)·읽기 전용 표시(Task 5·9)·미종료 강등(Task 1 `resolveRestoredStatus` + Task 4 end 배선)·세션 UUID(Task 3)·진척도 자동 산출(Task 6 테스트) 모두 태스크에 매핑됨.
- **플레이스홀더:** 모든 코드 스텝에 실제 코드 포함, "적절히 처리" 류 없음.
- **타입 일관성:** `RestoredSession`(projectId/sessionId/status/events) · `AgentState.live` · `hydrateProject(s, restored)`/`resetForProject(s, projectId)` · `restoreAgentState(restored)` · `AgentStore` 4메서드 · `registerAgentHandlers(…, agentStore)` 시그니처가 생산-소비 태스크 간 일치.
