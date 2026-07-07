# Dev Console (개발 상황판) — 에이전트 작업 지침

이 파일은 이 저장소에서 일하는 **모든 코딩 에이전트(Claude Code, Codex 등)의 단일 출처(single source of truth)** 지침이다.

LLM CLI(Claude Code 등)를 함대처럼 외부에서 관제하는 **Windows 네이티브 데스크톱 앱**.
여러 워크스페이스에 여러 LLM CLI를 동시에 띄우고 상태·알림·터미널·자동화·스케줄링을 한 화면에서 통제한다.
(IDE가 아니라 "에이전트 함대 관제 대시보드"가 목표.)

## 문서 (먼저 읽을 것)

- `plan/dev-console-spec.md` — **설계 명세서** (무엇을 만드나). 항상 이걸 기준으로 작업.
- `plan/dev-console-direction.md` — **핵심 결정문** (왜 이렇게 정했나, 무엇을 먼저 검증하나).
- `plan/dev-console-reuse-map.md` — **agent-orchestrator 재사용 매핑** (어떤 코드를 빌려오나).
- `plan/dev-console-spec.html` — 명세 HTML 렌더본 (참고용).

## 확정된 기술 스택 (변경 금지)

| 영역 | 선택 |
|---|---|
| 셸 | Electron |
| 프론트 | React + TypeScript |
| 상태관리 | Zustand |
| 백엔드 | Node.js (Electron Main) |
| 터미널 | xterm.js + node-pty |
| DB | better-sqlite3 |
| 스케줄러 | node-cron |
| 파일 감시 | chokidar |
| 빌드 | electron-vite |

## 절대 원칙 (위반 시 설계 붕괴)

1. **Main 프로세스가 진짜 백엔드, Renderer는 뷰일 뿐.** PTY 인스턴스·세션 상태는 Main이 소유.
2. **React 컴포넌트 언마운트 시 PTY를 죽이지 않는다.** 탭 전환·창 닫기와 작업 수명은 분리. (흔한 치명적 실수)
3. **모든 상호작용을 이벤트 스트림으로 모델링.** UI는 이벤트의 투영(projection).
4. **모든 화면은 지휘자(관제) 관점으로 설계한다.** 화면은 "무엇이 떠 있다"가 아니라 **"지금 무엇이 내 개입을 기다리는가 · 어디까지 진행됐는가"** 를 한눈에 보여준다. 단순 존재(어떤 프로젝트가 돌고 있다)는 정보가 아니다. 급한 것(사람 개입 대기)을 항상 최상단·강조로 둔다. **가짜 진척도(%)를 지어내지 않는다** — 근거 데이터가 없으면 그 사실을 솔직히 드러낸다(막대 생략).

## UI 사양 — 대시보드(관제 보드)

원칙 #4의 구체화. 대시보드는 등록 프로젝트의 **세로 라인 리스트**다(카드 그리드 금지). 각 줄은 지휘자가 한눈에 봐야 할 3가지를 담는다:

