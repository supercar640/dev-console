# M3 UI 설계 (Agent 채널 화면 · 승인 · 알림 · 듀얼채널)

> 작성: 2026-05-31. M3 엔진(PR #2 머지) 위에 얹는 **화면(UI) 단계** 설계.
> 엔진은 IPC 경계까지 완료 — 이 단계는 렌더러 뷰/스토어 + Main 알림(Notification·Tray)만 추가한다.
> 동반: 명세 `dev-console-spec.md`(§2-2 듀얼채널·§4-3 알림), 결정 `dev-console-direction.md` §2-bis.

## 목표

각 워크스페이스를 **Agent(headless) / Terminal(인터랙티브)** 두 채널로 관제하는 화면. Agent 채널의 대화·도구사용을 보고, claude가 권한/질문을 요청하면 **인라인 카드로 승인/거부**하며, 자리를 떠 있어도 **윈도우 네이티브 알림 + 트레이 배지**로 호출된다.

## 확정 결정 (브레인스토밍 2026-05-31)

1. **승인 표시 = 대화 속 인라인 카드** (모달 아님). 화면을 막지 않아 세션 간 이동 자유.
2. **내비게이션 = 프로젝트 작업공간 뷰 + 채널 탭** `[🤖 에이전트 | ⌨️ 터미널]`, Agent 기본.
3. **듀얼채널 = 동시 허용(경고 없음).** ⚠️ **명세 §2-2의 "동시 활성 금지"를 조정한다.** 근거(소유자 결정): Claude를 Agent로 돌리면서 Terminal에서 Codex로 코드리뷰하는 등 합당한 동시 사용이 있다. 막지 않고, 보기 전환·동시 시작 모두 **확인창 없이 즉시** 허용한다. 파일충돌 위험은 사용자가 감수.
   > **갱신 2026-06-04(소유자 결정):** 당초 "시작 시 파일충돌 경고 confirm 후 허용"이었으나, 매번 뜨는 확인창이 거슬리고 터미널을 여는 사용자는 충돌 위험을 이미 아는 것으로 보아 **경고창을 제거**했다 — 동작은 그대로 '동시 허용', 경고만 삭제.
4. **알림 = waiting_user 진입 시** 네이티브 토스트 + 트레이 배지(대기 세션 수), 클릭 시 창 포커스 + 해당 세션 점프. Agent 채널 전용.
5. **유휴 타이머 = 'idle' 상태 60초 지속 시** 가벼운 "지시 대기" 알림(승인 요청과 구분). 포함.
6. **상태관리 = 새 Zustand `agent` 스토어**가 기존 `agentsApi`(preload 노출) 구독. Main 소유, 렌더러는 투영.

## 컴포넌트 / 파일 구조

### 렌더러 (`src/`)
- `stores/agent.ts` *(생성)* — Zustand. 구독: `agentsApi.onEvent/onStatusChange/onPermissionRequest/onFocusSession`. 보유: `events: AgentEvent[]`(대화 로그), `status`, `pending: PermissionRequest[]`(미결 승인). 액션: `start/send/approve/deny/interrupt/stop`.
- `views/Workspace.tsx` *(생성)* — 채널 탭 + 헤더(← 대시보드). `channel: 'agent'|'terminal'` 상태. AgentView/Terminal 중 하나 렌더. (당초 "듀얼채널 confirm 경고 가드"가 있었으나 2026-06-04 제거 — 탭 전환은 확인창 없이 즉시.)
- `views/AgentView.tsx` *(생성)* — 대화 로그(이벤트 투영) + 입력창/전송 + 상태 배지 + 시작/정지/중단. 미결 승인은 로그 하단 인라인 카드로.
- `components/AgentEventItem.tsx` *(생성)* — `AgentEvent` 1건을 타입별로 렌더(message/tool_use/tool_result/usage/error). `session_end`는 시스템 줄.
- `components/PermissionCard.tsx` *(생성)* — 주황 인라인 카드(도구명+입력 요약 + 승인/거부). `kind==='question'`이면 질문 문구.
- `App.tsx` *(수정)* — `active` 프로젝트 시 `Terminal` 직행 대신 `Workspace` 렌더. 토스트 클릭 점프 처리.
- `stores/session.ts` *(수정)* — 터미널 채널의 running 여부를 Workspace 가드가 읽을 수 있게 노출(이미 `sessionId`로 판별 가능).
- `styles.css` *(수정)* — 채널 탭·대화 버블·도구 줄·승인 카드·상태 배지 스타일.

### Main (`electron/`)
- `agent/notifier.ts` *(생성)* — `agentManager` 관찰: (a) status `waiting_user` 진입 → `Notification` 토스트 + 트레이 배지 갱신, (b) `idle` 60초 지속 → 가벼운 알림(타이머는 status 변동/이벤트 시 리셋), (c) 토스트 클릭 → 창 포커스 + `agent:focusSession` 송신. `BrowserWindow`·`Tray` 의존.
- `main.ts` *(수정)* — `Tray` 생성, `createNotifier(agentManager, getWindow, tray)` 배선, will-quit 정리.
- `ipc/agents.ts` *(수정)* — `agent:focusSession` 브로드캐스트 추가(알림 클릭 시).
- `shared/types.ts` *(수정)* — `DevConsoleApi.agents.onFocusSession(cb)` 추가.
- `preload.ts` *(수정)* — `onFocusSession` 노출.

## 데이터 흐름

1. **시작**: AgentView → `agentStore.start()` → `agentsApi.start({projectId, cwd, firstMessage})` → Main 엔진 세션 기동.
2. **이벤트**: Main 엔진 → `agent:event`/`agent:statusChange` → store 누적 → AgentView 투영.
3. **승인**: 엔진 `canUseTool` → `agent:permissionRequest` → store `pending` 추가 + status `waiting_user` → PermissionCard 표시. 마스터 클릭 → `agentsApi.respondPermission(sessionId, requestId, decision)` → 엔진이 claude로 반영.
4. **알림**: Main `notifier`가 statusChange(`waiting_user`) 관찰 → `Notification` + 트레이 배지. 클릭 → 창 포커스 + `agent:focusSession(sessionId)` → store가 해당 세션으로 점프.
5. **유휴**: `notifier`가 `idle` 진입 시 60초 타이머; 만료 시 "지시 대기" 알림. 새 status/event 도착 시 타이머 클리어.

## 에러 처리

- 엔진 `error` 이벤트 → 대화 로그에 빨간 줄, recoverable=false면 상태 `crashed` 배지.
- 알림 권한/Tray 아이콘 미가용 환경 → notifier는 조용히 무시(앱 기능은 정상). 단위 테스트는 fake Notification/Tray 주입.
- 듀얼채널 동시 실행은 **허용**하므로 충돌 방지 코드는 없음 — 경고 confirm도 2026-06-04 제거(사용자 책임).

## 테스트 전략

- **순수/로직 단위(vitest)**: `agent` 스토어 리듀서 로직(이벤트 누적·pending 관리·승인 후 제거)을 store에서 분리 가능한 순수 함수로 두고 테스트. `notifier`는 fake `Notification`/`Tray`/`window` 주입(M2 PtyManager의 `spawnFn` 주입 패턴 차용)으로 "waiting_user→알림 1회", "idle 60초→알림", "이벤트 도착 시 타이머 리셋" 검증.
- **컴포넌트**: M3 UI는 시각 위주 — 핵심 로직을 스토어/notifier로 빼고, 뷰는 얇게. (렌더러 컴포넌트 테스트는 현 toolchain에 미구성 → 수동 스모크로 대체.)
- **수동 스모크**: `pnpm dev` → 프로젝트 열기 → 에이전트 시작 → "파일 써줘" → 인라인 승인 카드 + 윈도우 토스트 + 트레이 배지 확인 → 거부 → 채널 탭 전환 + 터미널 동시 시작(경고 없이 전환되는지) 확인.

## 범위 밖 (후속)

- 이벤트 SQLite 적재·리플레이(M4). 멀티 세션 동시(M4). 모델/Effort 드롭다운(spec §4-2, 별도). 누적 토큰/비용 대시보드(백로그).

## 미해결/주의

- **명세 §2-2 갱신 완료(2026-06-04)**: "동시 활성 금지" → "허용(경고 없음)". spec.md 반영함.
- 유휴 60초는 상수로 시작(후속에 설정화). 트레이 아이콘 리소스 1개 필요(없으면 기본/투명 아이콘으로 시작).
