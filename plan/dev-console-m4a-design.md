# M4a 설계 — 멀티 세션 코어 (사이드바 + 동시 다중 프로젝트)

> 작성: 2026-06-02. **M4(멀티 세션 + 영속화)의 sub-project 1/3.** (M4b 이벤트 영속화 · M4c 파일참조 버튼은 별도 사이클.)
> 디자인: `design/dev-console-m3.pen`의 "M4a Multi-session" 화면 → `design/dev-console-m4a-multisession.png`.
> 동반: 명세 `dev-console-spec.md` §4-4(detach/reattach)·§6 M4. 절대원칙: `AGENTS.md`.

## 목표

여러 프로젝트를 **동시에 열어 한 화면에서 관제**한다. 왼쪽 사이드바에 열린 프로젝트와 상태가 상시 보이고(함대 관제), 항목을 눌러 전환한다. 전환해도 세션은 Main에서 계속 실행된다. (한 프로젝트 안 다중 에이전트는 M7로 이월 — 데이터모델은 지원하나 조율은 별도.)

## 확정 결정 (브레인스토밍 2026-06-02)

1. **멀티 단위 = 여러 프로젝트 동시.** 각 프로젝트 = 에이전트+터미널 1세트(M3 그대로). 프로젝트당 다중 에이전트는 M7.
2. **내비게이션 = 왼쪽 사이드바.** `개발 상황판`/태그 · `🏠 대시보드` · 구분선 · "열린 프로젝트" 목록(상태 점 + 이름) · `+ 프로젝트`. 오른쪽 = 선택 프로젝트의 Workspace(채널 탭/대화/입력 — M3) 또는 대시보드.
3. **상태 점 = 같은 모양(●) 색 구분:** 🟢에메랄드=실행중/사람대기(대기는 깜빡임) · ⚪흰색=유휴 · ⚫회색=완료 · 🔴레드=충돌. 프로젝트의 두 채널 중 가장 주의 필요한 상태로 집약(사람대기 > 실행 > 유휴 > 완료/충돌).
4. **수명 분리(절대원칙)** — 프로젝트 전환·사이드바 이동 시 세션 안 죽음(Main 소유). 정지는 명시적 "정지"만.

## 컴포넌트 / 파일 구조

### Main (`electron/`) — 단일→다중
- `pty/pty-manager.ts` *(수정)* — `session: Session | null` → `sessions: Map<string, Session>`. `start()`는 교체하지 않고 **추가**. `send/resize/getScrollback/status/stop`은 sessionId로 조회. `disposeAll`은 전체 순회. (콜백 `onData/onStatus`는 이미 sessionId 전달.)
- `agent/agent-manager.ts` *(수정)* — `session`+`currentId` → `sessions: Map<string, ClaudeAgentSession>`. `start()` 추가(기존 정지 로직 제거). `send/respondPermission/interrupt/status/stop`은 Map 조회. 세션 콜백은 이미 id로 라우팅.
- IPC(`ipc/sessions.ts`·`ipc/agents.ts`) *(수정 최소)* — 핸들러는 이미 sessionId 인자 기반. 단일 세션 가정(있으면) 제거.

### 렌더러 (`src/`)
- `stores/workspaces.ts` *(생성)* — Zustand. `openProjects: Project[]`, `activeProjectId: string | null`. 액션 `open(project)`/`close(projectId)`/`setActive(projectId)`. 사이드바·App이 구독.
- `stores/agent.ts` *(수정)* — 단일 세션 → **프로젝트별 상태 보유**: `byProject: Map<projectId, { sessionId: string|null; state: AgentState }>` + 역인덱스 `sessionId→projectId`. 이벤트(sessionId) 도착 시 소속 프로젝트의 `AgentState`만 reducer로 갱신. 활성 프로젝트 상태만 AgentView가 투영. (순수 `agent-reducer`는 그대로 재사용.)
- `stores/session.ts` *(수정)* — 터미널(PTY)도 동일하게 프로젝트별 보유.
- `components/Sidebar.tsx` *(생성)* — 브랜드 · 🏠 대시보드 · 열린 프로젝트 목록(`StatusDot` + 이름, 활성 강조) · `+ 프로젝트`. `workspaces`·각 프로젝트 상태 구독.
- `components/StatusDot.tsx` *(생성)* — `status: SessionStatus` → 색 점(●). running/waiting=emerald(waiting은 blink), idle=white, done/none=gray, crashed=red.
- `App.tsx` *(수정)* — 2-pane: `<Sidebar/>` + 메인(활성 프로젝트면 `<Workspace project/>`, 없으면 `<Dashboard/>`). 기존 단일 active 토글 제거.
- `views/Workspace.tsx` *(수정)* — `onBack` 제거(사이드바가 내비). 활성 프로젝트로 동작. 채널 탭·듀얼채널 가드는 M3 그대로.
- `views/Dashboard.tsx` *(수정 소)* — "열기"가 `workspaces.open(project)` + `setActive` 호출(탭 추가). 메인이 사이드바 안에서 라우팅되도록.

