# 대시보드 관제 보드 구현 계획 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드를 박스(카드) 그리드에서 **지휘자 관점의 세로 라인 리스트**로 바꾼다 — 각 줄에 상태 점·사람 개입 대기 강조·진척도 막대(%)·"지금 하는 중"을 표시하고, 급한 것(사람 대기)을 최상단으로 정렬한다.

**Architecture:** 위험한 부분(진척도 산출)은 **순수 함수 `project-progress`로 분리해 TDD**한다 — 에이전트 이벤트 로그에서 가장 최근 `TodoWrite` 의 todos(완료/전체)로 %·현재 항목을 계산. UI는 기존 검증된 셀렉터(`aggregateProjectStatus`/`statusDotClass`)와 스토어(`useAgentStore`/`useSessionStore`/`useWorkspacesStore`)를 재사용하는 얇은 뷰. 데이터가 없으면 막대를 생략한다(가짜 % 금지 — `AGENTS.md` 원칙 #4).

**Tech Stack:** React 18 + TypeScript(strict) · Zustand · vitest(node, 코로케이트 `*.test.ts`) · 기존 IPC/스토어(변경 없음).

**설계 출처:** `plan/dev-console-dashboard-conductor-design.md`. 지침: `AGENTS.md` 절대원칙 #4 + "UI 사양 — 대시보드(관제 보드)".

---

## 파일 구조 (책임 경계)

- `src/stores/project-progress.ts` *(생성)* — 순수 셀렉터. `AgentState` → `{ percent, current, todoCounts }`. side-effect 없음 → node vitest.
- `src/components/ProgressBar.tsx` *(생성)* — `percent`(+선택 `label`) → 막대 1개. 표시 전용.
- `src/views/Dashboard.tsx` *(재작성)* — 카드 그리드 → 라인 리스트. 프로젝트별 상태/진척도 산출 + 급한 순 정렬. `AddProjectForm`은 그대로 유지.
- `src/styles.css` *(수정)* — `.board`/`.board__*`/`.progress` 추가. (`.cards`/`.card` 는 Dashboard 외 미사용이면 제거.)

**재사용(변경 없음):** `project-status.ts`(집약 상태·점 색), `agent-reducer.ts`(`AgentState`/`LogItem`/`initialAgentState`), `StatusDot.tsx`, `useAgentStore`/`useSessionStore`/`useWorkspacesStore`/`useProjectsStore`.

---

## Task 1: project-progress 순수 셀렉터 (TDD — 이 작업의 핵심 복잡도)

**Files:**
- Create: `src/stores/project-progress.ts`
- Test: `src/stores/project-progress.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/stores/project-progress.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { computeProjectProgress } from './project-progress'
import { initialAgentState, appendEvent, startSession, type AgentState } from './agent-reducer'
import type { AgentEvent } from '@shared/types'

function withEvents(...events: AgentEvent[]): AgentState {
  let s = startSession(initialAgentState(), 'a1')
  for (const e of events) s = appendEvent(s, e)
  return s
}
const todoWrite = (todos: unknown[]): AgentEvent =>
  ({ type: 'tool_use', name: 'TodoWrite', input: { todos } })

describe('computeProjectProgress', () => {
  it('빈 상태는 모두 null', () => {
    expect(computeProjectProgress(initialAgentState())).toEqual({
      percent: null, current: null, todoCounts: null
    })
  })

  it('5개 중 2 완료 + 1 진행 → 40%, current=진행 항목(activeForm)', () => {
    const s = withEvents(todoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
      { content: 'c', status: 'in_progress', activeForm: '로그인 폼 테스트 작성 중' },
      { content: 'd', status: 'pending' },
      { content: 'e', status: 'pending' }
    ]))
    expect(computeProjectProgress(s)).toEqual({
      percent: 40, current: '로그인 폼 테스트 작성 중', todoCounts: { done: 2, total: 5 }
    })
  })

  it('activeForm 없으면 content 로 대체', () => {
    const s = withEvents(todoWrite([{ content: '빌드 실행', status: 'in_progress' }]))
    expect(computeProjectProgress(s).current).toBe('빌드 실행')
  })

  it('가장 최근 TodoWrite 스냅샷을 채택', () => {
    const s = withEvents(
      todoWrite([{ content: 'a', status: 'pending' }, { content: 'b', status: 'pending' }]),
      todoWrite([{ content: 'a', status: 'completed' }, { content: 'b', status: 'completed' }])
    )
    expect(computeProjectProgress(s).percent).toBe(100)
  })

  it('TodoWrite 없으면 막대 없음 + 마지막 assistant 메시지를 current 로(첫 줄·80자)', () => {
    const s = withEvents(
      { type: 'tool_use', name: 'Read', input: {} },
      { type: 'message', role: 'assistant', text: '파일을 분석했습니다\n다음 줄' }
    )
    expect(computeProjectProgress(s)).toEqual({
      percent: null, current: '파일을 분석했습니다', todoCounts: null
    })
  })

  it('메시지 없으면 마지막 tool_use 이름을 current 로(TodoWrite 는 활동에서 제외)', () => {
    expect(computeProjectProgress(withEvents({ type: 'tool_use', name: 'Bash', input: {} })).current)
      .toBe('Bash 실행 중')
  })

  it('todos 가 배열이 아니면 진척도 없음', () => {
    const s = withEvents({ type: 'tool_use', name: 'TodoWrite', input: { todos: 'oops' } })
    expect(computeProjectProgress(s).percent).toBeNull()
  })

  it('in_progress 없고 일부 완료면 %만, current=null(TodoWrite 만 있으므로)', () => {
    const s = withEvents(todoWrite([
      { content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }
    ]))
    expect(computeProjectProgress(s)).toEqual({
      percent: 50, current: null, todoCounts: { done: 1, total: 2 }
    })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/stores/project-progress.test.ts`
Expected: FAIL ("Cannot find module './project-progress'").

- [ ] **Step 3: 구현**

`src/stores/project-progress.ts`:
```typescript
// 프로젝트 에이전트 상태 → 진척도/현재 활동 산출(순수). node vitest.
// 진척도 출처: 가장 최근 TodoWrite tool_use 의 todos(완료/전체). 없으면 막대 생략
// (가짜 % 금지 — AGENTS.md 원칙 #4). current: in_progress todo 우선, 없으면 마지막 활동.
import type { AgentState, LogItem } from './agent-reducer'

export interface ProjectProgress {
  /** 할 일 목록 완료율(0–100). 목록 없으면 null(막대 생략 신호). */
  percent: number | null
  /** "지금 하는 중" 한 줄. in_progress todo 우선, 없으면 마지막 활동. 없으면 null. */
  current: string | null
  /** 막대 라벨용. 목록 없으면 null. */
  todoCounts: { done: number; total: number } | null
}

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export function computeProjectProgress(s: AgentState): ProjectProgress {
  const todos = latestTodos(s.log)
  if (todos) {
    const total = todos.length
    const done = todos.filter((t) => t.status === 'completed').length
    const active = todos.find((t) => t.status === 'in_progress')
    return {
      percent: Math.round((done / total) * 100),
      current: active ? (active.activeForm ?? active.content) : lastActivity(s.log),
      todoCounts: { done, total }
    }
  }
  return { percent: null, current: lastActivity(s.log), todoCounts: null }
}

/** log 를 뒤에서 앞으로 훑어 가장 최근 TodoWrite 의 유효 todos(비어있지 않음)를 반환(없으면 null). */
function latestTodos(log: LogItem[]): TodoItem[] | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const item = log[i]
    if (item.kind !== 'event' || item.event.type !== 'tool_use' || item.event.name !== 'TodoWrite') continue
    const raw = (item.event.input as { todos?: unknown } | null)?.todos
    if (!Array.isArray(raw)) return null
    const todos = raw.filter(isTodoItem)
    return todos.length > 0 ? todos : null
  }
  return null
}

function isTodoItem(v: unknown): v is TodoItem {
  const t = v as { content?: unknown; status?: unknown }
  return typeof t?.content === 'string' &&
    (t.status === 'pending' || t.status === 'in_progress' || t.status === 'completed')
}

/** 마지막 의미있는 활동 한 줄: 최신 assistant 메시지 > 최신 tool_use 이름(TodoWrite 제외). 없으면 null. */
function lastActivity(log: LogItem[]): string | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const item = log[i]
    if (item.kind !== 'event') continue
    if (item.event.type === 'message') return oneLine(item.event.text)
    if (item.event.type === 'tool_use' && item.event.name !== 'TodoWrite') return `${item.event.name} 실행 중`
  }
  return null
}

function oneLine(text: string): string {
  const line = text.trim().split('\n')[0]
  return line.length > 80 ? line.slice(0, 79) + '…' : line
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/stores/project-progress.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/project-progress.ts src/stores/project-progress.test.ts
git commit -m "feat(dashboard): project-progress selector (TodoWrite -> percent/current, pure)"
```

---

## Task 2: ProgressBar 컴포넌트 (표시 전용)

**Files:**
- Create: `src/components/ProgressBar.tsx`

- [ ] **Step 1: 구현**

`src/components/ProgressBar.tsx`:
```tsx
// 진척도 막대(0–100). label 미지정 시 "NN%" 표시. 표시 전용 — 로직 없음.
export default function ProgressBar({
  percent,
  label
}: {
  percent: number
  label?: string
}): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress__fill" style={{ width: `${clamped}%` }} />
      <span className="progress__label">{label ?? `${clamped}%`}</span>
    </div>
  )
}
```

- [ ] **Step 2: 타입체크**

Run: `pnpm run typecheck:web`
Expected: PASS (additive — 아직 import 하는 곳 없음).

- [ ] **Step 3: Commit**

```bash
git add src/components/ProgressBar.tsx
git commit -m "feat(dashboard): ProgressBar component"
```

---

## Task 3: Dashboard 라인 리스트 컷오버 + 스타일

**Files:**
- Modify: `src/views/Dashboard.tsx` (리스트 부분 재작성, `AddProjectForm` 유지)
- Modify: `src/styles.css` (`.board`/`.progress` 추가)

- [ ] **Step 1: `Dashboard.tsx` 재작성**

`src/views/Dashboard.tsx` 전체를 아래로 교체:
```tsx
import { useEffect, useState } from 'react'
import type { CreateProjectInput, SessionStatus } from '@shared/types'
import { useProjectsStore } from '@/stores/projects'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useAgentStore } from '@/stores/agent'
import { useSessionStore } from '@/stores/session'
import { initialAgentState } from '@/stores/agent-reducer'
import { aggregateProjectStatus } from '@/stores/project-status'
import { computeProjectProgress } from '@/stores/project-progress'
import StatusDot from '@/components/StatusDot'
import ProgressBar from '@/components/ProgressBar'
import { dialogApi } from '@/ipc-client'

// 지휘자 정렬 우선순위(급한 순). 미실행(null)은 맨 끝. (AGENTS.md UI 사양)
const RANK: Record<SessionStatus, number> = {
  waiting_user: 0, running: 1, idle: 2, done: 3, crashed: 4
}
const rankOf = (status: SessionStatus | null): number => (status === null ? 5 : RANK[status])

export default function Dashboard(): React.JSX.Element {
  const { projects, loading, error, load, add, remove } = useProjectsStore()
  const open = useWorkspacesStore((s) => s.open)
  const agentByProject = useAgentStore((s) => s.byProject)
  const termByProject = useSessionStore((s) => s.byProject)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  // 각 프로젝트의 실시간 현황을 산출하고 급한 순으로 정렬.
  const rows = projects
    .map((p) => {
      const agent = agentByProject[p.id] ?? initialAgentState()
      const term = termByProject[p.id]
      return {
        project: p,
        status: aggregateProjectStatus(agent.status, term?.status ?? null),
        progress: computeProjectProgress(agent),
        waiting: agent.status === 'waiting_user' || agent.pending.length > 0,
        pendingTool: agent.pending[0]?.toolName ?? null
      }
    })
    .sort((a, b) => rankOf(a.status) - rankOf(b.status))

  return (
    <section className="dashboard">
      <div className="dashboard__head">
        <h1 className="dashboard__title">관제 보드</h1>
        <button className="btn btn--primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? '닫기' : '+ 프로젝트 추가'}
        </button>
      </div>

      {showForm && (
        <AddProjectForm
          onSubmit={async (input) => {
            await add(input)
            setShowForm(false)
          }}
        />
      )}

      {error && <div className="alert alert--error">불러오기 실패: {error}</div>}

      {loading && projects.length === 0 ? (
        <div className="empty">불러오는 중…</div>
      ) : projects.length === 0 ? (
        <div className="empty">
          등록된 프로젝트가 없습니다.
          <span className="empty__hint">오른쪽 위 “+ 프로젝트 추가”로 워크스페이스를 등록하세요.</span>
        </div>
      ) : (
        <ul className="board">
          {rows.map(({ project, status, progress, waiting, pendingTool }) => (
            <li
              key={project.id}
              className={`board__row${waiting ? ' board__row--waiting' : ''}`}
              onClick={() => open(project)}
            >
              <StatusDot status={status} />
              <span className="board__name">{project.name}</span>

              <div className="board__mid">
                {waiting ? (
                  <span className="board__waiting">⚠ 승인 대기{pendingTool ? ` — ${pendingTool}` : ''}</span>
                ) : progress.todoCounts ? (
                  <ProgressBar
                    percent={progress.percent ?? 0}
                    label={`${progress.todoCounts.done}/${progress.todoCounts.total} · ${progress.percent}%`}
                  />
                ) : status === null ? (
                  <span className="board__idle">— 대기 중(아직 실행 안 함)</span>
                ) : (
                  <span className="board__idle">—</span>
                )}
                {!waiting && progress.current && (
                  <span className="board__current">지금: {progress.current}</span>
                )}
              </div>

              <div className="board__actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn--ghost-danger" onClick={() => void remove(project.id)}>
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AddProjectForm({
  onSubmit
}: {
  onSubmit: (input: CreateProjectInput) => void | Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const canSubmit = name.trim() !== '' && path.trim() !== ''

  const pickFolder = async (): Promise<void> => {
    const picked = await dialogApi.openDirectory()
    if (!picked) return
    setPath(picked)
    if (name.trim() === '') {
      const base = picked.split(/[\\/]/).filter(Boolean).pop() ?? ''
      setName(base)
    }
  }

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) void onSubmit({ name: name.trim(), workspacePath: path.trim() })
      }}
    >
      <input className="input" placeholder="프로젝트 이름" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        className="input"
        placeholder="워크스페이스 경로 (예: C:\repo\my-app)"
        value={path}
        onChange={(e) => setPath(e.target.value)}
      />
      <button type="button" className="btn" onClick={() => void pickFolder()}>폴더 찾기</button>
      <button className="btn btn--primary" type="submit" disabled={!canSubmit}>등록</button>
    </form>
  )
}
```

- [ ] **Step 2: `styles.css` — `.cards`/`.card` 블록 제거 후 보드 스타일 추가**

`src/styles.css` 에서 `.cards { … }` 부터 `.card__actions { … }` 까지의 블록(현재 195–231행)을 삭제하고, 그 자리에 추가:
```css
/* 대시보드 관제 보드 — 세로 라인 리스트 (AGENTS.md UI 사양: 지휘자 관점) */
.board {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.board__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-left: 2px solid transparent;
  cursor: pointer;
}
.board__row:hover { background: var(--bg-elevated); }

/* 사람 개입 대기 — 경고 강조(최상단 정렬은 정렬 로직이 담당) */
.board__row--waiting {
  border-left-color: var(--emerald);
  background: var(--emerald-soft);
}

.board__name {
  font-weight: 500;
  flex-shrink: 0;
  min-width: 120px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board__mid {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
}

.board__current {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.board__idle { color: var(--text-tertiary); }

.board__waiting {
  color: var(--emerald);
  font-weight: 600;
  white-space: nowrap;
  animation: blink 1.4s ease-in-out infinite;
}

.board__actions { display: flex; gap: 8px; flex-shrink: 0; }
/* 액션은 평소 숨김 → 줄 호버 시 노출(관제 화면을 깔끔히) */
.board__actions { opacity: 0; transition: opacity 0.12s ease-out; }
.board__row:hover .board__actions { opacity: 1; }

/* 진척도 막대 */
.progress {
  position: relative;
  flex: 0 0 180px;
  height: 18px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
}
.progress__fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--emerald);
  opacity: 0.45;
}
.progress__label {
  position: relative;
  display: block;
  text-align: center;
  line-height: 18px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-primary);
}
```

> 주: `.cards`/`.card`가 Dashboard 외에서 쓰이지 않는지 먼저 확인(`rg "className=\"card"` 또는 Grep). 다른 사용처가 있으면 그 블록은 남겨둔다.

- [ ] **Step 3: 타입체크 + 전체 테스트**

Run: `pnpm run typecheck` && `pnpm test`
Expected: PASS (기존 73 + project-progress 8 = 81 passed / 1 skipped, 타입 그린).

- [ ] **Step 4: 빌드**

Run: `pnpm build`
Expected: PASS (renderer 번들 생성).

- [ ] **Step 5: Commit**

```bash
git add src/views/Dashboard.tsx src/styles.css
git commit -m "feat(dashboard): card grid -> conductor line board (waiting-first, progress, current)"
```

---

## 수동 스모크 (구현 후 PC 앞에서)

`pnpm dev` 로 앱을 띄운 뒤:

- [ ] **라인 표시**: 대시보드가 박스가 아니라 **세로 줄**로 프로젝트를 나열한다.
- [ ] **진척도**: 에이전트가 할 일 목록을 만드는 작업을 시키면 막대 + %가 채워지고 "지금: …"이 갱신된다.
- [ ] **할 일 목록 없는 작업**: 막대 없이 "지금 하는 중"만 뜬다(가짜 % 없음).
- [ ] **사람 대기 최상단**: 승인 대기가 생기면 그 줄이 경고색으로 **맨 위**로 올라간다.
- [ ] **미실행 프로젝트**: "대기 중(아직 실행 안 함)"으로 회색 점.
- [ ] **줄 클릭**: 줄을 누르면 해당 프로젝트가 열린다(사이드바 활성).

> `TodoWrite` input 실제 형태가 규약(`content`/`status`/`activeForm`)과 맞는지 이때 1회 눈으로 확인. 다르면 `project-progress.ts` 의 `isTodoItem`/필드만 조정.

---

## Self-Review 체크 (작성자 점검 완료)

- **스펙 커버리지:** 라인형(Task 3)·진척도 막대+%(Task 1·2·3)·지금 하는 중(Task 1·3)·사람 대기 강조+최상단(Task 3 정렬/스타일)·가짜 % 금지(Task 1 null 처리)·실시간 범위(스토어 구독) — 전부 태스크 존재. 영속화(M4b)는 의도적 비범위.
- **플레이스홀더:** 없음(모든 코드/명령 구체).
- **타입 일관성:** `computeProjectProgress`/`ProjectProgress`/`todoCounts`/`percent`/`current` 명칭이 Task 1↔3 일치. `aggregateProjectStatus`(기존)·`initialAgentState`(기존) 시그니처 재사용.
