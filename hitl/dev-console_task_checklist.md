# Dev Console — 태스크 체크리스트

> HITL(human-in-the-loop) 작업 추적용 로컬 체크리스트. `hitl/`은 gitignore — 커밋되지 않음.
> 출처: `plan/dev-console-spec.md` §6 마일스톤 + `dev-console-direction.md`. 최종 갱신: 2026-05-30.
> 표기: `- [x]` 완료 / `- [ ]` 예정. (`오늘 작업 시작` 파서가 `- [ ]` 패턴을 읽을 수 있게 형식 유지.)

---

## M1 — 골격 ✅ 완료(검증)

- [x] Electron + React + TypeScript 보일러플레이트 (electron-vite)
- [x] IPC 채널 구조 (preload contextBridge)
- [x] SQLite 초기화 + 마이그레이션 (6 테이블)
- [x] 빈 대시보드 (프로젝트 카드 리스트 + 추가/삭제 CRUD)

## M2 — 단일 세션 ✅ 완료(검증 2026-05-30)

- [x] node-pty Electron prebuilt 확보 (동봉 N-API, MSVC 불필요)
- [x] PtyManager — Main 인프로세스 소유, 단일 세션 (데몬/파이프 미사용)
- [x] 링버퍼 + 스크롤백 replay (뷰 전환 후 출력 보존)
- [x] ConPTY 입력 청킹 / graceful teardown (AO 차용)
- [x] xterm.js 터미널 UI + IPC 왕복 (언마운트=detach만)
- [x] 검증: 한글 · ANSI 색상 · 창 리사이즈 · 출력 보존 · 종료 정리
- [x] claude 인터랙티브 실행 확인 (PowerShell 안에서)
- [x] 프로젝트 등록 폴더 선택 다이얼로그
- [x] AO MIT 출처 주석 + 루트 NOTICE
- [x] 단위 테스트 19 · typecheck · build green

## M3 — Stream-JSON 통합 ✅ 거의 완료 (엔진 PR#2 · UI PR#3 · 디자인소스 PR#4 머지)

