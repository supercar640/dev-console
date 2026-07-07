# M4a 멀티 세션 코어 구현 계획 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단일 세션(M2/M3)을 **여러 프로젝트 동시 세션**으로 확장한다. Main 매니저를 단일→다중(`Map<sessionId, Session>`)으로 바꾸고, 렌더러를 **프로젝트별 상태 + `sessionId→projectId` 라우팅**으로 재구성하며, 왼쪽 **사이드바(상태 점 + 열린 프로젝트)** 와 **2-pane 레이아웃**을 얹는다. 전환해도 세션은 Main에서 계속 산다.

**Architecture:** 위험한 복잡도(멀티 세션 상태 매핑)는 **순수 함수로 분리해 TDD**한다 — `agent-multi`/`session-multi`(sessionId→projectId 라우팅), `workspaces-reducer`(열기/닫기/활성), `project-status`(두 채널 → 한 점 집약 + 색). 검증된 단일 전이기 `agent-reducer`는 그대로 재사용한다. Zustand 스토어는 이 순수 함수를 감싸고, React 컴포넌트(얇은 뷰)는 타입체크 + 수동 스모크로 검증한다. Main 매니저는 명령형 `Map` 보유자가 된다.

**Tech Stack:** Electron Main(Node) · React 18 + TypeScript(strict) · Zustand · vitest(node, 가짜 주입·코로케이트 `*.test.ts`) · 기존 IPC 채널(변경 없음).

**설계 출처:** `plan/dev-console-m4a-design.md`. 결정: 멀티=여러 프로젝트 동시 / 왼쪽 사이드바 내비 / 상태 점 색 + 집약 우선순위(사람대기>실행>유휴>완료>충돌) / 수명 분리(절대원칙).

---

## 변경 불필요 파일 (왜 Main 작업이 매니저 2개뿐인가)

IPC 와이어 프로토콜은 M2/M3에서 이미 **전부 sessionId 인자 기반**이고 단일 세션 가정이 없다. 따라서 멀티 세션 전환에 다음은 **변경하지 않는다**:

- `electron/ipc/sessions.ts` · `electron/ipc/agents.ts` — 핸들러는 sessionId 인자로 매니저를 호출. 출력 라우팅(`attached` 집합 / 브로드캐스트)도 sessionId 기반.
- `electron/preload.ts` · `src/ipc-client.ts` · `shared/types.ts` — API 시그니처가 이미 `(sessionId, …)`.
- `electron/agent/notifier.ts` — `waiting` 집합·배지를 **이미 sessionId별로** 카운트(멀티 세션에서 그대로 옳음).
- `electron/main.ts` — 매니저 생성자 시그니처·`disposeAll()` 계약 불변.

즉 멀티 세션의 본질은 **매니저가 세션을 1개가 아니라 Map으로 들고**, **렌더러가 어떤 프로젝트의 세션인지 라우팅**하는 두 군데에만 있다.

---

## 파일 구조 (책임 경계)

### Main (`electron/`) — 단일 → 다중
- `pty/pty-manager.ts` *(수정)* — `session: Session | null` → `sessions: Map<string, Session>`. `start()`는 교체하지 않고 **추가**. send/resize/getScrollback/status/stop = Map 조회. disposeAll = 전체 순회.
- `agent/agent-manager.ts` *(수정)* — `session`+`currentId` → `sessions: Map<string, ClaudeAgentSession>`. 동일 패턴.

### 렌더러 순수 로직 (`src/stores/`) — TDD
- `workspaces-reducer.ts` *(생성)* — 열린 프로젝트 목록 + 활성 선택(open/close/setActive).
- `agent-multi.ts` *(생성)* — 프로젝트별 `AgentState` 보유 + `sessionId→projectId` 라우팅. 단일 `agent-reducer` 재사용.
- `session-multi.ts` *(생성)* — 터미널(PTY) 프로젝트별 상태 + 라우팅.
- `project-status.ts` *(생성)* — 두 채널 상태 → 한 점 집약 + 점 색 클래스.

### 렌더러 스토어 (`src/stores/`) — Zustand 배선
- `workspaces.ts` *(생성)* — `workspaces-reducer` 래핑.
- `agent.ts` *(수정·재작성)* — 단일 → `agent-multi` 래핑. focusSession → 소속 프로젝트로 점프.
- `session.ts` *(수정·재작성)* — 단일 → `session-multi` 래핑.

### 렌더러 컴포넌트/뷰 (`src/`)
- `components/StatusDot.tsx` *(생성)* — `SessionStatus | null` → 색 점.
- `components/Sidebar.tsx` *(생성)* — 브랜드 · 🏠 대시보드 · 열린 프로젝트(StatusDot+이름) · + 프로젝트.
- `App.tsx` *(수정)* — 2-pane: `<Sidebar/>` + 메인(활성 프로젝트 `<Workspace/>` 또는 `<Dashboard/>`).
- `views/Dashboard.tsx` *(수정)* — "열기" = `workspaces.open(project)`(탭 추가 + 활성).
- `views/Workspace.tsx` *(수정)* — `onBack` 제거(사이드바가 내비). 프로젝트별 채널 상태 구독.
- `views/Terminal.tsx` *(수정)* — `onBack`/`embedded` 제거. 프로젝트별 터미널 상태.
- `views/AgentView.tsx` *(수정)* — 프로젝트별 AgentState 투영. 액션에 projectId 전달.
- `styles.css` *(수정)* — 사이드바·상태 점·2-pane.

---

## Task 1: PtyManager 단일 → 다중 (Map)

**Files:**
- Modify: `electron/pty/pty-manager.ts`
- Test: `electron/pty/pty-manager.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (교체→추가로 변경 + 멀티 케이스)**

`electron/pty/pty-manager.test.ts`의 **마지막 테스트**(`'start 재호출 시 이전 세션을 정리(교체)한다'`, 기존 파일 113–122행)를 **삭제**하고, `describe` 블록 끝(닫는 `})` 직전)에 아래를 추가한다. 다른 기존 테스트는 그대로 둔다(단일 세션도 Map에서 동일하게 동작).

```typescript
  // --- M4a 멀티 세션 ---
  function multiManager(): { mgr: PtyManager; a: FakePty; b: FakePty } {
    const a = makeFakePty(1)
    const b = makeFakePty(2)
    let n = 0
    const sf = vi.fn(() => (n++ === 0 ? a : b) as never)
    return { mgr: new PtyManager(sf as SpawnFn), a, b }
  }

  it('start를 두 번 호출하면 두 세션이 모두 살아있다(교체하지 않음)', () => {
    const { mgr, a, b } = multiManager()
    const first = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    const second = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(a.killed).toBe(false)
    expect(b.killed).toBe(false)
    expect(mgr.status(first.sessionId)?.status).toBe('running')
    expect(mgr.status(second.sessionId)?.status).toBe('running')
  })

  it('send는 sessionId로 해당 세션에만 전달된다', () => {
    const { mgr, a, b } = multiManager()
    const first = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    const second = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    mgr.send(first.sessionId, 'A\r')
    mgr.send(second.sessionId, 'B\r')
    expect(a.written).toEqual(['A\r'])
    expect(b.written).toEqual(['B\r'])
  })

  it('한 세션 stop이 다른 세션에 영향을 주지 않는다', () => {
    const { mgr, a, b } = multiManager()
    const first = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    const second = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    mgr.stop(first.sessionId)
    expect(a.killed).toBe(true)
    expect(b.killed).toBe(false)
    expect(mgr.status(first.sessionId)).toBeNull()
    expect(mgr.status(second.sessionId)?.status).toBe('running')
  })

  it('getScrollback은 sessionId별로 독립적이다', () => {
    const { mgr, a, b } = multiManager()
    const first = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    const second = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    a._emitData(Buffer.from('AAA'))
    b._emitData(Buffer.from('BBB'))
    expect(mgr.getScrollback(first.sessionId).toString('utf-8')).toBe('AAA')
    expect(mgr.getScrollback(second.sessionId).toString('utf-8')).toBe('BBB')
  })

  it('disposeAll은 모든 세션을 정리한다', () => {
    const { mgr, a, b } = multiManager()
    const first = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    const second = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    mgr.disposeAll()
    expect(a.killed).toBe(true)
    expect(b.killed).toBe(true)
    expect(mgr.status(first.sessionId)).toBeNull()
    expect(mgr.status(second.sessionId)).toBeNull()
  })
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run electron/pty/pty-manager.test.ts`
Expected: 새 멀티 테스트들이 FAIL(현재 단일 세션이라 `start` 두 번 → 첫 세션 kill됨).

- [ ] **Step 3: 구현 — 단일 필드를 Map으로**

`electron/pty/pty-manager.ts`의 `PtyManager` 클래스를 아래로 교체(상단 import·상수·`resolveCommand`·`Session` 인터페이스는 그대로 유지):

```typescript
export class PtyManager {
  private sessions = new Map<string, Session>()
  private dataCb: ((sessionId: string, data: Buffer) => void) | null = null
  private statusCb: ((info: SessionInfo) => void) | null = null
  private seq = 0

