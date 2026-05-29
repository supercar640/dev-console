# M2 (단일 세션) — 설계 명세

> 상위 문서: `dev-console-spec.md` §6 "M2: 단일 세션", `dev-console-direction.md`, `dev-console-reuse-map.md`.
> 이 문서는 M2를 구현 계획으로 넘기기 위한 **확정 설계**다. 작성: 2026-05-29.
> 브레인스토밍에서 마스터가 내린 3대 결정을 못 박고, 범위·구조·차용·검증을 정의한다.

---

## 0. 한 줄 목표

프로젝트 카드의 **"터미널 열기"** 버튼 → 그 워크스페이스 폴더에서 명령(기본 `claude`)이 **진짜 터미널**로 뜨고, 키 입력↔출력 왕복이 되며, 화면을 떠났다 와도 출력이 보존되고, "종료"로 깔끔히 정리된다. 윈도우 ConPTY의 까다로운 지점(한글·색상·리사이즈·종료 오류창)을 이 단계에서 실증한다.

---

## 1. 확정 결정 (브레인스토밍 2026-05-29)

| # | 결정 | 근거 |
|---|---|---|
| **D1** | **PTY를 Electron Main이 인프로세스로 소유.** 별도 데몬 프로세스·named pipe·orphan 레지스트리 없음. | Electron Main 자체가 장수 백엔드 → AO식 detached 데몬(=CLI가 죽어도 세션 생존 목적)은 M2엔 잉여. 절대원칙 #1·#2를 가장 단순하게 충족. Main 크래시 시 PTY 종료는 감수(복구는 M6). |
| **D2** | **출력 보존(링버퍼 + 스크롤백 replay) 포함.** | 절대원칙 #2(렌더러 언마운트와 PTY 수명 분리)를 M2부터 실증. 뷰 전환 후 재진입 시 출력 유지. AO `pty-host` 버퍼 로직 차용이라 저비용. 멀티탭/멀티세션 detach UI는 M4. |
| **D3** | **범용 명령 실행.** `PtyManager`는 임의의 `command + args + cwd`를 띄운다. M2 기본값 = 워크스페이스에서 `claude`. | 어댑터 무관 철학(spec §2-3, direction §1-3). 처음부터 범용이면 M3+에서 codex/gemini가 이 위에 그대로 얹힘. ConPTY 검증은 항상 깔린 `pwsh`로 선행 가능. |

AO 차용은 **D1과 무관하게** 적용한다: ConPTY graceful teardown, 입력 청킹, 링버퍼, 셸명 `.exe` 해석, xterm 컴포넌트 — "로직"만 가져오고 데몬/파이프 레이어는 버린다.

---

## 2. 범위 (YAGNI 경계)

### 이번 M2에 **함**
- 앱 전체에서 **단일** 터미널 세션 1개 (`PtyManager`가 1개 보유).
- 임의 명령 spawn (기본 `claude` in workspace), 키 입력 → stdin, 출력 → 화면, **왕복**.
- 색상(ANSI) · 한글 인코딩 · 창 리사이즈 정상 동작.
- 링버퍼(최근 N줄) + 뷰 (재)마운트 시 스크롤백 replay → 화면 떠나도 출력 보존.
- 종료 시 graceful teardown (WER `0x800700e8` 다이얼로그 회피).
- node-pty 네이티브 모듈을 better-sqlite3와 동일 패턴(컴파일러 없이 Electron prebuilt)으로 설치.
- AO 차용 코드 MIT 컴플라이언스(출처 주석 + 루트 `NOTICE`).

### M2엔 **안 함** (이후 마일스톤)
- 여러 세션 동시 실행 (M4). M2는 1개 한정.
- stream-json Agent 채널 / 듀얼 채널 토글 (M3).
- "질문 대기" 감지 + 윈도우 네이티브 알림 (M3).
- 출력/이벤트 SQLite 적재·검색 (M4) — **M2 세션 상태는 in-memory only.** DB 미접촉.
- 탭/창 간 detach·reattach (M4). M2의 replay는 *같은 창 안 뷰 전환* 한정.
- 크래시 자동 복구·워치독 (M6).
- 파일 참조 버튼(`@경로`) (M4).