- [x] ⚠️ **착수 전 게이트**: `claude --input-format stream-json --output-format stream-json` 다중 턴 인터랙티브 제어 30분 PoC — ✅ PASS(2026-05-30). 동일 session_id로 2턴 왕복 + 맥락 유지("42") 확인. 하네스: `hitl/m3-poc/multiturn-poc.mjs`. 관측 이벤트: system:init/assistant/user/result:success/rate_limit_event/system:hook_*.
- [x] **아키텍처 확정**: 직접 파싱은 권한 요청 못 받음(버그 #34046 재현) → Agent 채널 = 공식 **Agent SDK(`@anthropic-ai/claude-agent-sdk` 0.3.158)** 기반. `canUseTool` 발화·deny 반영 증명 PASS(`hitl/m3-poc/sdk-proof.mjs`). 결정 기록: direction.md §2-bis, AGENTS.md, spec.md §2-1.
- [x] **엔진 구축**(브랜치 `m3-agent-engine`, 계획 `plan/dev-console-m3-plan.md`). 검증: typecheck+build 그린, 단위 34통과 + 라이브 통합 스모크(실제 claude) PASS. 구현=Codex 위임, 검증·커밋=Claude.
- [x] headless 모드 전환 (SDK `query()` 스트리밍 입력으로 Agent 세션 기동 — `electron/agent/{sdk-query,claude-agent-session,agent-manager}.ts`)
- [x] stream-json 이벤트 파서 (SDK 메시지 → 부록 B AgentEvent 매핑 — `electron/agent/event-parser.ts`)
- [x] "질문 대기" 감지 — 권한 요청·`AskUserQuestion` = `canUseTool` 통로 → `permission_request`/`user_input_required` + `waiting_user` (엔진 완료)
- [x] N초 idle 타이머 — `AgentNotifier`가 idle 60초 지속 시 알림(fake 주입 테스트). (PR#3)
- [x] Electron Notification 윈도우 네이티브 알림 + 배지 — `AgentNotifier`+`main.ts`(Notification 클릭→창 포커스·세션 점프, `app.setBadgeCount`). ※ 진짜 시스템 트레이 아이콘은 M6(트레이 상주)로 이월. (PR#3)
- [x] 듀얼 채널(Agent/Terminal) 토글 — `Workspace` 채널 탭 + **경고 후 허용 가드**(스펙 §2-2 "동시 금지"를 마스터 결정으로 조정). (PR#3)
- [x] 렌더러 Agent 뷰 + 승인/거부 — `AgentView`+`PermissionCard`(인라인 카드, 승인=아이스/거부=레드). Pencil 디자인(`design/dev-console-m3.pen`) 기반. (PR#3)
- [ ] **M3 잔여(소소):** ① 실제 앱 수동 스모크(`pnpm dev`로 승인·알림·탭 눈으로 확인) ② 명세 `spec.md §2-2` "동시 금지"→"경고 후 허용" 반영

## M4 — 멀티 세션 + 영속화 ← 진행중 (sub-project 분해: M4a/M4b/M4c)

**M4a — 멀티 세션 코어** (브랜치 `m4a-multisession`)
- [x] 설계 — 왼쪽 사이드바(열린 프로젝트+상태 점) + 멀티세션 아키텍처. 문서 `plan/dev-console-m4a-design.md`, Pencil `design/dev-console-m4a-multisession.png`. 상태 점: 에메랄드=실행/대기·흰색=유휴·회색=완료·레드=충돌.
- [ ] 구현 계획서 작성 (`plan/dev-console-m4a-plan.md`, TDD) ← **내일**
- [ ] 구현: 매니저 단일→다중(세션 Map) · 렌더러 프로젝트별 상태(`sessionId→projectId`) · Sidebar/StatusDot · App 2-pane
- [ ] 여러 프로젝트 동시 실행 + 전환해도 세션 유지(절대원칙)

**M4b — 이벤트 영속화**
- [ ] 모든 이벤트 SQLite 적재 (events 테이블 — 현재 메모리만)

**M4c — 파일 참조 버튼**
- [ ] 파일 선택 다이얼로그 → `@경로/파일.ext` 삽입

**(M4a에 포함)**
- [ ] 탭 detach/reattach + 멀티세션 링버퍼 replay (터미널=링버퍼/에이전트=스토어 로그)
- [ ] 프로젝트당 다중 에이전트 = M7 오케스트레이션으로 이월

## M5 — 자동화

- [ ] 체크리스트 파서 (.md `- [ ]` / .html 체크박스, 인터페이스 추상화)
- [ ] "오늘 작업 시작" 플로우 (체크리스트 → headless 세션 + 진행률 바)
- [ ] 종료 시 개발일지 자동 생성 (`.dev-console/logs/YYYY-MM-DD.md`)
- [ ] chokidar 워크스페이스 변경 감지 → 갱신 플래그

## M6 — 스케줄러 + 복구

- [ ] node-cron 통합 (schedules 테이블)
- [ ] 트레이 상주 모드 (창 닫아도 스케줄 생존)
- [ ] 헬스체크 워치독 (30초 ping)
- [ ] 지수 백오프 자동 재시작 (30s→1m→2m→4m, 5분 내 3회 실패 시 알림)

## M7 — 멀티 에이전트 오케스트레이션

- [ ] Coordinator 패턴 (v1: 수동 분담, N개 에이전트 등록)
- [ ] Main 메시지 버스 (직접 stdin/stdout 연결 금지)
- [ ] (v2) Pipeline / Parallel 워크플로 패턴
- [ ] (v2) React Flow 그래프 에디터

---

## 백로그 / 기술부채

- [ ] node-pty `conpty_console_list_agent` "AttachConsole failed" 종료 로그 noise 정리 (M3 어댑터 정비 때)
- [ ] claude 직접 spawn — Windows `.cmd` 셸 심 해석 (현재는 셸 안에서 입력; M3 CliAdapter에서)
- [ ] 누적 토큰/비용 대시보드 표시 (스펙 §7 — v1 필수 항목)
- [ ] 파일 충돌 방지 (파일 단위 락 + 경고; v2 git worktree 분리 검토)
