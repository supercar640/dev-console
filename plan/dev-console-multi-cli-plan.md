# 다중 LLM CLI 선택 — 1단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 터미널 채널에서 실행할 CLI를 드롭다운(Claude/Codex/Gemini/powershell/직접입력)으로 고를 수 있게 한다.

**Architecture:** 알려진 CLI를 `shared/cli-registry.ts`에 데이터로 정의(2단계 `CliAdapter`가 꽂힐 자리). 렌더러 상태(`session-multi`)는 프로젝트별 `command` 문자열 대신 `cliId` + `customCommand`를 보관하고, 시작 시 `resolveCli`로 실제 실행 command/args를 해석해 **기존 `sessions.start`를 그대로 호출**한다. Main/PtyManager는 손대지 않는다.

**Tech Stack:** React + TypeScript(렌더러), Zustand(상태), Vitest(테스트), 공유 타입 `shared/`.

## Global Constraints

- 패키지 매니저 **pnpm**. 전체 테스트 = `pnpm test`(= `vitest run`). 타입체크 = `pnpm typecheck`.
- **TDD:** 순수 로직(레지스트리·상태)은 실패 테스트 → 최소 구현 → 통과 순. 렌더러 컴포넌트(Terminal.tsx)는 유닛테스트 프레임워크(RTL/jsdom)가 **없으므로** 타입체크 + 수동 라이브 실행으로 검증한다(가짜 테스트 만들지 않음).
- **수정 범위:** `shared/` + `src/` 렌더러만. `electron/`(Main·PtyManager) 무변경. Agent 채널(`agents.*`) 무변경.
- UI 문구는 **한국어**. 기존 클래스/스타일 재사용(Rule 3 surgical — 인접 코드 개선 금지).
- **커밋:** 소유자(마스터)가 요청할 때만. 각 Task의 커밋 스텝은 실행 시 소유자 확인 후 수행(원격 push가 단일 진실 공급원).
- `supportsAgent`/`args`의 실사용은 2단계(Agent 채널 어댑터)에서. 1단계 `CliDef`는 stage-1 코드가 실제로 읽는 필드만 둔다(`args`는 `sessions.start`로 전달되어 사용됨; `supportsAgent`는 2단계로 미룸).

---

### Task 1: CLI 레지스트리 모듈

**Files:**
- Create: `shared/cli-registry.ts`
- Test: `shared/cli-registry.test.ts`

**Interfaces:**
- Produces:
  - `interface CliDef { id: string; label: string; command: string; args: string[] }`
  - `const CLI_REGISTRY: CliDef[]`
  - `const CUSTOM_CLI_ID = 'custom'`
  - `const DEFAULT_CLI_ID = 'powershell'`
  - `function resolveCli(cliId: string, customCommand: string): { command: string; args: string[] }`

- [ ] **Step 1: 실패 테스트 작성** — `shared/cli-registry.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { CLI_REGISTRY, CUSTOM_CLI_ID, DEFAULT_CLI_ID, resolveCli } from './cli-registry'

describe('cli-registry', () => {
  it('프리셋에 claude/codex/gemini/powershell이 있다', () => {
    const ids = CLI_REGISTRY.map((d) => d.id)
    expect(ids).toEqual(expect.arrayContaining(['claude', 'codex', 'gemini', 'powershell']))
  })

  it('id는 유일하고 command는 비어있지 않다', () => {
    const ids = CLI_REGISTRY.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of CLI_REGISTRY) expect(d.command.length).toBeGreaterThan(0)
  })

  it('기본 CLI는 레지스트리에 존재한다', () => {
    expect(CLI_REGISTRY.some((d) => d.id === DEFAULT_CLI_ID)).toBe(true)
  })

  it('resolveCli: 프리셋은 레지스트리의 command/args를 돌려준다', () => {
    expect(resolveCli('codex', '')).toEqual({ command: 'codex', args: [] })
  })

  it('resolveCli: custom은 입력 명령을 trim해 돌려준다', () => {
    expect(resolveCli(CUSTOM_CLI_ID, '  npm  ')).toEqual({ command: 'npm', args: [] })
  })

  it('resolveCli: 미지의 id는 custom 입력으로 폴백한다', () => {
    expect(resolveCli('ghost', 'bash')).toEqual({ command: 'bash', args: [] })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run shared/cli-registry.test.ts`