---

## 3. 아키텍처

### 3-1. Main (백엔드)

```
electron/
├── pty/
│   ├── pty-manager.ts     신규. 단일 세션 보유. spawn/send/resize/getScrollback/status/stop.
│   ├── ring-buffer.ts     AO pty-host outputBuffer 분리(🟡). append(buf)/replay():string, 최근 N줄.
│   └── conpty.ts (선택)   셸명 .exe 해석 + 입력 청킹 등 ConPTY 유틸. (pty-manager에 흡수 가능)
└── ipc/
    └── sessions.ts        신규. sessions:* 핸들러 등록(registerIpcHandlers에 추가).
```

**`PtyManager` 인터페이스 (단일 세션, but `sessionId` 부여해 M4 멀티 전방호환):**

```ts
interface StartOpts { command: string; args: string[]; cwd: string }
interface SessionStatus { status: 'running' | 'exited'; pid: number; exitCode?: number }

class PtyManager {
  start(opts: StartOpts): { sessionId: string; pid: number }  // 이미 살아있으면 기존 것 정리 후 교체
  send(sessionId: string, data: string): void                 // ConPTY 청킹 차용
  resize(sessionId: string, cols: number, rows: number): void
  getScrollback(sessionId: string): string                    // 링버퍼 replay
  status(sessionId: string): SessionStatus | null
  stop(sessionId: string): void                               // graceful teardown
  onData(cb: (sessionId: string, data: string) => void): void
  onStatus(cb: (sessionId: string, s: SessionStatus) => void): void
  disposeAll(): void                                          // app will-quit 시 호출
}
```

- **node-pty 옵션**: `encoding: null`(raw Buffer로 받아 ANSI 충실 replay), `name: 'xterm-256color'`, 초기 cols/rows는 렌더러 attach 시 resize로 교정.
- **입력 청킹(AO `pty-client` 차용)**: 큰 입력(붙여넣기 등, >512자)은 512자/15ms로 쪼개 ConPTY 바이트 드롭(>3~4KB) 회피. Enter(`\r`)는 300ms 후 별도 전송. 단일 키스트로크는 직접 write.
- **graceful teardown(AO `pty-host` 차용)**: `stop()` 및 앱 종료(`will-quit`) 시 `pty.kill()` → 잠깐 대기 → 정리. node-pty의 conpty helper가 파이프 끊기기 전에 정리되도록. `disposeAll()`을 `main.ts` `will-quit`에 연결.

### 3-2. Renderer (화면)

```
src/
├── views/Terminal.tsx        신규. xterm.js 인스턴스, IPC 구독, 입력/리사이즈 송신, replay.
├── stores/session.ts         신규(Zustand). 현재 세션 id/status, start/stop 액션.
└── ipc-client.ts             sessions.* 래퍼 추가.
```