- **상태 점 + 사람 개입 대기 강조** — 승인·질문을 기다리며 멈춘 줄은 경고색 + **최상단**으로 끌어올린다.
- **진척도 막대 + %** — 에이전트 할 일 목록(`TodoWrite`)의 완료/전체로 산출. 목록이 없으면 막대 생략(원칙 #4: 가짜 % 금지).
- **지금 하는 중** — 할 일 목록의 현재(in_progress) 항목, 없으면 마지막 활동 한 줄.

정렬(급한 순): **사람대기 > 실행 > 유휴 > 완료 > 대기(미실행)**. 범위: 실시간 현황(현재 살아있는 세션). 과거 기록 영속화는 M4b. 상세: `plan/dev-console-dashboard-conductor-design.md`.

## 핵심 결정 요약 (전문: `plan/dev-console-direction.md`)

1. **stream-json 베팅 유지(조건부) — 단, `ClaudeCodeAdapter`는 공식 Agent SDK(`@anthropic-ai/claude-agent-sdk`) 위에 구축.** Agent 채널 = headless(SDK가 stream-json 래핑), Terminal 채널 = node-pty 인터랙티브. 두 채널 동시 실행은 **"허용(경고 없음)"**(보기 전환·동시 시작 모두 확인창 없이 즉시 — 소유자 결정 2026-06-04. 이력: 동시 금지 → 경고 후 허용(05-31) → 경고 제거(06-04). 이유: 터미널 여는 사용자는 충돌 위험을 알고 여는 것). (근거: M3 게이트 PoC에서 stream-json 직접 파싱은 권한 요청을 못 받음 = 버그 #34046 재현. SDK `canUseTool`로 해소. 전문: `plan/dev-console-direction.md` §2-bis.)
2. **`CliAdapter`는 stream-json을 전제하지 않는다.** "각 어댑터가 자기 이벤트 소스를 제공"으로 추상화. stream-json/SDK는 ClaudeCodeAdapter의 구현 디테일.
3. **사람이 보는 터미널 출력을 정규식으로 긁어 상태 추론 금지.** (agent-orchestrator가 15커밋 갈아넣고 폐기한 길)
4. **Terminal 채널 상태감지 = Claude Code 훅 + `~/.claude/projects/*.jsonl`.**

## ✅ 검증 게이트 — 통과(2026-05-30)

`claude --input-format stream-json --output-format stream-json` 의 **다중 턴 인터랙티브 제어**(stdin 후속 주입→응답 반복) = ✅ PASS(동일 session_id·맥락 유지). 단, **권한 요청은 직접 파싱으로 못 받음**(버그 #34046) → Agent 채널은 공식 Agent SDK + `canUseTool`로 구현하기로 확정. 상세·근거·증명: `plan/dev-console-direction.md` §2-bis.

## 마일스톤 (현재: M4a·M4b 완료 — main 미병합, 브랜치 `m4a-multisession`)

- **M1 골격** ✅ 완료(검증). Electron+React+TS 보일러플레이트, IPC 채널 구조, SQLite 초기화/마이그레이션, 빈 대시보드(프로젝트 카드 리스트 + 추가/삭제 CRUD 왕복).
- **M2 단일 세션** ✅ 완료(검증 2026-05-30). node-pty(동봉 prebuilt·in-process, Main 소유) + xterm.js 왕복, 링버퍼 스크롤백 replay, graceful teardown. 한글·색상·리사이즈·출력보존·claude 실행·폴더 선택 다이얼로그 확인. 상세: `plan/dev-console-m2-design.md`·`dev-console-m2-plan.md`. (데몬/named pipe/orphan 레지스트리는 인프로세스 설계라 미차용.)
- **M3 stream-json 통합** ✅ 완료(main 병합, PR#2~5). Agent 채널 = 공식 Agent SDK(`@anthropic-ai/claude-agent-sdk`) 기반(`canUseTool`로 권한/질문 처리). 이벤트 파서·질문대기 감지·네이티브 알림·듀얼채널 완료.
- **M4 멀티 세션 + 영속화** (분해 M4a/M4b/M4c) — **M4a(멀티세션 코어)** ✅ 구현·검증(매니저 단일→Map, `sessionId→projectId` 라우팅, 사이드바 2-pane). **M4b(이벤트 SQLite 영속화·지난 세션 복원)** ✅ 구현 + **수동 스모크 6/6 PASS(2026-07-08)**. **M4c(파일참조)** 미착수. 부가: **대시보드(관제 보드)** ✅, **다중 LLM CLI 선택 1단계**(터미널 드롭다운 Claude/Codex/Gemini/powershell/직접입력) ✅. ⚠️ 전부 브랜치 `m4a-multisession`에 있고 **main 미병합**.
- M5 자동화 (체크리스트, 오늘 작업 시작, 개발일지)
- M6 스케줄러 + 복구
- M7 멀티 에이전트 오케스트레이션

각 마일스톤은 **독립적으로 동작 가능한 상태**가 목표. 마일스톤 완료 시 다음으로 넘어가기 전 동작 확인을 요청한다.

## agent-orchestrator 코드 차용 규칙

원본: `C:\AI_project\testbed\agent-orchestrator` (**MIT 라이선스**). 매핑은 `plan/dev-console-reuse-map.md`.

- **함수 단위 복붙 + 의존성 끊기.** 모노레포 패키지를 link하지 말 것 (의존성 거미줄).
- worktree/PR/이슈 결합 로직은 제거하고 골격만 차용.
- **MIT 컴플라이언스 (코드를 실제 복사할 때 필수):**
  - 차용한 파일 상단에 출처 주석 (예: `// adapted from agent-orchestrator/packages/.../pty-host.ts (MIT)`).
  - 저장소 루트의 `NOTICE`(또는 `THIRD-PARTY-LICENSES`) 파일에 agent-orchestrator의 MIT 저작권 고지 원문을 포함.
  - ※ M2(2026-05-30)에서 AO 코드 첫 이식 완료 — 차용 파일 4개(ring-buffer·chunk-input·pty-manager·XtermPane) 상단 출처 주석 + 루트 `NOTICE`(ComposioHQ MIT 원문) 추가됨.

## 빌드 / 실행

```
pnpm install     # 의존성 + postinstall이 better-sqlite3 Electron prebuilt 자동 다운로드
pnpm dev         # 개발 모드 (electron-vite, HMR)
pnpm build       # 프로덕션 번들 → out/
pnpm start       # 빌드된 앱 실행 (electron-vite preview)
pnpm typecheck   # tsc 타입체크 (node + web)
pnpm rebuild     # Electron 버전 변경 시 better-sqlite3 바이너리 재설치
```

디렉토리: main/preload = `electron/`, renderer = `src/`, 공통 타입 = `shared/`. DB는 `app.getPath('userData')/dev-console.db`.

## 환경 메모

- OS: Windows 11. Node v24, npm 11, pnpm 11.2.2, git 2.52, Python 3.14.
- 패키지 매니저: **pnpm** 사용. pnpm 11 설정은 `.npmrc`가 아니라 **`pnpm-workspace.yaml`** 에 있음 (allowBuilds 등).
- **네이티브 모듈 전략 (MSVC 불필요):** 앱은 Electron 런타임에서 돌므로 Node용 소스 컴파일은 불필요. `pnpm-workspace.yaml`에서 better-sqlite3 자동빌드를 끄고, `postinstall`(`scripts/rebuild-native.mjs`)이 **prebuild-install로 Electron prebuilt 바이너리를 다운로드**한다. node-pty(M2)도 동일 패턴 적용 예정.
- M1 검증 완료(2026-05-29): install·typecheck·build 통과, 앱 부팅 시 6개 테이블 마이그레이션 + DB 생성 확인. better-sqlite3 = Electron ABI v130(electron 33.4.11) prebuilt.

## Git 워크플로

- 마스터(소유자)는 여러 기기에서 작업하므로 **원격(GitHub)이 단일 진실 공급원**.
- 기본은 `push` → PR → 원격 머지. (단, 소유자가 명시적으로 메인 직푸시를 지시하면 그에 따른다.)
- **로컬 머지 금지** (feature 브랜치를 로컬에서 base로 머지하지 말 것).
- 커밋/푸시는 소유자가 요청할 때만.