  constructor(private readonly spawnFn: SpawnFn) {}

  onData(cb: (sessionId: string, data: Buffer) => void): void { this.dataCb = cb }
  onStatus(cb: (info: SessionInfo) => void): void { this.statusCb = cb }

  start(opts: StartOpts): SessionInfo {
    // M4a: 멀티 세션 — 교체하지 않고 Map에 추가한다.
    const id = `s${++this.seq}`
    const pty = this.spawnFn(resolveCommand(opts.command), opts.args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd,
      env: process.env,
      encoding: null
    })
    const info: SessionInfo = { sessionId: id, status: 'running', pid: pty.pid }
    const session: Session = { id, pty, buffer: new RingBuffer(MAX_SCROLLBACK_BYTES), info }
    this.sessions.set(id, session)

    pty.onData((data: string | Buffer) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8')
      session.buffer.append(buf)
      this.dataCb?.(id, buf)
    })
    pty.onExit(({ exitCode }: { exitCode: number }) => {
      session.info = { sessionId: id, status: 'exited', pid: pty.pid, exitCode }
      this.statusCb?.(session.info)
    })
    return info
  }

  send(sessionId: string, data: string): void {
    const s = this.sessions.get(sessionId)
    if (!s || s.info.status !== 'running') return
    if (data.length <= CHUNK_THRESHOLD) { s.pty.write(data); return }
    const parts = chunkInput(data, CHUNK_THRESHOLD)
    let i = 0
    const writeNext = (): void => {
      const cur = this.sessions.get(sessionId)
      if (!cur || cur.info.status !== 'running' || i >= parts.length) return
      cur.pty.write(parts[i++])
      if (i < parts.length) setTimeout(writeNext, CHUNK_DELAY_MS)
    }
    writeNext()
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.sessions.get(sessionId)
    if (!s || s.info.status !== 'running') return
    try { s.pty.resize(cols, rows) } catch { /* 일시적 resize 오류 무시 */ }
  }

  getScrollback(sessionId: string): Buffer {
    const s = this.sessions.get(sessionId)
    return s ? s.buffer.replay() : Buffer.alloc(0)
  }

  status(sessionId: string): SessionInfo | null {
    return this.sessions.get(sessionId)?.info ?? null
  }

  stop(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (!s) return
    try { if (s.info.status === 'running') s.pty.kill() } catch { /* 이미 죽음 */ }
    this.sessions.delete(sessionId)
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.stop(id)
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run electron/pty/pty-manager.test.ts`
Expected: PASS (기존 단일 테스트 + 신규 멀티 5개).

- [ ] **Step 5: Commit**

```bash
git add electron/pty/pty-manager.ts electron/pty/pty-manager.test.ts
git commit -m "feat(m4a): PtyManager single -> multi-session Map"
```

---

## Task 2: ClaudeAgentManager 단일 → 다중 (Map)

**Files:**
- Modify: `electron/agent/agent-manager.ts`
- Test: `electron/agent/agent-manager.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (교체→추가 + 라우팅)**

`electron/agent/agent-manager.test.ts`의 **`'start 재호출 시 이전 세션을 정리(교체)한다'`** 테스트(기존 31–37행)를 **삭제**하고, 그 자리에 아래 3개를 넣는다. 나머지 두 테스트는 유지.

```typescript
  it('start를 두 번 호출하면 두 세션이 모두 살아있다(교체하지 않음)', () => {
    const mgr = new ClaudeAgentManager(() => fakeQuery)
    const first = mgr.start({ projectId: 'p1', cwd: 'C:\\' })
    const second = mgr.start({ projectId: 'p2', cwd: 'C:\\' })
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(mgr.status(first.sessionId)?.sessionId).toBe(first.sessionId)
    expect(mgr.status(second.sessionId)?.sessionId).toBe(second.sessionId)
  })

  it('한 세션 stop이 다른 세션에 영향을 주지 않는다', () => {
    const mgr = new ClaudeAgentManager(() => fakeQuery)
    const first = mgr.start({ projectId: 'p1', cwd: 'C:\\' })
    const second = mgr.start({ projectId: 'p2', cwd: 'C:\\' })
    mgr.stop(first.sessionId)
    expect(mgr.status(first.sessionId)).toBeNull()
    expect(mgr.status(second.sessionId)).not.toBeNull()
  })

  it('이벤트는 시작한 각 세션의 sessionId로 라우팅된다', async () => {
    const mgr = new ClaudeAgentManager(() => fakeQuery)
    const seen: string[] = []
    mgr.onEvent((sid, e) => { if (e.type === 'message') seen.push(sid) })
    const first = mgr.start({ projectId: 'p1', cwd: 'C:\\' })
    const second = mgr.start({ projectId: 'p2', cwd: 'C:\\' })
    await flush(); await flush()
    expect(seen).toContain(first.sessionId)
    expect(seen).toContain(second.sessionId)
  })
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run electron/agent/agent-manager.test.ts`
Expected: 새 테스트 FAIL(현재 두 번째 start가 첫 세션을 stop → `status(first)`가 null).

- [ ] **Step 3: 구현 — 단일 필드를 Map으로**

`electron/agent/agent-manager.ts`의 클래스를 아래로 교체(상단 주석·import 유지):

```typescript
export class ClaudeAgentManager {
  private sessions = new Map<string, ClaudeAgentSession>()
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
    // M4a: 멀티 세션 — 교체하지 않고 Map에 추가한다.
    const id = `a${++this.seq}`
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
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run electron/agent/agent-manager.test.ts`
Expected: PASS (기존 2개 + 신규 3개).

- [ ] **Step 5: Commit**

```bash
git add electron/agent/agent-manager.ts electron/agent/agent-manager.test.ts
git commit -m "feat(m4a): ClaudeAgentManager single -> multi-session Map"
```

---

## Task 3: workspaces-reducer (순수 TDD)

열린 프로젝트 목록 + 활성 선택. 닫기는 사이드바에서만 제거(세션은 Main에서 계속 — 절대원칙).

**Files:**
- Create: `src/stores/workspaces-reducer.ts`
- Test: `src/stores/workspaces-reducer.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/stores/workspaces-reducer.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import {
  initialWorkspacesState, openProject, closeProject, setActiveProject
} from './workspaces-reducer'
import type { Project } from '@shared/types'

const mk = (id: string): Project => ({
  id, name: id, workspacePath: `C:\\${id}`, createdAt: '', defaultModel: null, defaultEffort: null
})

describe('workspaces-reducer', () => {
  it('openProject는 추가하고 중복은 무시하며 활성은 바꾸지 않는다', () => {
    let s = initialWorkspacesState()
    s = openProject(s, mk('a'))
    s = openProject(s, mk('a'))
    s = openProject(s, mk('b'))
    expect(s.openProjects.map((p) => p.id)).toEqual(['a', 'b'])
    expect(s.activeProjectId).toBeNull()
  })

  it('setActiveProject는 열린 프로젝트만 활성화하고 미열림 id는 무시한다', () => {
    let s = openProject(initialWorkspacesState(), mk('a'))
    s = setActiveProject(s, 'a')
    expect(s.activeProjectId).toBe('a')
    s = setActiveProject(s, 'ghost')
    expect(s.activeProjectId).toBe('a')
    s = setActiveProject(s, null)
    expect(s.activeProjectId).toBeNull()
  })

  it('closeProject는 목록에서 제거하고, 활성이 닫히면 활성을 해제한다', () => {
    let s = openProject(openProject(initialWorkspacesState(), mk('a')), mk('b'))
    s = setActiveProject(s, 'b')
    s = closeProject(s, 'b')
    expect(s.openProjects.map((p) => p.id)).toEqual(['a'])
    expect(s.activeProjectId).toBeNull()
  })

  it('비활성 프로젝트를 닫아도 활성은 유지된다', () => {
    let s = openProject(openProject(initialWorkspacesState(), mk('a')), mk('b'))
    s = setActiveProject(s, 'a')
    s = closeProject(s, 'b')
    expect(s.activeProjectId).toBe('a')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/stores/workspaces-reducer.test.ts`
Expected: FAIL ("Cannot find module './workspaces-reducer'").

- [ ] **Step 3: 구현**

`src/stores/workspaces-reducer.ts`:
```typescript
// 열린 프로젝트 목록 + 활성 선택. 순수 전이 → node vitest.
// 닫기 = 사이드바에서만 제거(세션은 Main에서 계속 — 절대원칙 #2).
import type { Project } from '@shared/types'

export interface WorkspacesState {
  openProjects: Project[]
  activeProjectId: string | null
}

export function initialWorkspacesState(): WorkspacesState {
  return { openProjects: [], activeProjectId: null }
}

/** 사이드바에 추가(이미 있으면 그대로). 활성 선택은 바꾸지 않는다. */
export function openProject(s: WorkspacesState, project: Project): WorkspacesState {
  if (s.openProjects.some((p) => p.id === project.id)) return s
  return { ...s, openProjects: [...s.openProjects, project] }
}

/** 사이드바에서 제거. 활성이 닫히면 활성=null. */
export function closeProject(s: WorkspacesState, projectId: string): WorkspacesState {
  return {
    openProjects: s.openProjects.filter((p) => p.id !== projectId),
    activeProjectId: s.activeProjectId === projectId ? null : s.activeProjectId
  }
}

/** 활성 전환. null=대시보드. 열려있지 않은 id는 무시(불변식: active는 null 또는 열린 프로젝트). */
export function setActiveProject(s: WorkspacesState, projectId: string | null): WorkspacesState {
  if (projectId === null) return { ...s, activeProjectId: null }
  if (!s.openProjects.some((p) => p.id === projectId)) return s
  return { ...s, activeProjectId: projectId }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/stores/workspaces-reducer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/workspaces-reducer.ts src/stores/workspaces-reducer.test.ts
git commit -m "feat(m4a): workspaces reducer (open/close/setActive, pure)"
```

---

## Task 4: agent-multi 라우터 (순수 TDD — 이 작업의 핵심 복잡도)

프로젝트별 `AgentState`를 보유하고, 들어오는 이벤트(sessionId)를 `sessionId→projectId` 인덱스로 소속 프로젝트에 라우팅한다. 단일 전이는 검증된 `agent-reducer`를 재사용.

**Files:**
- Create: `src/stores/agent-multi.ts`
- Test: `src/stores/agent-multi.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/stores/agent-multi.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import {
  initialMultiAgentState, agentStateOf, startForProject, appendUserForProject,
  removePendingForProject, routeEvent, routeStatus, routePermission, projectOfSession
} from './agent-multi'
import type { PermissionRequest } from '@shared/types'

const perm = (requestId: string, sessionId: string): PermissionRequest =>
  ({ requestId, sessionId, toolName: 'Write', input: {}, kind: 'tool' })

describe('agent-multi', () => {
  it('startForProject는 프로젝트별 상태(running)와 인덱스를 만든다', () => {
    let s = startForProject(initialMultiAgentState(), 'p1', 'a1')
    s = startForProject(s, 'p2', 'a2')
    expect(agentStateOf(s, 'p1').sessionId).toBe('a1')
    expect(agentStateOf(s, 'p1').status).toBe('running')
    expect(agentStateOf(s, 'p2').sessionId).toBe('a2')
    expect(projectOfSession(s, 'a1')).toBe('p1')
    expect(projectOfSession(s, 'a2')).toBe('p2')
  })

  it('routeEvent는 sessionId로 올바른 프로젝트에만 적재한다', () => {
    let s = startForProject(startForProject(initialMultiAgentState(), 'p1', 'a1'), 'p2', 'a2')
    s = routeEvent(s, 'a1', { type: 'message', role: 'assistant', text: '하이' })
    expect(agentStateOf(s, 'p1').log).toHaveLength(1)
    expect(agentStateOf(s, 'p2').log).toHaveLength(0)
  })

  it('routeEvent는 미지의 sessionId를 무시한다(동일 참조 반환)', () => {
    const s0 = startForProject(initialMultiAgentState(), 'p1', 'a1')
    const s1 = routeEvent(s0, 'ghost', { type: 'message', role: 'assistant', text: 'x' })
    expect(s1).toBe(s0)
  })

  it('routeStatus는 소속 프로젝트 상태만 바꾼다', () => {
    let s = startForProject(startForProject(initialMultiAgentState(), 'p1', 'a1'), 'p2', 'a2')
    s = routeStatus(s, { sessionId: 'a2', status: 'waiting_user' })
    expect(agentStateOf(s, 'p1').status).toBe('running')
    expect(agentStateOf(s, 'p2').status).toBe('waiting_user')
  })

  it('routePermission은 소속 프로젝트 pending에 추가, removePendingForProject로 제거', () => {
    let s = startForProject(initialMultiAgentState(), 'p1', 'a1')
    s = routePermission(s, perm('r1', 'a1'))
    expect(agentStateOf(s, 'p1').pending.map((p) => p.requestId)).toEqual(['r1'])
    s = removePendingForProject(s, 'p1', 'r1')
    expect(agentStateOf(s, 'p1').pending).toHaveLength(0)
  })

  it('appendUserForProject는 해당 프로젝트 로그에 사용자 입력을 넣는다', () => {
    let s = startForProject(initialMultiAgentState(), 'p1', 'a1')
    s = appendUserForProject(s, 'p1', '안녕')
    expect(agentStateOf(s, 'p1').log).toEqual([{ id: 0, kind: 'user', text: '안녕' }])
  })

  it('startForProject 재호출 시 이전 sessionId 인덱스를 제거(스테일 이벤트 무시)', () => {
    let s = startForProject(initialMultiAgentState(), 'p1', 'a1')
    s = startForProject(s, 'p1', 'a1b')
    expect(projectOfSession(s, 'a1')).toBeNull()
    expect(projectOfSession(s, 'a1b')).toBe('p1')
    const before = s
    expect(routeEvent(s, 'a1', { type: 'message', role: 'assistant', text: 'stale' })).toBe(before)
  })

  it('agentStateOf는 미지 프로젝트에 초기 상태를 돌려준다', () => {
    expect(agentStateOf(initialMultiAgentState(), 'none')).toMatchObject({ sessionId: null, status: null, log: [] })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/stores/agent-multi.test.ts`
Expected: FAIL ("Cannot find module './agent-multi'").

- [ ] **Step 3: 구현**

`src/stores/agent-multi.ts`:
```typescript
// 멀티 프로젝트 Agent 상태 라우팅(순수). 프로젝트별 AgentState를 보유하고,
// 들어오는 이벤트(sessionId)를 sessionId→projectId 인덱스로 소속 프로젝트에 라우팅한다.
// 단일 프로젝트 전이는 검증된 agent-reducer를 그대로 재사용.
import type { AgentEvent, AgentSessionInfo, PermissionRequest } from '@shared/types'
import {
  type AgentState, initialAgentState, startSession,
  appendEvent, appendUser, setStatus, addPending, removePending
} from './agent-reducer'

export interface MultiAgentState {
  byProject: Record<string, AgentState>
  sessionIndex: Record<string, string> // sessionId → projectId
}

export function initialMultiAgentState(): MultiAgentState {
  return { byProject: {}, sessionIndex: {} }
}

/** 프로젝트의 현재 상태(없으면 초기값). 뷰가 활성 프로젝트를 투영할 때 사용. */
export function agentStateOf(s: MultiAgentState, projectId: string): AgentState {
  return s.byProject[projectId] ?? initialAgentState()
}

/** projectId 상태를 새 값으로 치환한 불변 사본. */
function withProject(s: MultiAgentState, projectId: string, next: AgentState): MultiAgentState {
  return { ...s, byProject: { ...s.byProject, [projectId]: next } }
}

/** 세션 시작: 프로젝트 상태를 running으로 리셋 + 인덱스 등록(이전 세션 인덱스는 제거). */
export function startForProject(s: MultiAgentState, projectId: string, sessionId: string): MultiAgentState {
  const prev = s.byProject[projectId]
  const sessionIndex = { ...s.sessionIndex }
  if (prev?.sessionId) delete sessionIndex[prev.sessionId]
  sessionIndex[sessionId] = projectId
  return {
    byProject: { ...s.byProject, [projectId]: startSession(initialAgentState(), sessionId) },
    sessionIndex
  }
}

/** 활성 프로젝트의 사용자 입력 1줄 로그. */
export function appendUserForProject(s: MultiAgentState, projectId: string, text: string): MultiAgentState {
  return withProject(s, projectId, appendUser(agentStateOf(s, projectId), text))
}

/** 권한 응답 후 카드 제거(낙관적). */
export function removePendingForProject(s: MultiAgentState, projectId: string, requestId: string): MultiAgentState {
  return withProject(s, projectId, removePending(agentStateOf(s, projectId), requestId))
}

/** 이벤트 라우팅: sessionId→projectId. 미지의 sessionId면 무시(no-op). */
export function routeEvent(s: MultiAgentState, sessionId: string, event: AgentEvent): MultiAgentState {
  const pid = s.sessionIndex[sessionId]
  if (pid === undefined) return s
  return withProject(s, pid, appendEvent(agentStateOf(s, pid), event))
}

export function routeStatus(s: MultiAgentState, info: AgentSessionInfo): MultiAgentState {
  const pid = s.sessionIndex[info.sessionId]
  if (pid === undefined) return s
  return withProject(s, pid, setStatus(agentStateOf(s, pid), info))
}

export function routePermission(s: MultiAgentState, req: PermissionRequest): MultiAgentState {
  const pid = s.sessionIndex[req.sessionId]
  if (pid === undefined) return s
  return withProject(s, pid, addPending(agentStateOf(s, pid), req))
}

/** sessionId의 소속 projectId(없으면 null). focusSession 점프에 사용. */
export function projectOfSession(s: MultiAgentState, sessionId: string): string | null {
  return s.sessionIndex[sessionId] ?? null
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/stores/agent-multi.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/agent-multi.ts src/stores/agent-multi.test.ts
git commit -m "feat(m4a): agent-multi router (sessionId->projectId, reuse agent-reducer)"
```

---

## Task 5: session-multi 라우터 (순수 TDD)

터미널(PTY)도 프로젝트별 상태(`sessionId`/`status`/`command`) + 라우팅. command는 프로젝트별로 보관(터미널이 이제 프로젝트마다 따로다).

**Files:**
- Create: `src/stores/session-multi.ts`
- Test: `src/stores/session-multi.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/stores/session-multi.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import {
  initialMultiTerminalState, terminalStateOf, setCommandForProject,
  startTerminalForProject, stopTerminalForProject, routeTerminalStatus
} from './session-multi'

describe('session-multi', () => {
  it('startTerminalForProject는 프로젝트별 세션을 running으로 등록한다', () => {
    let s = startTerminalForProject(initialMultiTerminalState(), 'p1', 's1')
    s = startTerminalForProject(s, 'p2', 's2')
    expect(terminalStateOf(s, 'p1')).toMatchObject({ sessionId: 's1', status: 'running' })
    expect(terminalStateOf(s, 'p2')).toMatchObject({ sessionId: 's2', status: 'running' })
  })

  it('routeTerminalStatus는 소속 프로젝트 상태만 바꾼다(exited)', () => {
    let s = startTerminalForProject(startTerminalForProject(initialMultiTerminalState(), 'p1', 's1'), 'p2', 's2')
    s = routeTerminalStatus(s, { sessionId: 's1', status: 'exited', pid: 1, exitCode: 0 })
    expect(terminalStateOf(s, 'p1').status).toBe('exited')
    expect(terminalStateOf(s, 'p2').status).toBe('running')
  })

  it('routeTerminalStatus는 미지의 sessionId를 무시한다(동일 참조)', () => {
    const s0 = startTerminalForProject(initialMultiTerminalState(), 'p1', 's1')
    const s1 = routeTerminalStatus(s0, { sessionId: 'ghost', status: 'exited', pid: 9 })
    expect(s1).toBe(s0)
  })

  it('setCommandForProject는 프로젝트별 명령을 보관(기본 powershell)', () => {
    let s = initialMultiTerminalState()
    expect(terminalStateOf(s, 'p1').command).toBe('powershell')
    s = setCommandForProject(s, 'p1', 'claude')
    expect(terminalStateOf(s, 'p1').command).toBe('claude')
    expect(terminalStateOf(s, 'p2').command).toBe('powershell')
  })

  it('stopTerminalForProject는 세션을 비우되 command는 유지한다', () => {
    let s = startTerminalForProject(initialMultiTerminalState(), 'p1', 's1')
    s = setCommandForProject(s, 'p1', 'claude')
    s = stopTerminalForProject(s, 'p1')
    expect(terminalStateOf(s, 'p1')).toMatchObject({ sessionId: null, status: null, command: 'claude' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/stores/session-multi.test.ts`
Expected: FAIL ("Cannot find module './session-multi'").

- [ ] **Step 3: 구현**

`src/stores/session-multi.ts`:
```typescript
// 멀티 프로젝트 터미널(PTY) 상태 라우팅(순수). 프로젝트별 sessionId/status/command.
import type { SessionInfo } from '@shared/types'

export type TerminalStatus = SessionInfo['status'] // 'running' | 'exited'

export interface TerminalState {
  sessionId: string | null
  status: TerminalStatus | null
  command: string
}

export interface MultiTerminalState {
  byProject: Record<string, TerminalState>
  sessionIndex: Record<string, string> // sessionId → projectId
}

const DEFAULT_COMMAND = 'powershell'

export function initialMultiTerminalState(): MultiTerminalState {
  return { byProject: {}, sessionIndex: {} }
}

export function terminalStateOf(s: MultiTerminalState, projectId: string): TerminalState {
  return s.byProject[projectId] ?? { sessionId: null, status: null, command: DEFAULT_COMMAND }
}

function withProject(s: MultiTerminalState, projectId: string, next: TerminalState): MultiTerminalState {
  return { ...s, byProject: { ...s.byProject, [projectId]: next } }
}

export function setCommandForProject(s: MultiTerminalState, projectId: string, command: string): MultiTerminalState {
  return withProject(s, projectId, { ...terminalStateOf(s, projectId), command })
}

/** 세션 시작 등록: running + 인덱스(이전 세션 인덱스 제거). command는 유지. */
export function startTerminalForProject(s: MultiTerminalState, projectId: string, sessionId: string): MultiTerminalState {
  const prev = s.byProject[projectId]
  const sessionIndex = { ...s.sessionIndex }
  if (prev?.sessionId) delete sessionIndex[prev.sessionId]
  sessionIndex[sessionId] = projectId
  const command = prev?.command ?? DEFAULT_COMMAND
  return {
    byProject: { ...s.byProject, [projectId]: { sessionId, status: 'running', command } },
    sessionIndex
  }
}

/** 명시적 정지(렌더러): 세션/상태 비움, command 유지, 인덱스 제거. */
export function stopTerminalForProject(s: MultiTerminalState, projectId: string): MultiTerminalState {
  const prev = terminalStateOf(s, projectId)
  const sessionIndex = { ...s.sessionIndex }
  if (prev.sessionId) delete sessionIndex[prev.sessionId]
  return {
    byProject: { ...s.byProject, [projectId]: { sessionId: null, status: null, command: prev.command } },
    sessionIndex
  }
}

/** Main 상태 변경(예: PTY 종료) 라우팅: sessionId→projectId. */
export function routeTerminalStatus(s: MultiTerminalState, info: SessionInfo): MultiTerminalState {
  const pid = s.sessionIndex[info.sessionId]
  if (pid === undefined) return s
  const cur = terminalStateOf(s, pid)
  if (cur.sessionId !== info.sessionId) return s
  return withProject(s, pid, { ...cur, status: info.status })
}

/** sessionId의 소속 projectId(없으면 null). */
export function projectOfTerminalSession(s: MultiTerminalState, sessionId: string): string | null {
  return s.sessionIndex[sessionId] ?? null
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/stores/session-multi.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/session-multi.ts src/stores/session-multi.test.ts
git commit -m "feat(m4a): session-multi router (per-project terminal state)"
```

---

## Task 6: project-status — 집약 + 색 (순수 TDD)

두 채널(agent·terminal) 상태를 한 점으로 집약하고 점 색 클래스를 매핑. 우선순위(주의 필요 순): **사람대기 > 실행 > 유휴 > 완료 > 충돌** (설계 §3·§주의).

**Files:**
- Create: `src/stores/project-status.ts`
- Test: `src/stores/project-status.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/stores/project-status.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { aggregateProjectStatus, statusDotClass } from './project-status'

describe('aggregateProjectStatus', () => {
  it('둘 다 없으면 null', () => {
    expect(aggregateProjectStatus(null, null)).toBeNull()
  })
  it('사람대기가 실행보다 우선', () => {
    expect(aggregateProjectStatus('waiting_user', 'running')).toBe('waiting_user')
  })
  it('에이전트 유휴 + 터미널 실행 → running', () => {
    expect(aggregateProjectStatus('idle', 'running')).toBe('running')
  })
  it('터미널 exited는 done으로 정규화', () => {
    expect(aggregateProjectStatus(null, 'exited')).toBe('done')
  })
  it('충돌은 가장 낮은 우선순위: 에이전트 충돌 + 터미널 실행 → running', () => {
    expect(aggregateProjectStatus('crashed', 'running')).toBe('running')
  })
  it('에이전트만 충돌(터미널 없음) → crashed', () => {
    expect(aggregateProjectStatus('crashed', null)).toBe('crashed')
  })
})

describe('statusDotClass', () => {
  it('상태별 색 클래스 suffix', () => {
    expect(statusDotClass('waiting_user')).toBe('waiting')
    expect(statusDotClass('running')).toBe('running')
    expect(statusDotClass('idle')).toBe('idle')
    expect(statusDotClass('done')).toBe('done')
    expect(statusDotClass('crashed')).toBe('crashed')
    expect(statusDotClass(null)).toBe('none')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/stores/project-status.test.ts`
Expected: FAIL ("Cannot find module './project-status'").

- [ ] **Step 3: 구현**

`src/stores/project-status.ts`:
```typescript
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
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/stores/project-status.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/project-status.ts src/stores/project-status.test.ts
git commit -m "feat(m4a): project-status aggregation + dot color (pure)"
```

---

## ⚠️ Phase 3 (Task 7–11) — 렌더러 컷오버 주의

Task 7–11은 기존 단일 세션 스토어/뷰를 멀티로 **한꺼번에 갈아끼우는 컷오버**다. 스토어를 멀티로 바꾸면 아직 안 고친 consumer(뷰)가 타입에러를 낸다. 따라서:

- **순수 로직(Task 1–6)** 은 이미 단위 테스트로 그린 — 위험은 거기서 잡았다.
- **전체 타입체크(`pnpm run typecheck`)는 Task 11 끝에서 한 번 그린**으로 만든다. Task 7만 단독 그린(additive), Task 8–10은 파일 작성까지만 하고 중간 타입체크 실패는 정상이다.
- **커밋:** Task 7은 단독 커밋(그린). Task 8–11은 컷오버라 **Task 11 끝에서 한 번에 커밋**한다(중간에 깨진 타입체크 상태를 커밋하지 않기 위해).

---

## Task 7: workspaces 스토어 (Zustand, additive — 단독 그린)

**Files:**
- Create: `src/stores/workspaces.ts`

- [ ] **Step 1: 구현**

`src/stores/workspaces.ts`:
```typescript
import { create } from 'zustand'
import type { Project } from '@shared/types'
import {
  type WorkspacesState, initialWorkspacesState,
  openProject, closeProject, setActiveProject
} from './workspaces-reducer'

interface WorkspacesStore extends WorkspacesState {
  open: (project: Project) => void
  close: (projectId: string) => void
  setActive: (projectId: string | null) => void
}

// 주: Zustand set 은 얕은 병합 — reducer가 데이터만 돌려줘도 액션은 보존된다.
export const useWorkspacesStore = create<WorkspacesStore>((set) => ({
  ...initialWorkspacesState(),
  open: (project) => set((s) => setActiveProject(openProject(s, project), project.id)),
  close: (projectId) => set((s) => closeProject(s, projectId)),
  setActive: (projectId) => set((s) => setActiveProject(s, projectId))
}))
```

- [ ] **Step 2: 타입체크**

Run: `pnpm run typecheck:web`
Expected: PASS (additive — 아직 아무도 import하지 않음).

- [ ] **Step 3: Commit**

```bash
git add src/stores/workspaces.ts
git commit -m "feat(m4a): workspaces Zustand store"
```

---

## Task 8: agent 스토어 재작성 (멀티 + focusSession 점프)

**Files:**
- Modify: `src/stores/agent.ts` (전체 교체)

- [ ] **Step 1: 구현 — 멀티 스토어 + 프로젝트 선택 훅**

`src/stores/agent.ts` 전체를 교체:
```typescript
import { create } from 'zustand'
import { agentsApi } from '@/ipc-client'
import { useWorkspacesStore } from './workspaces'
import {
  type MultiAgentState, initialMultiAgentState, agentStateOf,
  startForProject, appendUserForProject, removePendingForProject,
  routeEvent, routeStatus, routePermission, projectOfSession
} from './agent-multi'
import { type AgentState, type LogItem, initialAgentState } from './agent-reducer'

interface AgentStore extends MultiAgentState {
  focusTick: number // focusSession 수신 시 증가 → 뷰가 반응(스크롤)
  start: (projectId: string, cwd: string, firstMessage?: string) => Promise<void>
  send: (projectId: string, text: string) => Promise<void>
  approve: (projectId: string, requestId: string) => Promise<void>
  deny: (projectId: string, requestId: string, message?: string) => Promise<void>
  interrupt: (projectId: string) => Promise<void>
  stop: (projectId: string) => Promise<void>
}

export const useAgentStore = create<AgentStore>((set, get) => {
  // 1회 구독: Main 이벤트를 sessionId→projectId 로 라우팅.
  agentsApi.onEvent(({ sessionId, event }) => set((s) => routeEvent(s, sessionId, event)))
  agentsApi.onStatusChange((info) => set((s) => routeStatus(s, info)))
  agentsApi.onPermissionRequest((req) => set((s) => routePermission(s, req)))
  agentsApi.onFocusSession((sessionId) => {
    const pid = projectOfSession(get(), sessionId)
    if (pid) useWorkspacesStore.getState().setActive(pid) // 알림 클릭 → 소속 프로젝트로 점프
    set((s) => ({ focusTick: s.focusTick + 1 }))
  })

  return {
    ...initialMultiAgentState(),
    focusTick: 0,
    start: async (projectId, cwd, firstMessage) => {
      const info = await agentsApi.start({ projectId, cwd, firstMessage })
      set((s) => startForProject(s, projectId, info.sessionId))
    },
    send: async (projectId, text) => {
      const id = agentStateOf(get(), projectId).sessionId
      if (!id) return
      set((s) => appendUserForProject(s, projectId, text))
      await agentsApi.send(id, text)
    },
    approve: async (projectId, requestId) => {
      const id = agentStateOf(get(), projectId).sessionId
      if (!id) return
      set((s) => removePendingForProject(s, projectId, requestId))
      await agentsApi.respondPermission(id, requestId, { behavior: 'allow' })
    },
    deny: async (projectId, requestId, message) => {
      const id = agentStateOf(get(), projectId).sessionId
      if (!id) return
      set((s) => removePendingForProject(s, projectId, requestId))
      await agentsApi.respondPermission(id, requestId, { behavior: 'deny', message })
    },
    interrupt: async (projectId) => {
      const id = agentStateOf(get(), projectId).sessionId
      if (id) await agentsApi.interrupt(id)
    },
    stop: async (projectId) => {
      const id = agentStateOf(get(), projectId).sessionId
      if (id) await agentsApi.stop(id)
    }
  }
})

// 프로젝트별 슬라이스 선택 훅. 셀렉터는 안정 참조(undefined)를 반환하고,
// 없을 때만 모듈 상수로 대체 → 무한 리렌더(매번 새 객체) 방지.
const EMPTY_AGENT_STATE: AgentState = initialAgentState()
export function useAgentProject(projectId: string): AgentState {
  return useAgentStore((s) => s.byProject[projectId]) ?? EMPTY_AGENT_STATE
}

export type { LogItem }
```

- [ ] **Step 2: 파일 저장까지만 (타입체크는 Task 11에서)**

이 시점에 `AgentView.tsx`(아직 단일 스토어 가정)가 깨진다 — 정상. Task 11에서 일괄 그린.

---

## Task 9: session(터미널) 스토어 재작성 (멀티)

**Files:**
- Modify: `src/stores/session.ts` (전체 교체)

- [ ] **Step 1: 구현 — 멀티 스토어 + 프로젝트 선택 훅**

`src/stores/session.ts` 전체를 교체:
```typescript
import { create } from 'zustand'
import { sessionsApi } from '@/ipc-client'
import {
  type MultiTerminalState, type TerminalState, initialMultiTerminalState, terminalStateOf,
  setCommandForProject, startTerminalForProject, stopTerminalForProject, routeTerminalStatus
} from './session-multi'

interface SessionStore extends MultiTerminalState {
  setCommand: (projectId: string, command: string) => void
  start: (projectId: string, cwd: string) => Promise<void>
  stop: (projectId: string) => Promise<void>
}

export const useSessionStore = create<SessionStore>((set, get) => {
  // 1회: Main 상태 변경(PTY 종료 등)을 소속 프로젝트로 라우팅.
  sessionsApi.onStatusChange((info) => set((s) => routeTerminalStatus(s, info)))
  return {
    ...initialMultiTerminalState(),
    setCommand: (projectId, command) => set((s) => setCommandForProject(s, projectId, command)),
    start: async (projectId, cwd) => {
      // 같은 프로젝트에 살아있는 세션이 있으면 먼저 정지(재시작 — Main은 추가만 하므로 누수 방지).
      const prev = terminalStateOf(get(), projectId)
      if (prev.sessionId) await sessionsApi.stop(prev.sessionId)
      const info = await sessionsApi.start({ projectId, command: prev.command, args: [], cwd })
      set((s) => startTerminalForProject(s, projectId, info.sessionId))
    },
    stop: async (projectId) => {
      const id = terminalStateOf(get(), projectId).sessionId
      if (!id) return
      await sessionsApi.stop(id)
      set((s) => stopTerminalForProject(s, projectId))
    }
  }
})

const EMPTY_TERMINAL_STATE: TerminalState = { sessionId: null, status: null, command: 'powershell' }
export function useTerminalProject(projectId: string): TerminalState {
  return useSessionStore((s) => s.byProject[projectId]) ?? EMPTY_TERMINAL_STATE
}
```

- [ ] **Step 2: 파일 저장까지만 (타입체크는 Task 11에서)**

`Terminal.tsx`(단일 가정)가 깨진다 — 정상.

---

## Task 10: StatusDot + Sidebar 컴포넌트

**Files:**
- Create: `src/components/StatusDot.tsx`
- Create: `src/components/Sidebar.tsx`

- [ ] **Step 1: `StatusDot.tsx`**

```tsx
import type { SessionStatus } from '@shared/types'
import { statusDotClass } from '@/stores/project-status'

export default function StatusDot({ status }: { status: SessionStatus | null }): React.JSX.Element {
  return <span className={`dot dot--${statusDotClass(status)}`} aria-hidden />
}
```

- [ ] **Step 2: `Sidebar.tsx`**

```tsx
import type { Project } from '@shared/types'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useAgentStore } from '@/stores/agent'
import { useSessionStore } from '@/stores/session'
import { aggregateProjectStatus } from '@/stores/project-status'
import StatusDot from './StatusDot'

export default function Sidebar(): React.JSX.Element {
  const openProjects = useWorkspacesStore((s) => s.openProjects)
  const activeProjectId = useWorkspacesStore((s) => s.activeProjectId)
  const setActive = useWorkspacesStore((s) => s.setActive)

  return (
    <nav className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__brand-name">개발 상황판</span>
        <span className="sidebar__brand-tag">DEV CONSOLE · M4a</span>
      </div>
      <button
        className={`sidebar__home ${activeProjectId === null ? 'is-active' : ''}`}
        onClick={() => setActive(null)}
      >🏠 대시보드</button>
      <div className="sidebar__divider" />
      <div className="sidebar__label">열린 프로젝트</div>
      <ul className="sidebar__list">
        {openProjects.length === 0 && <li className="sidebar__empty">대시보드에서 프로젝트를 여세요.</li>}
        {openProjects.map((p) => (
          <SidebarItem key={p.id} project={p} active={p.id === activeProjectId} onClick={() => setActive(p.id)} />
        ))}
      </ul>
      <button className="sidebar__add" onClick={() => setActive(null)}>+ 프로젝트</button>
    </nav>
  )
}

function SidebarItem({
  project, active, onClick
}: {
  project: Project
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  // 셀렉터는 원시값(string|null) — 안정 비교로 리렌더 최소화.
  const agentStatus = useAgentStore((s) => s.byProject[project.id]?.status ?? null)
  const terminalStatus = useSessionStore((s) => s.byProject[project.id]?.status ?? null)
  const status = aggregateProjectStatus(agentStatus, terminalStatus)
  return (
    <li className={`sidebar__item ${active ? 'is-active' : ''}`} onClick={onClick}>
      <StatusDot status={status} />
      <span className="sidebar__item-name">{project.name}</span>
    </li>
  )
}
```

- [ ] **Step 2b: 파일 저장까지만 (타입체크는 Task 11에서)**

(Sidebar가 참조하는 `useAgentStore`/`useSessionStore`는 Task 8/9에서 멀티로 바뀌어 있어 타입은 맞지만, App이 아직 Sidebar를 안 쓴다. Task 11에서 통합 그린.)

---

## Task 11: 뷰 통합 (App 2-pane + Dashboard + Workspace + Terminal + AgentView) → 그린

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/views/Workspace.tsx`
- Modify: `src/views/Terminal.tsx`
- Modify: `src/views/AgentView.tsx`

- [ ] **Step 1: `src/App.tsx` — 2-pane**

전체 교체:
```tsx
import Sidebar from './components/Sidebar'
import Dashboard from './views/Dashboard'
import Workspace from './views/Workspace'
import { useWorkspacesStore } from '@/stores/workspaces'

export default function App(): React.JSX.Element {
  const openProjects = useWorkspacesStore((s) => s.openProjects)
  const activeProjectId = useWorkspacesStore((s) => s.activeProjectId)
  const activeProject = openProjects.find((p) => p.id === activeProjectId) ?? null

  return (
    <div className="app">
      <div className="app__shell">
        <Sidebar />
        <main className="app__main">
          {activeProject ? (
            // key=프로젝트 → 전환 시 Workspace 재마운트 = 터미널 재attach + 링버퍼 replay(M2).
            <Workspace key={activeProject.id} project={activeProject} />
          ) : (
            <Dashboard />
          )}
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `src/views/Dashboard.tsx` — "열기" = workspaces.open**

`onOpenTerminal` prop을 제거하고 workspaces 스토어를 직접 쓴다. 상단 import와 시그니처/버튼만 바꾸고 `AddProjectForm`은 그대로 둔다.

import 교체:
```tsx
import { useEffect, useState } from 'react'
import type { CreateProjectInput, Project } from '@shared/types'
import { useProjectsStore } from '@/stores/projects'
import { useWorkspacesStore } from '@/stores/workspaces'
import { dialogApi } from '@/ipc-client'
```
시그니처 교체:
```tsx
export default function Dashboard(): React.JSX.Element {
  const { projects, loading, error, load, add, remove } = useProjectsStore()
  const open = useWorkspacesStore((s) => s.open)
  const [showForm, setShowForm] = useState(false)
```
카드 액션의 "터미널 열기" 버튼을 "열기"로 교체:
```tsx
                <button className="btn" onClick={() => open(p)}>
                  열기
                </button>
```
(`Project` import는 `AddProjectForm`/타입에서 계속 쓰이면 유지. 사용되지 않으면 제거해 lint를 통과시킨다.)

- [ ] **Step 3: `src/views/Workspace.tsx` — onBack 제거 + 프로젝트별 구독**

전체 교체:
```tsx
import { useState } from 'react'
import type { Project } from '@shared/types'
import AgentView from './AgentView'
import Terminal from './Terminal'
import { useAgentStore } from '@/stores/agent'
import { useSessionStore } from '@/stores/session'

type Channel = 'agent' | 'terminal'

export default function Workspace({ project }: { project: Project }): React.JSX.Element {
  const [channel, setChannel] = useState<Channel>('agent')
  const agentRunning = useAgentStore((s) => {
    const ps = s.byProject[project.id]
    return !!ps?.sessionId && ps.status !== 'done' && ps.status !== 'crashed'
  })
  const terminalRunning = useSessionStore((s) => !!s.byProject[project.id]?.sessionId)

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
        <span className="workspace__name">{project.name}</span>
        <div className="tabs">
          <button className={`tab ${channel === 'agent' ? 'tab--on' : ''}`} onClick={() => switchTo('agent')}>🤖 에이전트</button>
          <button className={`tab ${channel === 'terminal' ? 'tab--on' : ''}`} onClick={() => switchTo('terminal')}>⌨️ 터미널</button>
        </div>
      </div>
      <div className="workspace__body">
        {channel === 'agent' ? <AgentView project={project} /> : <Terminal project={project} />}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: `src/views/Terminal.tsx` — onBack/embedded 제거 + 프로젝트별**

전체 교체:
```tsx
import { useSessionStore, useTerminalProject } from '@/stores/session'
import XtermPane from '@/components/XtermPane'
import type { Project } from '@shared/types'

export default function Terminal({ project }: { project: Project }): React.JSX.Element {
  const { sessionId, status, command } = useTerminalProject(project.id)
  const setCommand = useSessionStore((s) => s.setCommand)
  const start = useSessionStore((s) => s.start)
  const stop = useSessionStore((s) => s.stop)

  return (
    <section className="terminal">
      <div className="terminal__bar">
        <input
          className="input terminal__cmd"
          value={command}
          onChange={(e) => setCommand(project.id, e.target.value)}
          placeholder="실행할 명령 (예: powershell, claude)"
        />
        <button
          className="btn btn--primary"
          onClick={() => void start(project.id, project.workspacePath)}
        >
          {sessionId ? '재시작' : '시작'}
        </button>
        <button className="btn btn--ghost-danger" onClick={() => void stop(project.id)} disabled={!sessionId}>
          종료
        </button>
        <span className="terminal__status">{statusLabel(status)}</span>
      </div>
      {sessionId ? (
        <XtermPane key={sessionId} sessionId={sessionId} />
      ) : (
        <div className="empty">“시작”을 눌러 {project.name}에서 터미널을 여세요.</div>
      )}
    </section>
  )
}

function statusLabel(s: 'running' | 'exited' | null): string {
  if (s === 'running') return '● 실행 중'
  if (s === 'exited') return '○ 종료됨'
  return '대기'
}
```

- [ ] **Step 5: `src/views/AgentView.tsx` — 프로젝트별 투영 + 액션에 projectId**

전체 교체:
```tsx
import { useEffect, useRef, useState } from 'react'
import type { Project, SessionStatus } from '@shared/types'
import { useAgentStore, useAgentProject } from '@/stores/agent'
import AgentEventItem from '@/components/AgentEventItem'
import PermissionCard from '@/components/PermissionCard'

export default function AgentView({ project }: { project: Project }): React.JSX.Element {
  const { sessionId, status, log, pending } = useAgentProject(project.id)
  const focusTick = useAgentStore((s) => s.focusTick)
  const start = useAgentStore((s) => s.start)
  const send = useAgentStore((s) => s.send)
  const approve = useAgentStore((s) => s.approve)
  const deny = useAgentStore((s) => s.deny)
  const interrupt = useAgentStore((s) => s.interrupt)
  const stop = useAgentStore((s) => s.stop)
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
      <div className="agent__bar">
        <span className={`badge badge--${status ?? 'none'}`}>{statusLabel(status)}</span>
        <span className="agent__spacer" />
        <button className="btn" onClick={() => void interrupt(project.id)} disabled={status !== 'running'}>중단</button>
        <button className="btn btn--ghost-danger" onClick={() => void stop(project.id)} disabled={!sessionId}>정지</button>
      </div>

      <div className="agent__log" ref={logRef}>
        {log.length === 0 && <div className="empty">아래에 지시를 입력해 에이전트를 시작하세요.</div>}
        {log.map((item) => <AgentEventItem key={item.id} item={item} />)}
        {pending.map((req) => (
          <PermissionCard key={req.requestId} req={req}
            onApprove={() => void approve(project.id, req.requestId)}
            onDeny={() => void deny(project.id, req.requestId, '사용자가 거부함')} />
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

- [ ] **Step 6: 전체 타입체크 (컷오버 그린 지점)**

Run: `pnpm run typecheck`
Expected: PASS (web + node). 실패하면 남은 단일 세션 참조를 찾아 고친다.

- [ ] **Step 7: 컷오버 일괄 Commit**

```bash
git add src/stores/agent.ts src/stores/session.ts src/components/StatusDot.tsx src/components/Sidebar.tsx src/App.tsx src/views/Dashboard.tsx src/views/Workspace.tsx src/views/Terminal.tsx src/views/AgentView.tsx
git commit -m "feat(m4a): renderer multi-session cutover (sidebar 2-pane, per-project stores)"
```

---

## Task 12: 스타일 (사이드바 · 상태 점 · 2-pane)

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 끝에 M4a 스타일 추가**

`src/styles.css` 맨 끝에 추가(`@keyframes blink`는 M3에서 이미 정의 — 재사용):
```css
/* M4a — 사이드바 2-pane + 상태 점 */
.app__shell {
  flex: 1;
  min-height: 0;
  display: flex;
}

.sidebar {
  width: 240px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 14px 10px;
  gap: 6px;
  overflow-y: auto;
}

.sidebar__brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px 10px;
}
.sidebar__brand-name { font-weight: 600; letter-spacing: -0.01em; }
.sidebar__brand-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-tertiary);
  letter-spacing: 0.08em;
}

.sidebar__home,
.sidebar__add {
  text-align: left;
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
.sidebar__home:hover,
.sidebar__add:hover { background: var(--bg-elevated); }
.sidebar__home.is-active { background: var(--bg-elevated); border-color: var(--border-strong); }
.sidebar__add { margin-top: auto; color: var(--text-secondary); }

.sidebar__divider { height: 1px; background: var(--border); margin: 8px 4px; }
.sidebar__label {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 0 8px;
  letter-spacing: 0.04em;
}

.sidebar__list {
  list-style: none;
  margin: 4px 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sidebar__empty { font-size: 11px; color: var(--text-tertiary); padding: 6px 8px; }

.sidebar__item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}
.sidebar__item:hover { background: var(--bg-elevated); }
.sidebar__item.is-active { background: var(--bg-elevated); border-color: var(--border-strong); }
.sidebar__item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-tertiary);
}
.dot--running { background: var(--emerald); }
.dot--waiting { background: var(--emerald); animation: blink 1.4s ease-in-out infinite; }
.dot--idle { background: #ffffff; }
.dot--done { background: var(--text-tertiary); }
.dot--none { background: var(--text-tertiary); opacity: 0.5; }
.dot--crashed { background: var(--danger); }
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "style(m4a): sidebar 2-pane + status dot styles"
```

---

## Task 13: 전체 검증 + 수동 E2E 스모크

**Files:** (없음 — 검증)

- [ ] **Step 1: 전체 그린**

Run: `pnpm test && pnpm run typecheck && pnpm build`
Expected: 모두 PASS/green (기존 + 신규 순수 테스트: workspaces-reducer 4 · agent-multi 8 · session-multi 5 · project-status 7, Main 멀티 테스트 포함).

- [ ] **Step 2: 앱 스모크 (`pnpm dev`) — 멀티 세션 절대원칙 확인**

1. 프로젝트 2개 등록 → 각각 "열기" → **사이드바에 둘 다** 표시(상태 점 회색=유휴/없음).
2. 프로젝트 A 에이전트에 "poc.txt 만들어줘" → 사이드바 A 점 변화(실행=에메랄드, 승인 카드 뜨면 사람대기=깜빡임 + 작업표시줄 배지).
3. 사이드바에서 **B로 전환** → A 세션은 계속 살아있고(전환해도 안 죽음), B에서 별도 에이전트/터미널 시작.
4. 다시 A로 전환 → A 대화 로그가 그대로 남아있다(상태 보존). 터미널 채널이면 **재attach 시 스크롤백 replay**.
5. 한쪽이 사람대기로 들어가면 그 프로젝트 점만 깜빡이고 알림이 뜬다 — 알림 클릭 → 해당 프로젝트로 점프(activeProject 전환 + 스크롤).
6. 두 프로젝트 동시에 에이전트 실행 → 각 점이 독립적으로 갱신(서로 간섭 없음).
7. 프로젝트 닫기(사이드바 항목 제거) 후 대시보드에서 재오픈 → 세션 상태 유지 확인.

- [ ] **Step 3: 발견 수정만 커밋(있으면)**

---

## Self-Review (작성자 체크)

**1. 설계/체크리스트 커버리지:**
- "매니저 단일→다중(세션 Map)" → Task 1(PtyManager) · Task 2(ClaudeAgentManager). ✅
- "렌더러 프로젝트별 상태(sessionId→projectId)" → Task 4(agent-multi) · Task 5(session-multi) · Task 8/9(스토어). ✅
- "Sidebar/StatusDot" → Task 6(집약/색) · Task 10(컴포넌트). ✅
- "App 2-pane" → Task 11 Step 1. ✅
- "여러 프로젝트 동시 실행 + 전환해도 세션 유지(절대원칙)" → Task 1/2(추가 방식·교체 안 함) · Task 11(전환=setActive만) · Task 13 스모크 3·4·6. ✅
- "탭 detach/reattach + 멀티세션 링버퍼 replay" → Task 1(세션별 RingBuffer) · Task 11(Workspace `key`=재마운트 → XtermPane 재attach) · Task 13 스모크 4. ✅
- 닫기=죽이기 아님 → Task 3(closeProject는 목록만) · 스토어가 stop 안 부름 · Task 13 스모크 7. ✅

**2. 플레이스홀더 스캔:** 모든 코드 스텝에 실제 코드. TODO/TBD 없음. ✅

**3. 타입 일관성:**
- 순수 함수명(`startForProject/routeEvent/routeStatus/routePermission/appendUserForProject/removePendingForProject/agentStateOf/projectOfSession`)이 Task 4 정의 ↔ Task 8 사용 일치. ✅
- 터미널(`startTerminalForProject/stopTerminalForProject/routeTerminalStatus/setCommandForProject/terminalStateOf`)이 Task 5 ↔ Task 9 일치. ✅
- `aggregateProjectStatus(agentStatus, terminalStatus)` 인자 순서가 Task 6 ↔ Task 10 SidebarItem 일치. `statusDotClass` ↔ StatusDot 일치. ✅
- 스토어 액션 시그니처에 `projectId`가 들어간 형태(`start(projectId,cwd,first?)`·`send(projectId,text)`·`approve/deny(projectId,requestId)`·`interrupt/stop(projectId)`)가 Task 8 ↔ Task 11 AgentView 일치. 터미널 `start/stop(projectId)`·`setCommand(projectId,c)`가 Task 9 ↔ Task 11 Terminal 일치. ✅
- `useAgentProject`/`useTerminalProject` 훅 반환 타입(`AgentState`/`TerminalState`)이 Task 8/9 ↔ Task 11 구조분해 일치. ✅
- Main 매니저 공개 API(`start/send/respondPermission/interrupt/status/stop/disposeAll/onEvent/onStatus/onPermissionRequest`) 불변 → `ipc/*`·`main.ts`·`notifier` 변경 불필요(상단 "변경 불필요" 절). ✅

**주의 / 의도된 선택(마스터 확인 권장):**
- ① **상태 점 우선순위**에서 `crashed`가 최하위 → 충돌+다른 채널 실행 시 점은 에메랄드(실행). 충돌은 "그 프로젝트에 더 진행 중인 게 없을 때만" 빨강으로 표면화(설계 §3 우선순위 그대로). 충돌을 더 강조하려면 우선순위 조정 필요.
- ② **채널 탭 선택은 프로젝트 전환 시 리셋**(Workspace `key`=재마운트로 'agent' 기본값 복귀). 재마운트가 곧 터미널 재attach/replay를 자연히 유발 — 의도. 탭 기억이 필요하면 workspaces에 채널 상태 추가(후속).
- ③ **프로젝트 close는 렌더러 byProject 상태를 지우지 않음**(세션이 Main에서 계속·재오픈 시 로그 보존). v1에선 byProject가 누적되나 프로젝트 수가 적어 무방(M4b 영속화에서 정리 고려).
- ④ **start 직후 도착하는 이벤트 경합**: `agentsApi.start` await 이전에 온 이벤트는 인덱스 미등록으로 무시될 수 있음 — M3 단일 세션과 동일 패턴이며 실제 첫 의미 이벤트는 왕복 후라 무해.

**미해결 이월(후속):** 이벤트 SQLite 적재(M4b) · 파일참조 버튼(M4c) · 프로젝트당 다중 에이전트(M7) · 세션 영속(앱 재시작 복원, M4b/M6).

---

## Execution Handoff

계획 완료. 저장: `plan/dev-console-m4a-plan.md`. 브랜치: `m4a-multisession`(이미 체크아웃됨) → push → PR.
구현 코딩은 **Codex 위임**(마스터 워크플로), Claude가 태스크별 검증·테스트 실행·커밋 리드. 순수 로직(Task 1–6)은 TDD로 그린 확인 후, 렌더러 컷오버(Task 7–11)는 Task 11 끝에서 일괄 타입체크 그린.