- **xterm.js + addon-fit + addon-web-links** (AO `web/src/components/terminal/` 차용 🟡, WebSocket→IPC 교체). VS Code·Windows Terminal과 동일한 업계 표준.
- 마운트 시: `sessions:attachTerminal` 호출 → 스크롤백 텍스트 받아 `term.write()`로 replay → 이후 `session:terminalData` 이벤트 구독.
- 언마운트 시: `sessions:detachTerminal`(구독 해제만). **PTY는 죽이지 않음** (D1·절대원칙 #2).
- `term.onData` → `sessions:send`. `FitAddon` resize → `sessions:resize`.
- **진입점 UI**: 대시보드 프로젝트 카드에 "터미널 열기" 버튼 + 활성 세션엔 "종료" 버튼. M2는 단일 세션이라 터미널 뷰는 1개.

### 3-3. IPC 채널 (spec 부록 A 정렬)

| 방향 | 채널 | 페이로드 |
|---|---|---|
| R→M invoke | `sessions:start` | `{ projectId, command?, args?, cwd }` → `{ sessionId, pid }` |
| R→M invoke | `sessions:stop` | `{ sessionId }` |
| R→M invoke | `sessions:send` | `{ sessionId, data }` |
| R→M invoke | `sessions:resize` | `{ sessionId, cols, rows }` *(부록 A에 없던 신규 — 명세에 추가 필요)* |
| R→M invoke | `sessions:attachTerminal` | `{ sessionId }` → `{ scrollback, status }` |
| R→M invoke | `sessions:detachTerminal` | `{ sessionId }` |
| M→R event | `session:terminalData` | `{ sessionId, data }` |
| M→R event | `session:statusChange` | `{ sessionId, status, pid?, exitCode? }` |

preload(`window.api`)·`shared/types.ts`의 `DevConsoleApi`에 `sessions` 묶음 추가. M→R 이벤트는 `ipcRenderer.on` 구독을 preload에서 안전하게 노출(`onTerminalData(cb)`, `onStatusChange(cb)` + 해제 함수 반환).

---

## 4. AO 차용 + MIT 컴플라이언스

| 가져오는 것 | 출처 (AO, MIT) | 태그 |
|---|---|---|
| 링버퍼(outputBuffer 로직) | `runtime-process/src/pty-host.ts` | 🟡 분리 |
| 입력 청킹(512자/15ms/300ms) | `runtime-process/src/pty-client.ts` `ptyHostSendMessage` | 🟢 |
| graceful teardown 시퀀스 | `runtime-process/src/pty-host.ts` shutdown | 🟢 |
| 셸명 `.exe` 해석 | `pty-host.ts` resolvedShellCmd | 🟢 |
| ~~node-pty Electron 바이너리 확보~~ | ~~`scripts/rebuild-node-pty.js`~~ | ❌ 차용 안 함(동봉 prebuilt로 충분, §5) |
| xterm 터미널 컴포넌트 | `web/src/components/terminal/` | 🟡 ws→IPC |

**버리는 것**: named pipe 서버/클라이언트, 바이너리 프레이밍(0x01~0x08), `windows-pty-registry`, detached spawn. (D1로 불필요.)

**의무 (AGENTS.md §차용 규칙 — 실제 코드 첫 복사 시점):**
1. 차용 파일 상단에 출처 주석. 예: `// adapted from agent-orchestrator/packages/plugins/runtime-process/src/pty-host.ts (MIT)`.
2. 저장소 루트에 `NOTICE` (또는 `THIRD-PARTY-LICENSES`) 신설 — AO의 MIT 저작권 고지 원문 포함.

---

## 5. 네이티브 모듈 (node-pty)

> ✅ **스파이크 완료(2026-05-29, Task 1) — Case A.** `node-pty@1.1.0`의 **동봉 prebuilt**(`prebuilds/win32-x64/{pty,conpty,conpty_console_list}.node`, **N-API**)가 **Node v24·Electron 33 양쪽에서 그대로 로드**됨(스모크로 로드·spawn·한글·ANSI 색상 OK 확인). 따라서 포크 교체·바이너리 다운로드·MSVC 컴파일 **전부 불필요.**

- `package.json`에 `node-pty@1.1.0` 추가. (AO `rebuild-node-pty.js`의 node-gyp 컴파일 방식은 **차용 안 함** — 동봉 prebuilt로 충분.)
- `pnpm-workspace.yaml` `allowBuilds`에 `node-pty: false` 추가 — node-gyp 빌드를 막고 동봉 prebuilt 사용. **이 항목이 없으면** pnpm 11이 `ERR_PNPM_IGNORED_BUILDS`로 `pnpm install`/`exec`/`dev`를 실패시킨다(스파이크 중 확인).
- `scripts/rebuild-native.mjs` **변경 불필요**(better-sqlite3만 prebuilt 다운로드, node-pty는 동봉).

⚠️ **관찰된 teardown 이슈:** 스모크가 `pty.kill()` 직후 즉시 `process.exit`하자 node-pty 헬퍼 `conpty_console_list_agent`가 `AttachConsole failed`로 죽었다(= AO가 경고한 WER `0x800700e8` 계열). 실제 앱은 graceful teardown(`disposeAll` + 필요 시 종료 지연)으로 완화하고, **Task 11 종료 검증에서 WER 다이얼로그 여부를 확인**한다.

---

## 6. 합격 기준 (검증 게이트)

수동 검증(앱 실행, `pnpm dev`):
1. **PowerShell 먼저** — 터미널 열기 → `powershell` 왕복. (이 머신엔 `pwsh`(PS7) 미설치 → 기본 셸 = `powershell` 5.1.)
   - [ ] 한글 입력·출력 안 깨짐 (`echo 안녕하세요` 등)
   - [ ] ANSI 색상 정상 (예: 컬러 출력 명령)
   - [ ] 창 리사이즈 → 터미널 cols/rows 반영
   - [ ] 대시보드로 갔다 돌아와도 이전 출력 보존(replay)
   - [ ] "종료" → 윈도우 오류 다이얼로그(`0x800700e8`) 안 뜸, 프로세스 정리
2. **claude** — 같은 엔진으로 기본값 `claude` 실행, 위 항목 재확인.

자동 테스트(TDD, 구현 단계):
- `ring-buffer.ts`: append/replay, 최대 줄 수 초과 시 오래된 줄 제거 — 단위 테스트.
- 입력 청킹 분할 로직 — 단위 테스트(>512자 분할, Enter 분리).
- 실제 PTY 왕복은 통합/수동 검증(노드 환경에서 node-pty 직접 spawn 스모크 테스트 가능).

---

## 7. 파일 변경 요약

**신규**
- `electron/pty/pty-manager.ts`, `electron/pty/ring-buffer.ts`
- `electron/ipc/sessions.ts`
- `src/views/Terminal.tsx`, `src/stores/session.ts`
- 루트 `NOTICE`

**수정**
- `package.json`(node-pty, xterm 의존성), `pnpm-workspace.yaml`(allowBuilds), `scripts/rebuild-native.mjs`(node-pty prebuilt)
- `electron/preload.ts`, `shared/types.ts`(`DevConsoleApi.sessions` + 이벤트 구독)
- `electron/ipc/index.ts`(`registerSessionHandlers` 추가), `electron/main.ts`(`will-quit`에 `disposeAll`)
- `src/ipc-client.ts`, `src/views/Dashboard.tsx`("터미널 열기" 버튼), `src/App.tsx`(터미널 뷰 라우팅)
- `dev-console-spec.md` 부록 A에 `sessions:resize` 추가

---

## 8. 미해결/주의

- **단일 세션 충돌**: 세션 가동 중 다른 프로젝트에서 "터미널 열기" → M2는 기존 세션 정리 후 교체(단순). 매끄러운 전환은 M4.
- **기본 셸**: 이 머신엔 `pwsh`(PowerShell 7) 미설치 → 세션 store 기본 명령 = `powershell`(5.1, 항상 존재). `resolveCommand` 셸 allowlist엔 pwsh·powershell·cmd 모두 유지(나중에 pwsh 설치 시 그대로 동작).
- **claude PATH**: 검증 시 `claude`가 PATH에 있어야 함. 없으면 PowerShell 검증만으로 M2 합격 기준 충족 가능(범용 구조라 무관).
- **ESM `.js` import 확장자**: AO 코드 복붙 시 dev-console tsconfig moduleResolution과 맞출 것(reuse-map 함정 #3).
