# M4b — 이벤트 영속화 + 지난 세션 복원 (설계)

> 설계 출처: `AGENTS.md` 마일스톤 M4b · `plan/dev-console-spec.md` §3(데이터 모델)·§4-7(개발일지 토대).
> 선행: M4a(멀티 세션 코어, 브랜치 `m4a-multisession`) 위에 얹는다.

## 목표 (확정 범위)

1. **저장(적재):** 에이전트가 만드는 모든 이벤트(메시지·도구 사용·도구 결과·할 일 목록·권한 요청·세션 종료)를 발생 시점에 DB `events` 테이블에 한 줄씩 적재한다. 세션 시작/종료도 `sessions` 행으로 기록한다.
2. **복원(읽기 전용):** 앱 재시작 시 **프로젝트마다 "가장 최근 세션 1건"** 을 DB에서 읽어, 저장된 이벤트를 순서대로 재생(replay)해 화면 상태를 재구성한다. 복원된 세션은 **읽기 전용**(입력·승인 잠금, 상태 점 회색)이며, 이어서 일하려면 새 세션을 시작한다.

**핵심 가치:** 그 자체로 끝이 아니라 후속 마일스톤(M5 개발일지·리플레이·감사)의 **토대**. 그래서 "세션 단위 경계"를 보존하는 방향으로 설계한다.

## 비범위 (YAGNI — 후속 마일스톤)

- 세션 재개(죽은 에이전트를 멈춘 지점부터 이어서 실행) — 별도 마일스톤.
- 프로젝트별 **여러** 과거 세션을 훑는 "작업 이력 목록" 화면 — 후속.
- 대화 리플레이 재생(타임라인 스크럽) — M5+.
- 오래된 이벤트 자동 삭제·용량 관리(보존 정책) — 실제 문제가 될 때.

---

## 데이터 모델 — 기존 스키마 그대로 사용 (마이그레이션 없음)

M1에서 만든 테이블을 그대로 채운다. 연결 구조:

```
events.session_id  →  sessions.id
sessions.agent_id  →  cli_agents.id
cli_agents.project_id → projects.id
```

- **`cli_agents`** — 프로젝트당 "기본 에이전트(claude)" 1행을 **lazy upsert**. 결정적 id(`default-<projectId>`)로 `INSERT OR IGNORE` → 세션마다 중복 생성 안 됨. (M7 멀티 에이전트에서 이 테이블이 본격화되므로 미리 자연스럽게 채워둔다.)
- **`sessions`** — 세션 시작 시 1행 INSERT(`agent_id = default-<projectId>`, `status='running'`, `started_at`), 종료 시 UPDATE(`status`, `ended_at`).
- **`events`** — 이벤트마다 1행 INSERT. `type` = `AgentEvent.type`(필터/인덱스용), `payload_json` = `JSON.stringify(event)`(원형 보존), `timestamp` = ISO 문자열. 자동증가 `id` ASC = 발생 순서.

> **왜 스키마를 안 바꾸나:** 지름길(events에 project_id 직접 박고 sessions/cli_agents 우회)도 가능하지만 세션 경계가 사라져 M5 개발일지/리플레이의 토대가 깨진다. 정공법을 택한다.

### 세션 ID = UUID (필수 변경)

현재 `ClaudeAgentManager`는 세션 id를 `a${++seq}` 인메모리 카운터로 만든다 → **앱 재시작 시 `a1`부터 다시 시작해 `sessions.id`(PK)와 충돌**. 영속화를 위해 세션 id를 `randomUUID()`로 바꾼다. sessionId는 렌더러에서 라우팅 키(불투명 문자열)로만 쓰이므로 값 형식 변경은 안전하다. (영향: `agent-manager.test.ts`의 `a1` 기대치 수정.)

---

## 저장 경로 (write) — Main 소유