Expected: FAIL — `Failed to resolve import './cli-registry'` (모듈 없음)

- [ ] **Step 3: 최소 구현** — `shared/cli-registry.ts`

```ts
// 알려진 LLM CLI 정의(레지스트리). 1단계=메타데이터, 2단계 CliAdapter가 꽂히는 자리.
// dependency-free — Main/Renderer 양쪽에서 import (shared/types.ts와 동일 규약).

export interface CliDef {
  /** 안정 식별자. UI 선택·상태 저장 키. */
  id: string
  /** 드롭다운 표시명. */
  label: string
  /** 실행 명령(PtyManager로 그대로 전달). */
  command: string
  /** 기본 인자(현재 프리셋은 모두 빈 배열; sessions.start로 전달). */
  args: string[]
}

/** 프리셋에 없는 명령을 직접 입력하는 특수 선택지 id. 레지스트리 항목이 아니다. */
export const CUSTOM_CLI_ID = 'custom'

/** 기본 선택 CLI(범용 터미널). */
export const DEFAULT_CLI_ID = 'powershell'

export const CLI_REGISTRY: CliDef[] = [
  { id: 'claude',     label: 'Claude Code', command: 'claude',     args: [] },
  { id: 'codex',      label: 'Codex',       command: 'codex',      args: [] },
  { id: 'gemini',     label: 'Gemini',      command: 'gemini',     args: [] },
  { id: 'powershell', label: 'powershell',  command: 'powershell', args: [] }
]

/** 선택된 cliId(+custom일 때 입력 명령)를 실제 실행 command/args로 해석. */
export function resolveCli(cliId: string, customCommand: string): { command: string; args: string[] } {
  if (cliId === CUSTOM_CLI_ID) return { command: customCommand.trim(), args: [] }
  const def = CLI_REGISTRY.find((d) => d.id === cliId)
  if (!def) return { command: customCommand.trim(), args: [] }
  return { command: def.command, args: def.args }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run shared/cli-registry.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add shared/cli-registry.ts shared/cli-registry.test.ts
git commit -m "feat(multi-cli): CLI 레지스트리 + resolveCli (1단계)"
```

---

### Task 2: 터미널 상태에 cliId/customCommand 도입

**Files:**
- Modify: `src/stores/session-multi.ts`
- Test: `src/stores/session-multi.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_CLI_ID` (Task 1)
- Produces:
  - `interface TerminalState { sessionId: string | null; status: TerminalStatus | null; cliId: string; customCommand: string }`
  - `function setCliForProject(s, projectId, cliId): MultiTerminalState`
  - `function setCustomCommandForProject(s, projectId, customCommand): MultiTerminalState`
  - (변경 없음, 시그니처 유지) `terminalStateOf`, `startTerminalForProject`, `stopTerminalForProject`, `routeTerminalStatus`, `projectOfTerminalSession`, `initialMultiTerminalState`
  - **제거:** `setCommandForProject`, `command` 필드, `DEFAULT_COMMAND`

- [ ] **Step 1: 실패 테스트로 교체** — `src/stores/session-multi.test.ts`의 import와 command 관련 두 테스트를 교체

기존 import 줄:
```ts
import {
  initialMultiTerminalState, terminalStateOf, setCommandForProject,
  startTerminalForProject, stopTerminalForProject, routeTerminalStatus
} from './session-multi'
```
로 교체:
```ts
import {
  initialMultiTerminalState, terminalStateOf, setCliForProject, setCustomCommandForProject,
  startTerminalForProject, stopTerminalForProject, routeTerminalStatus
} from './session-multi'
```

