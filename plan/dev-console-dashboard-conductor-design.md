# 대시보드 "관제 보드" 설계 — 지휘자 관점

> 합의: 2026-06-14. 승인: 소유자. 상위 원칙: `AGENTS.md` 절대원칙 #4("모든 화면은 지휘자 관점") + "UI 사양 — 대시보드".

## 1. 목표 / 왜

대시보드가 지금은 프로젝트를 **박스(카드) 그리드**로 나열하고, 각 박스엔 이름·경로·[열기]·[삭제]만 있다. "어떤 프로젝트가 등록돼 있다"는 정보일 뿐, 지휘자가 알아야 할 **"지금 무엇이 내 손을 기다리는가 / 어디까지 갔는가"** 가 없다.

바꿀 것: 대시보드를 **세로 라인 리스트**로 만들고, 각 줄에 **(1) 사람 개입 대기 강조 (2) 진척도 막대+% (3) 지금 하는 중**을 표시한다. 급한 것이 항상 위로 온다.

## 2. 데이터 소스 (실현성 확인됨)

진척도/현재 활동의 출처는 **에이전트 채널의 이벤트 로그**다(렌더러 `useAgentStore`의 프로젝트별 `AgentState.log`).

- 클로드가 작업 중 호출하는 **`TodoWrite` 도구**가 `tool_use` 이벤트로 들어온다. `event-parser.ts`가 `input`을 **그대로 보존**함을 확인(`{ type:'tool_use', name:'TodoWrite', input:{ todos:[...] } }`).
- `TodoWrite` 의 `todos` 형태(Claude Code 규약): `{ content, status: 'pending'|'in_progress'|'completed', activeForm }[]`. 구현은 **방어적 파싱**(필드 없으면 그 todo 무시, 배열 아니면 진척도 없음으로 처리).

데이터가 없는 경우는 정직하게 처리한다(원칙 #4: 가짜 % 금지):
- `TodoWrite` 가 한 번도 안 온 세션 → **진척도 막대 생략**, "지금 하는 중"만(마지막 활동).
- 등록만 하고 안 돌린 프로젝트(=열린 세션 없음) → 회색 점, "대기 중(아직 실행 안 함)".

## 3. 순수 로직 (TDD 대상)

새 순수 모듈 `src/stores/project-progress.ts` — side-effect 없는 셀렉터. node vitest로 검증.

입력: 한 프로젝트의 `AgentState`(+ 터미널 상태는 상태 점에만 관여, 기존 `project-status.ts` 재사용).

산출(`ProjectProgress`):
- `percent: number | null` — 가장 최근 `TodoWrite` 의 `completed / total`(반올림). 없으면 `null`.
- `current: string | null` — `in_progress` todo의 `content`(activeForm 우선), 없으면 마지막 assistant 메시지/`tool_use` 이름 한 줄. 없으면 `null`.
- `todoCounts: { done: number; total: number } | null` — 막대 라벨용.

규칙:
- log를 **뒤에서 앞으로** 훑어 첫 `TodoWrite` tool_use를 채택(가장 최신 스냅샷).
- 비어 있거나 파싱 불가 → 모든 필드 `null`(막대 생략 신호).

## 4. 정렬 — 지휘자 우선순위

기존 `project-status.ts`의 집약 상태(`aggregateProjectStatus`)를 재사용해 줄 순서를 정한다.

급한 순: **`waiting_user`(사람대기) > `running`(실행) > `idle`(유휴) > `done`(완료) > 없음(대기/미실행)**.

`waiting_user` 줄은 경고색 + 깜빡임 + 최상단. (이미 상태 점 색규칙 존재 — 줄 전체 강조로 확장.)

## 5. UI — 라인 리스트

`src/views/Dashboard.tsx`: 카드 그리드(`<ul className="cards">`) → 라인 리스트로 교체.

한 줄(왼→오):
```
[상태점] 프로젝트명   [▓▓▓▓░░ 60%]   지금: <현재 항목>                 [열기]
```
- 사람대기 줄: `[상태점] 프로젝트명   ⚠ 승인 대기 — <무엇> …                [열기]`(막대 자리에 경고).
- 미실행 줄: `[상태점] 프로젝트명   —  대기 중(아직 실행 안 함)            [열기]`.
- [삭제]는 줄 호버 시 노출(평소 숨김 — 관제 화면을 깔끔하게).

`styles.css`: `.cards`/`.card` 그리드 → `.board`/`.board__row`(세로 라인), 진척도 막대 `.progress`, 경고 강조 `.board__row--waiting`.

새 컴포넌트(작게 분리): `src/components/ProgressBar.tsx`(percent → 막대), 필요 시 `src/components/BoardRow.tsx`(한 줄 = 상태점+이름+진척+현재+액션).

## 6. 범위 / 비범위

- **범위**: 현재 살아있는 세션의 **실시간 현황**. 화면을 보는 동안 이벤트로 갱신.
- **비범위(이번 아님)**: 앱 재시작 후에도 남는 **과거 진척 기록 영속화** → **M4b**(이벤트 SQLite 적재)에서. 그 전까지 앱을 끄면 진척도는 리셋된다(현재 상태도 그러함).
- **비범위**: 한 프로젝트 내 다중 에이전트(M7). 지금은 프로젝트당 한 에이전트 채널 기준.

## 7. 영향 파일 (요약)

| 파일 | 변경 |
|---|---|
| `src/stores/project-progress.ts` (+test) | **생성** — 진척도/현재항목 순수 셀렉터 |
| `src/views/Dashboard.tsx` | 카드→라인 리스트, 정렬, 진척도/현재/대기 표시 |
| `src/components/ProgressBar.tsx` | **생성** — 진척도 막대 |
| `src/components/BoardRow.tsx` | **생성(선택)** — 한 줄 컴포넌트 |
| `styles.css` | 라인 리스트·막대·경고 강조 스타일 |
| `src/stores/agent.ts` | (필요 시) 프로젝트별 진척도 셀렉터 훅 노출 |

기존 `project-status.ts`(집약 상태/점 색), `useAgentStore`(프로젝트별 log), `useWorkspacesStore`(열기)는 **재사용**.

## 8. 위험 / 미해결

- **TodoWrite 미사용 작업이 많으면** 막대가 자주 안 보인다 → 의도된 동작(가짜 % 금지). "지금 하는 중"으로 충분히 조망 가능.
- **`TodoWrite` input 실제 형태**가 규약과 다를 가능성 → 방어적 파싱 + 단위 테스트로 고정. 실제 라이브 1회 확인 권장(스모크).
- **대시보드 vs 사이드바 일관성**: 사이드바는 이미 상태 점이 있다. 이번엔 대시보드(전체 함대 조망)에 집중. 사이드바에도 진척도를 넣을지는 후속 판단(원칙 #4는 모든 화면에 적용되므로 자연 확장 후보).