```
agents:start (IPC)
  → agentManager.start(input)            # sessionId = randomUUID()
  → agentStore.recordSessionStart(sessionId, projectId, startedAt)   # cli_agents upsert + sessions insert

agentManager.onEvent(sessionId, event)
  → broadcast('agent:event', …)          # (기존) 렌더러로
  → agentStore.recordEvent(sessionId, event, timestamp)             # (신규) events insert

agentManager.onStatus(info) where status ∈ {done, crashed}
  → agentStore.recordSessionEnd(sessionId, status, endedAt)         # sessions update

will-quit → agentManager.disposeAll() → 각 세션 stop → recordSessionEnd(done)
```

- 저장은 **부수효과**로만 추가한다. 기존 broadcast/notifier 흐름은 건드리지 않는다(이벤트가 화면에 흐르는 경로 그대로 + 저장 한 줄 추가).
- `events`엔 projectId가 불필요(`session_id`로 충분). projectId가 필요한 곳은 세션 시작 1회뿐.
- 저장 실패가 앱을 멈추면 안 됨 — write는 best-effort(에러는 로깅만, UI/세션은 계속).

## 복원 경로 (read) — 앱 시작 1회

```
앱 시작(렌더러) → projects 로드 후 agents.loadHistory() 1회 호출
  → Main: 프로젝트별 가장 최근 세션 + 그 events 조회
  → RestoredSession[] 반환
  → agentStore: 각 프로젝트에 hydrate (replay → AgentState, live=false)
```

- IPC 신규: `agents:loadHistory()` → `RestoredSession[]` (모든 프로젝트의 마지막 세션을 한 번에). 프로젝트가 적으므로 일괄 조회가 효율적.
- 각 `RestoredSession`: `{ projectId, sessionId, status, events: AgentEvent[] }`.
- **복원 시 미종료 세션 처리:** `ended_at IS NULL`인데 status가 `running/waiting_user/idle`로 남아있으면 비정상 종료로 간주 → 복원 상태를 `crashed`로 강등(점 회색). (정상 종료는 `done`으로 저장돼 있음.)
- 진척도·"지금 하는 중"은 별도 저장 불필요 — 기존 `computeProjectProgress(agentState)`가 복원된 `log`에서 그대로 산출. 대시보드/사이드바는 자동 반영.

---

## 읽기 전용 표시

- `AgentState`에 `live: boolean` 필드 추가. 라이브 세션 = `true`, 복원 세션 = `false`.
- `startForProject`(새 세션 시작)는 `live=true`로 리셋 → 복원 위에서 새로 시작하면 자동으로 라이브 전환.
- `AgentView`: `live=false`면 입력창·승인/거부 버튼 비활성 + 상단에 "지난 작업 (읽기 전용 · 새로 시작하려면 ▶ 실행)" 배너.
- 상태 점: 복원 세션 status는 `done`/`crashed` → 기존 `statusDotClass`가 회색/레드 처리(추가 작업 없음).
- 대시보드 정렬: 복원(done/crashed)은 RANK 하위 → 자연히 아래쪽. 라이브 대기 세션이 항상 위(기존 로직 유지).

---

## 책임 경계 (파일)

**신규 (순수/격리 → TDD):**
- `electron/agent/event-codec.ts` — Main측 순수 로직(better-sqlite3 미import → node 단위테스트 가능): `encodeEvent`/`decodeEvent`(`AgentEvent ↔ payload_json` 라운드트립) + `resolveRestoredStatus`(미종료 세션 → `crashed` 강등 규칙).
- `electron/db/agent-store.ts` — DB 읽기/쓰기 어댑터(better-sqlite3 동기). `recordSessionStart` / `recordEvent` / `recordSessionEnd` / `loadHistory`. **단위 테스트 없음** — better-sqlite3가 Electron ABI 전용이라 node vitest에서 로드 불가(기존 `projects.ts` 등 DB 코드와 동일 패턴). 검증은 수동 스모크. 위험 로직은 위 `event-codec`로 빼서 테스트.
- `src/stores/agent-restore.ts` — `events: AgentEvent[] → AgentState`(replay, 순수, 렌더러측이라 node 테스트 가능). 기존 `agent-reducer`(`startSession`+`appendEvent`) 재사용 + `live=false`/status 세팅.