기존 `setCommandForProject`/`command` 두 테스트(‘프로젝트별 명령을 보관’, ‘stopTerminalForProject는 … command는 유지’)를 아래로 교체:
```ts
  it('setCliForProject는 프로젝트별 cliId를 보관(기본 powershell)', () => {
    let s = initialMultiTerminalState()
    expect(terminalStateOf(s, 'p1').cliId).toBe('powershell')
    s = setCliForProject(s, 'p1', 'codex')
    expect(terminalStateOf(s, 'p1').cliId).toBe('codex')
    expect(terminalStateOf(s, 'p2').cliId).toBe('powershell')
  })

  it('setCustomCommandForProject는 customCommand를 보관한다', () => {
    let s = setCustomCommandForProject(initialMultiTerminalState(), 'p1', 'bash')
    expect(terminalStateOf(s, 'p1').customCommand).toBe('bash')
  })

  it('stopTerminalForProject는 세션을 비우되 cliId/customCommand는 유지한다', () => {
    let s = startTerminalForProject(initialMultiTerminalState(), 'p1', 's1')
    s = setCliForProject(s, 'p1', 'codex')
    s = stopTerminalForProject(s, 'p1')
    expect(terminalStateOf(s, 'p1')).toMatchObject({ sessionId: null, status: null, cliId: 'codex', customCommand: '' })
  })
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run src/stores/session-multi.test.ts`
Expected: FAIL — `setCliForProject`/`setCustomCommandForProject` export 없음, `.cliId` undefined

- [ ] **Step 3: 구현** — `src/stores/session-multi.ts` 전체를 아래로 교체

```ts
// 멀티 프로젝트 터미널(PTY) 상태 라우팅(순수). 프로젝트별 sessionId/status/cliId/customCommand.
import type { SessionInfo } from '@shared/types'
import { DEFAULT_CLI_ID } from '@shared/cli-registry'

export type TerminalStatus = SessionInfo['status'] // 'running' | 'exited'

export interface TerminalState {
  sessionId: string | null
  status: TerminalStatus | null
  cliId: string          // CLI_REGISTRY id | CUSTOM_CLI_ID
  customCommand: string   // cliId === CUSTOM_CLI_ID 일 때만 사용
}

export interface MultiTerminalState {
  byProject: Record<string, TerminalState>
  sessionIndex: Record<string, string> // sessionId → projectId
}

export function initialMultiTerminalState(): MultiTerminalState {
  return { byProject: {}, sessionIndex: {} }
}

export function terminalStateOf(s: MultiTerminalState, projectId: string): TerminalState {
  return s.byProject[projectId] ?? { sessionId: null, status: null, cliId: DEFAULT_CLI_ID, customCommand: '' }
}

function withProject(s: MultiTerminalState, projectId: string, next: TerminalState): MultiTerminalState {
  return { ...s, byProject: { ...s.byProject, [projectId]: next } }
}

export function setCliForProject(s: MultiTerminalState, projectId: string, cliId: string): MultiTerminalState {
  return withProject(s, projectId, { ...terminalStateOf(s, projectId), cliId })
}

export function setCustomCommandForProject(s: MultiTerminalState, projectId: string, customCommand: string): MultiTerminalState {
  return withProject(s, projectId, { ...terminalStateOf(s, projectId), customCommand })
}

/** 세션 시작 등록: running + 인덱스(이전 세션 인덱스 제거). cli 선택은 유지. */
export function startTerminalForProject(s: MultiTerminalState, projectId: string, sessionId: string): MultiTerminalState {
  const prev = s.byProject[projectId]
  const sessionIndex = { ...s.sessionIndex }
  if (prev?.sessionId) delete sessionIndex[prev.sessionId]
  sessionIndex[sessionId] = projectId
  const cliId = prev?.cliId ?? DEFAULT_CLI_ID
  const customCommand = prev?.customCommand ?? ''
  return {
    byProject: { ...s.byProject, [projectId]: { sessionId, status: 'running', cliId, customCommand } },
    sessionIndex
  }
}

/** 명시적 정지(렌더러): 세션/상태 비움, cli 선택 유지, 인덱스 제거. */
export function stopTerminalForProject(s: MultiTerminalState, projectId: string): MultiTerminalState {
  const prev = terminalStateOf(s, projectId)
  const sessionIndex = { ...s.sessionIndex }
  if (prev.sessionId) delete sessionIndex[prev.sessionId]
  return {
    byProject: { ...s.byProject, [projectId]: { sessionId: null, status: null, cliId: prev.cliId, customCommand: prev.customCommand } },
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

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run src/stores/session-multi.test.ts`
Expected: PASS (기존 라우팅 테스트 3 + 신규 3)

- [ ] **Step 5: 커밋**

```bash
git add src/stores/session-multi.ts src/stores/session-multi.test.ts
git commit -m "feat(multi-cli): 터미널 상태를 cliId/customCommand로 전환 (1단계)"
```