## 데이터 흐름

1. **열기**: Dashboard/사이드바에서 프로젝트 선택 → `workspaces.open(p)`+`setActive(p.id)`. 메인이 해당 Workspace 표시.
2. **세션 시작**: AgentView/Terminal에서 start → `agents.start({projectId,...})`/`sessions:start` → Main 매니저가 **새 세션을 Map에 추가**(기존 유지). 반환된 sessionId를 렌더러가 프로젝트에 매핑.
3. **이벤트 라우팅**: Main → `agent:event`/`statusChange`(sessionId 포함) → 렌더러가 `sessionId→projectId`로 소속 찾아 그 프로젝트 상태만 갱신. 활성 프로젝트면 화면 반영, 아니면 사이드바 점만 갱신.
4. **전환**: 사이드바 항목 클릭 → `setActive`만 변경. 세션은 Main에서 계속. 터미널 재attach 시 Main 링버퍼 replay(기존 M2), 에이전트는 스토어의 프로젝트별 로그 그대로 투영.
5. **상태 점**: 프로젝트의 agent·terminal 상태를 집약 → `StatusDot`.

## 에러 처리

- 미지의 sessionId로의 send/stop 등은 무시(throw 안 함) — 기존 단일 매니저 패턴 유지, Map 미스 시 no-op.
- 세션 crash → 해당 프로젝트 상태 `crashed` → 사이드바 레드 점 + (M3) 알림.
- 프로젝트 close 시 실행 중 세션이 있으면: v1은 **사이드바에서만 제거(세션은 계속 실행, 대시보드서 재오픈 가능)**. 명시적 정지는 Workspace "정지". (닫기=죽이기 아님 — 절대원칙.)

## 테스트 전략

- **Main(vitest, 기존 패턴)**: `PtyManager`·`ClaudeAgentManager`의 멀티 세션 단위 테스트 — "start 두 번 → 둘 다 살아있음", "sessionId로 각각 send/stop", "한 세션 stop이 다른 세션 영향 없음", "disposeAll 전체 정리". 기존 "start 재호출 시 교체" 테스트는 "추가"로 갱신.
- **렌더러 순수 로직(vitest, src 포함됨)**: `workspaces` 리듀서(open/close/setActive 순수 함수로 분리) + agent 멀티 매핑(`sessionId→projectId` 라우팅) 순수 함수 테스트. `agent-reducer`는 변경 없음(재사용).
- **컴포넌트**: 시각 위주 — `StatusDot` 색 매핑은 순수 함수로 분리해 테스트. Sidebar/레이아웃은 수동 스모크.
- **수동 스모크**: 프로젝트 2개 열어 둘 다 에이전트 시작 → 사이드바 점이 각각 갱신 → 한쪽 사람대기 시 점/알림 → 전환해도 양쪽 계속 실행 → 터미널 재attach replay 확인.

## 범위 밖 (M4 다른 sub-project / 후속)

- **이벤트 SQLite 적재(M4b)** — 현재 메모리만. 멀티 세션 위에 영속화 얹음.
- **파일 참조 버튼(M4c)**.
- 프로젝트당 다중 에이전트·오케스트레이션(M7). 세션 영속(앱 재시작 후 복원)은 M4b/M6.

## 주의

- 렌더러 멀티 세션 상태 매핑(`sessionId→projectId`)이 이 작업의 핵심 복잡도 — 순수 함수로 분리해 테스트.
- 상태 점 "집약 규칙"(두 채널 → 한 점)은 StatusDot/Sidebar에서 우선순위(사람대기>실행>유휴>완료>충돌)로.
