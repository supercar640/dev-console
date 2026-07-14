# 작업일지 — 2026-07-08

> 다중 LLM CLI 선택(1단계) 구현 + M4b 수동 스모크 6/6 PASS + PR #6 머지·브랜치 정리.
> `main`에 M4a·대시보드·M4b·멀티CLI(1단계) 전부 통합됨. 다음은 멀티CLI 2단계 / M4c / Minor.

## ✅ 이번 세션 한 것

**다중 LLM CLI 선택 — 1단계: 완료·main 통합**
- 배경: 콘솔은 그동안 Agent 채널이 Claude 전용(`@anthropic-ai/claude-agent-sdk`)이었음. 터미널 채널은 이미 범용 명령 실행 가능(락인은 Agent 채널뿐).
- 설계: `plan/dev-console-multi-cli-design.md`. **단계적** — 1단계=터미널 채널 CLI 선택기, 2단계=지원 CLI만 Agent 채널 1급 승격(PoC 게이트).
- 구현(TDD 5 Task, `plan/dev-console-multi-cli-plan.md`): `shared/cli-registry.ts`(CLI 레지스트리 + `resolveCli`) → `session-multi`를 `command`에서 `cliId`/`customCommand`로 → 스토어 `selectCli`/`setCustomCommand` + `start`가 `resolveCli`로 해석 → `Terminal.tsx` 드롭다운(Claude/Codex/Gemini/powershell/직접입력).
- **라이브에서 발견·수정한 버그:** codex/gemini는 npm `.cmd` 배치라 node-pty(CreateProcess)가 이름으로 못 띄움 → `cmd.exe /c codex`로 감쌈(`cli-registry.ts`). claude(.exe)·powershell은 그대로. 커밋 `7281d02`.
- 검증: 서브에이전트 구동(구현→리뷰 루프 5 Task) + 최종 브랜치 리뷰(Ready to merge). 라이브에서 **codex/gemini 실행 확인**(마스터 관측).

**M4b 수동 스모크 — 6/6 PASS**
- 방식: 마스터가 앱 조작, Claude가 PrintWindow 캡처 + DB로 검증(실제 claude 호출).
- 결과: ① 정상종료→done(회색) 복원 ② 읽기전용 배너+지난 대화 복원 ③ ▶새로시작→라이브→지시 동작 ④ 2프로젝트 독립 복원(사과/바나나 안 섞임) ⑤ 강제종료→crashed(빨강) 강등 ⑥ DB 적재(sessions/events/상태). 정상종료(done)/강제종료(crashed) 구분 정확.

**마무리**
- Minor fix: `start()`가 첫 지시를 로그에 안 넣던 버그 → `send`처럼 에코(커밋 `3498c4d`). typecheck·테스트 그린. (라이브 재확인은 미실시.)
- 문서: AGENTS.md 마일스톤 표기 'M2완료·M3대기' drift → 현재로 갱신(`d3bef00`).
- **PR #6 머지**(머지 커밋 `df3927c`) → `main`. 브랜치 `m4a-multisession` 원격·로컬 삭제. 그룹 커밋 히스토리 보존(머지 방식).

## ⬜ 다음에 해야 할 것

1. **멀티 CLI 2단계** — Codex/Gemini를 대시보드 1급 관제(상태·권한 팝업·진척도)로 승격. **CLI별 PoC 게이트 먼저**(M3 게이트와 동일 방식, `hitl/m3-poc` 패턴): ⑴ 다중 턴 스트리밍 제어 ⑵ 구조화 이벤트(json) ⑶ **권한 승인 훅**. ⑶ 실패하면 그 CLI는 터미널 전용 유지(정규식 긁기 금지). 설계 `plan/dev-console-multi-cli-design.md §3`.
2. **M4c(파일 참조)** — 미착수. M4 분해의 마지막.
3. **Minor(미수정)**
   - 붙여넣기 Ctrl+V 이슈 미확인(Agent 입력/터미널). 원인 후보: 클립보드/포커스, 컨텍스트 메뉴 부재. 메뉴 오버라이드는 없음(main.ts `autoHideMenuBar`만).
   - 읽기전용 로그 **긴 줄 우측 잘림**(줄바꿈/오버플로 CSS).
   - **crashed 강등 DB 미반영** — 표시만 crashed, row는 'running' 유지(로드 시 지연 강등, 표시상 일관됨). 무해하나 인지.
   - 첫 지시 로그 fix(`3498c4d`)는 **라이브 재확인만** 남음(코드/테스트는 그린).

## 📌 상태 / 재개 메모

- `main` = `df3927c`(Merge PR #6). 브랜치 `m4a-multisession` **삭제됨**. 현재 로컬 브랜치 = `main`.
- 검증 기준선: `pnpm typecheck` EXIT 0 · `pnpm test` **101 passed / 1 skipped**(skip=`engine-live` 실 SDK 테스트, 의도적).
- **수동 스모크 도구**(scratchpad는 세션마다 사라지니 필요 시 재작성):
  - 캡처: `pnpm dev`(백그라운드) 후 PowerShell PrintWindow(flag=2, Electron 필수). 창 제목 `개발 상황판`, dev 창 프로세스명 `electron`. 정상 종료 = 창 X(또는 `$proc.CloseMainWindow()` = WM_CLOSE → will-quit). 강제 종료 = 특정 PID `Stop-Process`(이름으로 죽이지 말 것 — 다른 electron 앱까지 죽음, 분류기 차단됨).
  - DB 점검: `%APPDATA%/dev-console/dev-console.db`, 테이블 `cli_agents`/`sessions`/`events`. 정상종료→세션 status=done+ended_at, 강제종료→running 유지(로드 시 crashed 표시).
- 작업 방식: 구현=Codex 위임 선호, 검증·테스트·커밋=Claude. Git=원격(GitHub supercar640/dev-console)이 단일 진실, **로컬 머지 금지**, 작업 끝나면 push.
- 관련 메모리: `dev-console-context`(현행 갱신됨), `inspect-running-app-windows`, `codex-delegation-workflow`. (`m4b-smoke-progress` 메모리는 스모크 완료로 삭제함.)