---

### Task 3: 세션 스토어 배선(selectCli/setCustomCommand/start 해석)

**Files:**
- Modify: `src/stores/session.ts`

**Interfaces:**
- Consumes: `resolveCli`, `DEFAULT_CLI_ID` (Task 1); `setCliForProject`, `setCustomCommandForProject`, `terminalStateOf`, `startTerminalForProject`, `stopTerminalForProject`, `routeTerminalStatus`, `initialMultiTerminalState`, `TerminalState`, `MultiTerminalState` (Task 2)
- Produces (store API, `Terminal.tsx`가 사용):
  - `selectCli(projectId: string, cliId: string): void`
  - `setCustomCommand(projectId: string, command: string): void`
  - (유지) `start(projectId, cwd)`, `stop(projectId)`, `useTerminalProject(projectId): TerminalState`
  - **제거:** `setCommand`

- [ ] **Step 1: 구현** — `src/stores/session.ts` 전체를 아래로 교체

```ts
import { create } from 'zustand'
import { sessionsApi } from '@/ipc-client'
import { resolveCli, DEFAULT_CLI_ID } from '@shared/cli-registry'
import {
  type MultiTerminalState, type TerminalState, initialMultiTerminalState, terminalStateOf,
  setCliForProject, setCustomCommandForProject, startTerminalForProject, stopTerminalForProject, routeTerminalStatus
} from './session-multi'

interface SessionStore extends MultiTerminalState {
  selectCli: (projectId: string, cliId: string) => void
  setCustomCommand: (projectId: string, command: string) => void
  start: (projectId: string, cwd: string) => Promise<void>
  stop: (projectId: string) => Promise<void>
}

export const useSessionStore = create<SessionStore>((set, get) => {
  // 1회: Main 상태 변경(PTY 종료 등)을 소속 프로젝트로 라우팅.
  sessionsApi.onStatusChange((info) => set((s) => routeTerminalStatus(s, info)))
  return {
    ...initialMultiTerminalState(),
    selectCli: (projectId, cliId) => set((s) => setCliForProject(s, projectId, cliId)),
    setCustomCommand: (projectId, command) => set((s) => setCustomCommandForProject(s, projectId, command)),
    start: async (projectId, cwd) => {
      // 같은 프로젝트에 살아있는 세션이 있으면 먼저 정지(재시작 — Main은 추가만 하므로 누수 방지).
      const prev = terminalStateOf(get(), projectId)
      if (prev.sessionId) await sessionsApi.stop(prev.sessionId)
      const { command, args } = resolveCli(prev.cliId, prev.customCommand)
      const info = await sessionsApi.start({ projectId, command, args, cwd })
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

const EMPTY_TERMINAL_STATE: TerminalState = { sessionId: null, status: null, cliId: DEFAULT_CLI_ID, customCommand: '' }
export function useTerminalProject(projectId: string): TerminalState {
  return useSessionStore((s) => s.byProject[projectId]) ?? EMPTY_TERMINAL_STATE
}
```

- [ ] **Step 2: 타입체크(이 시점엔 Terminal.tsx가 아직 옛 API를 참조해 실패해야 정상)**

Run: `pnpm exec vitest run src/stores/`
Expected: PASS (스토어가 의존하는 순수 모듈 테스트 그린). 타입체크는 Task 4에서 Terminal.tsx까지 고친 뒤 전체로 확인.

- [ ] **Step 3: 커밋**

```bash
git add src/stores/session.ts
git commit -m "feat(multi-cli): 세션 스토어 selectCli/setCustomCommand + start resolveCli (1단계)"
```

---

### Task 4: 터미널 UI 드롭다운

**Files:**
- Modify: `src/views/Terminal.tsx`

**Interfaces:**
- Consumes: `CLI_REGISTRY`, `CUSTOM_CLI_ID` (Task 1); `useTerminalProject`, `useSessionStore`(`selectCli`, `setCustomCommand`, `start`, `stop`) (Task 3)

- [ ] **Step 1: 구현** — `src/views/Terminal.tsx` 전체를 아래로 교체