**수정:**
- `electron/agent/agent-manager.ts` — 세션 id `randomUUID()`로. (그 외 변경 최소)
- `electron/ipc/agents.ts` — onEvent에 `recordEvent` 추가, start/stop/onStatus에 record 배선, `agents:loadHistory` 핸들러. `agentStore` 주입.
- `electron/main.ts` — `agent-store` 생성·주입(`getDatabase()` 사용).
- `electron/preload.ts` + `shared/types.ts` — `agents.loadHistory()` 노출, `RestoredSession` 타입.
- `src/stores/agent-reducer.ts` — `AgentState.live` 필드 추가(+ `initialAgentState`/`startSession` 갱신).
- `src/stores/agent-multi.ts` — `hydrateProject(projectId, restored)` 추가(+ sessionIndex 등록).
- `src/stores/agent.ts` — 앱 시작 시 `loadHistory` 호출 → 각 프로젝트 hydrate.
- `src/views/AgentView.tsx` — `live=false` 읽기 전용 UI.

**재사용(변경 없음):** `agent-reducer`의 전이 함수, `project-progress`/`project-status` 셀렉터, `StatusDot`, `Dashboard`/`Sidebar`(복원 상태 자동 투영).

---

## 테스트 전략 (위험한 곳만 TDD)

better-sqlite3는 Electron ABI 전용이라 **node vitest에서 DB를 직접 열 수 없다.** 따라서 DB 왕복(SQL)은 수동 스모크로 검증하고, 위험한 순수 로직만 자동 테스트한다.

1. **`event-codec`** (node) — 모든 `AgentEvent` variant를 직렬화→역직렬화하면 원본과 동일(라운드트립). 깨진 payload_json → null 방어. `resolveRestoredStatus`: 미종료(`ended_at` 없음)+살아있던 상태 → `crashed`, 정상 종료는 보존.
2. **`agent-restore`** (node) — events 재생 결과 `log`가 라이브로 흘렸을 때와 동일(`appendEvent` 누적과 일치) + `live=false` + status 매핑. → `computeProjectProgress`가 복원 상태에서 올바른 %/current 산출.
3. **`agent-reducer`/`agent-multi`** (node) — `live` 필드 추가 후 기존 전이 불변식 유지 + `hydrateProject`가 byProject/sessionIndex를 올바로 채움.

DB 적재·조회(`agent-store`)와 라이브 통합(실제 claude로 저장→재시작→복원)은 **수동 스모크**로 검증(아래).

## 수동 스모크 (구현 후)

- [ ] 에이전트로 할 일 목록 작업 실행 → 앱 종료 → 재시작 → 대시보드에 그 프로젝트의 진척도·마지막 활동이 복원되고 점이 회색(종료).
- [ ] 프로젝트 클릭 → AgentView에 지난 대화/이벤트가 읽기 전용으로 펼쳐지고 입력창 잠김 + 배너.
- [ ] 그 프로젝트에서 ▶ 새로 시작 → 라이브로 전환, 입력 가능.
- [ ] 프로젝트 2개를 각각 작업 후 재시작 → 각자 마지막 세션이 독립 복원.

---

## 미해결 / 리스크

- **세션 id UUID 전환**이 M4a 렌더러 라우팅(`sessionIndex`)·focusSession 점프에 회귀 없는지 확인(불투명 문자열이라 무해 예상, 테스트로 가드).
- 이벤트 폭주 시 동기 INSERT 비용 — better-sqlite3는 동기·빠름, WAL 모드. 문제 시 트랜잭션 배치(후속). 현재 범위에선 단건 INSERT로 충분.
- `payload_json` 크기(긴 도구 출력) — 일단 원형 저장. 용량 관리는 비범위.