```tsx
import { useSessionStore, useTerminalProject } from '@/stores/session'
import XtermPane from '@/components/XtermPane'
import { CLI_REGISTRY, CUSTOM_CLI_ID } from '@shared/cli-registry'
import type { Project } from '@shared/types'

export default function Terminal({ project }: { project: Project }): React.JSX.Element {
  const { sessionId, status, cliId, customCommand } = useTerminalProject(project.id)
  const selectCli = useSessionStore((s) => s.selectCli)
  const setCustomCommand = useSessionStore((s) => s.setCustomCommand)
  const start = useSessionStore((s) => s.start)
  const stop = useSessionStore((s) => s.stop)

  return (
    <section className="terminal">
      <div className="terminal__bar">
        <select
          className="input terminal__cli"
          value={cliId}
          onChange={(e) => selectCli(project.id, e.target.value)}
        >
          {CLI_REGISTRY.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
          <option value={CUSTOM_CLI_ID}>직접 입력…</option>
        </select>
        {cliId === CUSTOM_CLI_ID && (
          <input
            className="input terminal__cmd"
            value={customCommand}
            onChange={(e) => setCustomCommand(project.id, e.target.value)}
            placeholder="실행할 명령 (예: bash, node)"
          />
        )}
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

- [ ] **Step 2: 전체 타입체크 + 테스트**

Run: `pnpm typecheck && pnpm test`
Expected: 타입체크 PASS(잔존 `setCommand`/`command` 참조 없음), 전체 테스트 PASS

- [ ] **Step 3: 커밋**

```bash
git add src/views/Terminal.tsx
git commit -m "feat(multi-cli): 터미널 CLI 선택 드롭다운(+직접 입력) (1단계)"
```

---

### Task 5: 라이브 실행 검증(수동 — 1단계 완료 정의)

**Files:** 없음(관측만)

- [ ] **Step 1: 개발 앱 실행**

Run: `pnpm dev`
프로젝트 하나를 선택해 터미널 뷰로 이동.

- [ ] **Step 2: 각 선택지 실제 실행 관측**

드롭다운에서 순서대로 선택 후 “시작” → 터미널 탭에 실제 프로세스가 뜨는지 관측:
- `powershell`(기본) → PowerShell 프롬프트
- `Codex` → `codex` 실행(미설치면 “명령을 찾을 수 없음”이 떠도 **정상** — 명령 전달 자체를 확인하는 것)
- `Gemini` → `gemini` 실행(동일 기준)
- `Claude Code` → `claude` 실행
- `직접 입력…` → 자유입력칸 등장 → 예: `node -v`가 아니라 단일 실행파일(예: `bash`) 입력 후 시작

Expected: 선택한 CLI의 `command`가 그대로 PTY로 전달되어 실행됨. 재시작/종료 버튼 정상.

- [ ] **Step 3: 결과 기록**

관측 결과(무엇을 골라 무엇이 떴는지)를 소유자에게 보고. 미설치 CLI는 “명령 없음” 로그로 전달만 확인. **1단계 완료.**

---

## Self-Review

**Spec coverage (design §2 1단계):**
- §2-1 레지스트리 → Task 1 ✅ (단, `supportsAgent`는 Global Constraints대로 2단계로 명시적 연기)
- §2-2 터미널 UI 드롭다운(+custom) → Task 4 ✅
- §2-3 상태 cliId/customCommand + 인메모리 parity → Task 2·3 ✅ (DB 영속화는 설계 §2-3의 ‘선택적 1.5단계’ = 스코프 밖)
- §2-4 테스트 → Task 1·2 유닛테스트 ✅; UI는 타입체크+수동(RTL 부재, Global Constraints 명시)
- 2단계(design §3)는 본 계획 범위 밖 — PoC 게이트로 별도 계획.

**Placeholder scan:** TBD/TODO/“적절히 처리” 없음. 모든 코드 스텝은 실제 코드 포함.

**Type consistency:** `TerminalState`(cliId·customCommand), `setCliForProject`/`setCustomCommandForProject`, `selectCli`/`setCustomCommand`, `resolveCli` 반환 `{command,args}` — Task 1→2→3→4 전 구간 일치. 제거 대상(`command`/`setCommand`/`setCommandForProject`/`DEFAULT_COMMAND`)은 Task 4 전체 타입체크에서 잔존 참조 0 확인.
