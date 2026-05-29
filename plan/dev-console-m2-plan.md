# M2 (단일 세션) 구현 계획 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 카드의 "터미널 열기"로 워크스페이스에서 셸(기본 `pwsh`)을 node-pty로 띄워 xterm.js와 키 입력↔출력 왕복을 구현하고, 화면을 떠났다 와도 출력이 보존되며, 종료 시 ConPTY 핸들을 깔끔히 정리한다.

**Architecture:** Electron Main이 `PtyManager`로 node-pty 단일 세션을 인프로세스 소유(데몬·named pipe·레지스트리 없음). 출력은 링버퍼에 적재 후 (재)attach 시 IPC 이벤트로 replay. 렌더러는 xterm.js로 표시만 하고 언마운트해도 PTY를 죽이지 않는다(절대원칙 #2). AO에서 ConPTY 입력 청킹·링버퍼·xterm 와이어링 "로직"만 차용(MIT 출처 표기).

**Tech Stack:** Electron 33 · React 18 + TS · Zustand · node-pty · @xterm/xterm(+addon-fit, addon-web-links) · better-sqlite3(M2 미접촉) · vitest(신규, 순수 로직 TDD).

**상위 설계:** `plan/dev-console-m2-design.md` (D1 인프로세스 소유 · D2 출력 보존 · D3 범용 명령).

---

## ⚠️ 실행 전 주의 (Execution Preamble)

- **Git 규칙(AGENTS.md):** 커밋/푸시는 **소유자(마스터) 승인 후에만.** 각 Task 끝의 "Commit" 스텝은 *제안 시점*이다. 실행자는 마스터가 "커밋해도 된다"고 한 뒤 태스크 단위 **로컬 커밋**만 하고, 통합은 `push → PR`. **로컬 머지 금지.**
- **브랜치:** 메인에서 작업 금지. 구현 시작 시 `m2-single-session` 브랜치 생성 후 진행.
- **OS 전제:** Windows 11 네이티브(AGENTS.md). 기본 셸 = `pwsh`. ConPTY 검증이 M2의 핵심.
- **검증 명령:** `pnpm typecheck` (node+web tsc), `pnpm test` (Task 2에서 추가), `pnpm dev` (Electron HMR), `pnpm build`.
- **⚠️ claude 직접 spawn은 M2 비목표:** Windows에서 `claude`는 npm 셸 심(`.cmd`)이라 ConPTY 직접 spawn이 까다롭다. M2 터미널은 **셸을 띄우고 그 안에서 `claude`를 입력**하는 표준 방식(VS Code 통합 터미널과 동일). npm-심 CLI를 한 방에 띄우는 정밀 해석은 어댑터가 들어오는 M3로 미룬다.

---

## 파일 구조 (생성/수정 맵)

**생성**
- `electron/pty/node-pty.ts` — node-pty 바인딩 단일 import 지점(스왑 포인트).
- `electron/pty/ring-buffer.ts` — 바이트 단위 롤링 버퍼(스크롤백). 순수 클래스.
- `electron/pty/ring-buffer.test.ts`
- `electron/pty/chunk-input.ts` — ConPTY 입력 분할(순수 함수).
- `electron/pty/chunk-input.test.ts`
- `electron/pty/pty-manager.ts` — 단일 세션 보유, spawn/send/resize/scrollback/status/stop/dispose.
- `electron/pty/pty-manager.test.ts` — 가짜 pty 주입 단위 테스트.
- `electron/ipc/sessions.ts` — `sessions:*` 핸들러 + 이벤트 브로드캐스트.
- `src/components/XtermPane.tsx` — xterm 인스턴스 1개를 세션에 바인딩.
- `src/views/Terminal.tsx` — 터미널 화면(명령 입력 + 시작/종료 + XtermPane).
- `src/stores/session.ts` — Zustand 세션 상태.
- `vitest.config.ts` — 테스트 러너 설정.
- `NOTICE` — AO MIT 고지(루트).

**수정**
- `package.json` — deps(node-pty, @xterm/*), devDeps(vitest), scripts(test).
- `pnpm-workspace.yaml` — node-pty allowBuilds(스파이크 결과 반영).
- `scripts/rebuild-native.mjs` — (필요 시) node-pty Electron 바이너리 확보.
- `shared/types.ts` — `StartOpts`/`StartSessionInput`/`SessionInfo`/`TerminalDataPayload` + `DevConsoleApi.sessions`.
- `electron/preload.ts` — `sessions` API + 이벤트 구독 노출.
- `electron/ipc/index.ts` — `registerIpcHandlers(ptyManager)`.
- `electron/main.ts` — `PtyManager` 인스턴스화, `will-quit`에서 `disposeAll()`.
- `src/ipc-client.ts` — `sessionsApi`.
- `src/App.tsx` — 대시보드/터미널 뷰 라우팅.
- `src/views/Dashboard.tsx` — "터미널 열기" 버튼.
- `src/styles.css` — 터미널/카드 액션 스타일.
- `plan/dev-console-spec.md` — 부록 A에 `sessions:resize` 추가.

---

## Task 1: node-pty 네이티브 바이너리 스파이크 (Electron, 컴파일러 없이)

> **M2 최대 위험.** 다른 모든 코드는 node-pty가 Electron에서 로드·spawn 가능해야 의미가 있다. 먼저 이것부터 통과시킨다. 결과에 따라 사용할 패키지가 갈리므로 import는 단일 지점(`node-pty.ts`)에 모은다.

**Files:**
- Create: `electron/pty/node-pty.ts`
- Modify (temporary smoke + revert): `electron/main.ts`
- Modify (조건부): `pnpm-workspace.yaml`, `scripts/rebuild-native.mjs`, `package.json`

- [ ] **Step 1: 스왑 포인트 모듈 생성**

`electron/pty/node-pty.ts`:
```ts
// node-pty 바인딩을 여기 한 곳에서만 import한다. Task 1 스파이크 결과 패키지를
// 교체해야 하면 이 파일의 import 한 줄만 바꾸면 된다.
// (AO 차용 아님 — dev-console 고유 스왑 포인트.)
export { spawn } from 'node-pty'
export type { IPty } from 'node-pty'
```

- [ ] **Step 2: node-pty 설치 (1차 시도 = 업스트림)**

Run: `pnpm add node-pty`
- pnpm 11이 빌드 스크립트를 막는다는 경고가 나오면 기록만 하고 진행(스모크로 실제 로드 여부를 판단).

- [ ] **Step 3: 임시 스모크를 main.ts에 추가**

`electron/main.ts`의 `app.whenReady().then(() => { ... })` 안, `createWindow()` 호출 직전에 임시로 추가:
```ts
  // TEMP smoke (Task 1) — 검증 후 제거
  if (process.env.PTY_SMOKE) {
    void import('./pty/node-pty').then(({ spawn }) => {
      const p = spawn('pwsh.exe', [], {
        name: 'xterm-256color', cols: 80, rows: 24,
        cwd: process.env.USERPROFILE ?? process.cwd(),
        env: process.env as { [k: string]: string }, encoding: null
      })
      p.onData((d) => process.stdout.write('[pty] ' + (Buffer.isBuffer(d) ? d.toString('utf8') : String(d))))
      setTimeout(() => p.write('echo 안녕하세요 hello\r'), 800)
      setTimeout(() => { try { p.kill() } catch { /* noop */ } }, 2500)
    })
  }
```

- [ ] **Step 4: Electron에서 스모크 실행 + 관찰**

Run (PowerShell): `$env:PTY_SMOKE=1; pnpm dev`
Expected: `pnpm dev`를 띄운 콘솔에 `[pty] ...`가 흐르고 그 안에 **`안녕하세요 hello`** 가 깨지지 않고 보인다(한글 + spawn + 왕복이 네이티브에서 동작).

- [ ] **Step 5: 결과 분기**

- **Case A — 로드·spawn·한글 OK:** 업스트림 node-pty의 동봉 prebuilt가 Electron 33에서 동작. 추가 작업 없음. 다음 단계로.
- **Case B — 모듈 로드 실패(ABI mismatch / 바이너리 없음 / `was compiled against a different Node.js version`):** Electron prebuilt를 제공하는 포크로 교체.
  - Run: `pnpm remove node-pty; pnpm add @homebridge/node-pty-prebuilt-multiarch`
  - `electron/pty/node-pty.ts`의 import를 `from '@homebridge/node-pty-prebuilt-multiarch'`로 변경(`export { spawn }`, `export type { IPty }` 동일).
  - Step 4 재실행.
  - (대안 포크: `@lydell/node-pty` — 동일하게 import만 교체해 재시도.)
- **Case C — 포크도 실패:** 마스터에게 보고하고 멈춘다. (최후수단: 빌드툴 설치는 "MSVC 불필요" 전략 위반이므로 마스터 승인 필요.)

- [ ] **Step 6: 설치 전략을 고정**

채택한 패키지가 동봉 prebuilt로 동작하면(Case A/B 대부분) `pnpm-workspace.yaml`/`rebuild-native.mjs` 변경 불필요. 만약 설치 시 빌드 스크립트가 필요하다고 판명되면:
- `pnpm-workspace.yaml`의 `allowBuilds:`에 해당 패키지를 추가하거나 명시적으로 `false`로 두고,
- 그 패키지의 prebuilt 다운로드/배치 로직을 `scripts/rebuild-native.mjs`에 추가한다.
실제로 무엇을 했는지(어느 패키지/어떤 설정)를 `dev-console-m2-design.md` §5에 한 줄로 기록.

- [ ] **Step 7: 임시 스모크 제거**

Step 3에서 추가한 `if (process.env.PTY_SMOKE) { ... }` 블록을 `electron/main.ts`에서 삭제.
Run: `pnpm typecheck`
Expected: 통과(에러 0).

- [ ] **Step 8: Commit (마스터 승인 후)**

```bash
git add electron/pty/node-pty.ts package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/rebuild-native.mjs plan/dev-console-m2-design.md
git commit -m "M2: node-pty Electron 바이너리 확보 + 스왑 포인트 모듈"
```

---

## Task 2: 테스트 러너(vitest) 설정

> 순수 로직(링버퍼·청킹·PtyManager)을 TDD하기 위한 러너. node 환경, Electron/node-pty 네이티브 불필요(가짜 주입).

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: vitest 설치**

Run: `pnpm add -D vitest`

- [ ] **Step 2: 설정 파일 작성**

`vitest.config.ts`:
```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts', 'shared/**/*.test.ts']
  }
})
```

- [ ] **Step 3: 스크립트 추가**

`package.json`의 `scripts`에 추가:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: 러너 동작 확인**

Run: `pnpm test`
Expected: "No test files found" (아직 테스트 없음) — 러너가 정상 기동했다는 의미. 에러로 죽지 않으면 OK.

- [ ] **Step 5: Commit (마스터 승인 후)**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml
git commit -m "M2: vitest 테스트 러너 추가"
```

---

## Task 3: RingBuffer (바이트 롤링 버퍼, TDD)

> 스크롤백 replay용. **바이트로 저장**(디코딩 텍스트 아님) → 멀티바이트 UTF-8(한글)이 청크 경계에서 깨지지 않음. AO `pty-host.ts` outputBuffer 로직 차용(🟡).

**Files:**
- Create: `electron/pty/ring-buffer.test.ts`
- Create: `electron/pty/ring-buffer.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`electron/pty/ring-buffer.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { RingBuffer } from './ring-buffer'

describe('RingBuffer', () => {
  it('빈 버퍼는 빈 Buffer를 replay한다', () => {
    expect(new RingBuffer(100).replay()).toEqual(Buffer.alloc(0))
  })

  it('append한 청크를 순서대로 이어붙여 replay한다', () => {
    const rb = new RingBuffer(100)
    rb.append(Buffer.from('가'))   // 3 bytes (UTF-8)
    rb.append(Buffer.from('나'))
    expect(rb.replay().toString('utf-8')).toBe('가나')
  })

  it('maxBytes 초과 시 가장 오래된 청크부터 버린다', () => {
    const rb = new RingBuffer(6) // '가'(3)+'나'(3)=6 OK, +'다' → '가' 탈락
    rb.append(Buffer.from('가'))
    rb.append(Buffer.from('나'))
    rb.append(Buffer.from('다'))
    expect(rb.replay().toString('utf-8')).toBe('나다')
  })

  it('단일 청크가 maxBytes보다 커도 최신 청크는 유지한다', () => {
    const rb = new RingBuffer(2)
    rb.append(Buffer.from('가')) // 3 bytes > 2
    expect(rb.replay().toString('utf-8')).toBe('가')
  })

  it('clear()는 버퍼를 비운다', () => {
    const rb = new RingBuffer(100)
    rb.append(Buffer.from('x'))
    rb.clear()
    expect(rb.replay()).toEqual(Buffer.alloc(0))
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './ring-buffer'` 또는 `RingBuffer is not defined`.

- [ ] **Step 3: 최소 구현**

`electron/pty/ring-buffer.ts`:
```ts
// 최근 PTY 출력의 롤링 바이트 버퍼. (재)attach 시 스크롤백 replay용.
// 디코딩하지 않고 raw 바이트로 보관 → 멀티바이트 UTF-8(한글 등)이 청크 경계에서
// 깨지지 않는다.
// adapted from agent-orchestrator/packages/plugins/runtime-process/src/pty-host.ts (MIT)
export class RingBuffer {
  private chunks: Buffer[] = []
  private bytes = 0

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer): void {
    this.chunks.push(chunk)
    this.bytes += chunk.length
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!
      this.bytes -= dropped.length
    }
  }

  replay(): Buffer {
    return Buffer.concat(this.chunks)
  }

  clear(): void {
    this.chunks = []
    this.bytes = 0
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test`
Expected: PASS (RingBuffer 5개 통과).

- [ ] **Step 5: Commit (마스터 승인 후)**

```bash
git add electron/pty/ring-buffer.ts electron/pty/ring-buffer.test.ts
git commit -m "M2: RingBuffer (바이트 스크롤백 버퍼)"
```

---

## Task 4: chunkInput (ConPTY 입력 분할, TDD)

> Windows ConPTY는 단일 `pty.write()`가 입력 버퍼(~3–4KB)를 넘으면 바이트를 조용히 버린다. 큰 입력(붙여넣기)을 작게 쪼갠다. AO `pty-client.ts` 차용(🟢). M2는 자동 Enter 주입 없음(사용자가 직접 Enter; 자동 제출은 M3).

**Files:**
- Create: `electron/pty/chunk-input.test.ts`
- Create: `electron/pty/chunk-input.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`electron/pty/chunk-input.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { chunkInput } from './chunk-input'

describe('chunkInput', () => {
  it('빈 문자열은 빈 배열', () => {
    expect(chunkInput('', 4)).toEqual([])
  })
  it('size 이하면 통째로 한 조각', () => {
    expect(chunkInput('abc', 4)).toEqual(['abc'])
    expect(chunkInput('abcd', 4)).toEqual(['abcd'])
  })
  it('size 초과면 size 단위로 분할', () => {
    expect(chunkInput('abcdef', 4)).toEqual(['abcd', 'ef'])
  })
  it('분할 후 이어붙이면 원본과 동일', () => {
    const s = 'x'.repeat(1300)
    expect(chunkInput(s, 512).join('')).toBe(s)
  })
  it('size가 0 이하면 예외', () => {
    expect(() => chunkInput('a', 0)).toThrow()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './chunk-input'`.

- [ ] **Step 3: 최소 구현**

`electron/pty/chunk-input.ts`:
```ts
// 문자열을 size 길이(UTF-16 코드유닛) 이하 조각으로 분할.
// Windows ConPTY가 큰 단일 write에서 바이트를 버리는 문제를 회피한다.
// adapted from agent-orchestrator/packages/plugins/runtime-process/src/pty-client.ts (MIT)
export function chunkInput(data: string, size = 512): string[] {
  if (size <= 0) throw new Error('chunk size must be positive')
  if (data.length === 0) return []
  if (data.length <= size) return [data]
  const out: string[] = []
  for (let i = 0; i < data.length; i += size) {
    out.push(data.slice(i, i + size))
  }
  return out
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test`
Expected: PASS (chunkInput 5개 통과).

- [ ] **Step 5: Commit (마스터 승인 후)**

```bash
git add electron/pty/chunk-input.ts electron/pty/chunk-input.test.ts
git commit -m "M2: chunkInput (ConPTY 입력 분할)"
```

---

## Task 5: PtyManager (단일 세션 코어, TDD with 가짜 pty)

> 진짜 node-pty 왕복은 Electron에서만 검증 가능(Task 11)하므로, 여기선 `spawnFn`을 **주입**해 가짜 pty로 와이어링 로직(상태/버퍼/청킹 send/teardown)을 단위 테스트한다. 실 spawn은 main.ts가 주입(Task 7).

**Files:**
- Create: `electron/pty/pty-manager.test.ts`
- Create: `electron/pty/pty-manager.ts`
- Depends on: shared 타입(`StartOpts`, `SessionInfo`) — Task 6에서 정식 추가하지만, 본 태스크가 먼저 오므로 **이 태스크 Step 1에서 shared/types.ts에 타입만 선반영**한다(아래 Step 1).

- [ ] **Step 1: shared 타입 선반영**

`shared/types.ts` 끝에 추가(기존 `SessionStatus` 문자열 유니온과 충돌 금지 — 런타임 객체는 `SessionInfo`):
```ts
/** M2 PtyManager 입력 (spec §6 M2, design D3 범용 명령). */
export interface StartOpts {
  command: string
  args: string[]
  cwd: string
  cols?: number
  rows?: number
}

/** M2 단일 세션 런타임 정보. (lifecycle 문자열 유니온 `SessionStatus`와 별개 — M2는 running/exited만.) */
export interface SessionInfo {
  sessionId: string
  status: 'running' | 'exited'
  pid: number
  exitCode?: number
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`electron/pty/pty-manager.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PtyManager, type SpawnFn } from './pty-manager'

interface FakePty {
  pid: number
  written: string[]
  killed: boolean
  resized: Array<[number, number]>
  onData(cb: (d: Buffer) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(d: string): void
  resize(c: number, r: number): void
  kill(): void
  _emitData(buf: Buffer): void
  _emitExit(code: number): void
}

function makeFakePty(pid = 4321): FakePty {
  const dataCbs: Array<(d: Buffer) => void> = []
  const exitCbs: Array<(e: { exitCode: number }) => void> = []
  return {
    pid, written: [], killed: false, resized: [],
    onData(cb) { dataCbs.push(cb) },
    onExit(cb) { exitCbs.push(cb) },
    write(d) { this.written.push(d) },
    resize(c, r) { this.resized.push([c, r]) },
    kill() { this.killed = true },
    _emitData(buf) { dataCbs.forEach((cb) => cb(buf)) },
    _emitExit(code) { exitCbs.forEach((cb) => cb({ exitCode: code })) }
  }
}

describe('PtyManager', () => {
  let fake: FakePty
  let spawnFn: SpawnFn

  beforeEach(() => {
    fake = makeFakePty()
    spawnFn = vi.fn(() => fake as never)
  })

  it('start는 running 상태와 pid를 반환한다', () => {
    const mgr = new PtyManager(spawnFn)
    const info = mgr.start({ command: 'pwsh', args: [], cwd: 'C:\\' })
    expect(info.status).toBe('running')
    expect(info.pid).toBe(4321)
    expect(spawnFn).toHaveBeenCalledOnce()
  })

  it('pty 출력을 링버퍼에 적재하고 onData 콜백으로 전달한다', () => {
    const mgr = new PtyManager(spawnFn)
    const seen: Buffer[] = []
    mgr.onData((_id, data) => seen.push(data))
    const info = mgr.start({ command: 'pwsh', args: [], cwd: 'C:\\' })
    fake._emitData(Buffer.from('가나'))
    expect(seen[0].toString('utf-8')).toBe('가나')
    expect(mgr.getScrollback(info.sessionId).toString('utf-8')).toBe('가나')
  })

  it('짧은 입력은 그대로 한 번 write', () => {
    const mgr = new PtyManager(spawnFn)
    const info = mgr.start({ command: 'pwsh', args: [], cwd: 'C:\\' })
    mgr.send(info.sessionId, 'ls\r')
    expect(fake.written).toEqual(['ls\r'])
  })

  it('512자 초과 입력은 청킹하여 여러 번 write (타이머 진행 필요)', () => {
    vi.useFakeTimers()
    const mgr = new PtyManager(spawnFn)
    const info = mgr.start({ command: 'pwsh', args: [], cwd: 'C:\\' })
    const big = 'x'.repeat(1100) // 512+512+76 → 3조각
    mgr.send(info.sessionId, big)
    expect(fake.written.length).toBe(1)      // 첫 조각 즉시
    vi.runAllTimers()
    expect(fake.written.length).toBe(3)
    expect(fake.written.join('')).toBe(big)
    vi.useRealTimers()
  })

  it('resize는 살아있는 세션에 전달된다', () => {
    const mgr = new PtyManager(spawnFn)
    const info = mgr.start({ command: 'pwsh', args: [], cwd: 'C:\\' })
    mgr.resize(info.sessionId, 120, 40)
    expect(fake.resized).toEqual([[120, 40]])
  })

  it('pty 종료 시 status가 exited로 바뀌고 onStatus 콜백 호출', () => {
    const mgr = new PtyManager(spawnFn)
    const infos: Array<{ status: string; exitCode?: number }> = []
    mgr.onStatus((i) => infos.push(i))
    const info = mgr.start({ command: 'pwsh', args: [], cwd: 'C:\\' })
    fake._emitExit(0)
    expect(mgr.status(info.sessionId)?.status).toBe('exited')
    expect(infos.at(-1)).toMatchObject({ status: 'exited', exitCode: 0 })
  })

  it('종료된 세션에는 write하지 않는다', () => {
    const mgr = new PtyManager(spawnFn)
    const info = mgr.start({ command: 'pwsh', args: [], cwd: 'C:\\' })
    fake._emitExit(1)
    mgr.send(info.sessionId, 'x')
    expect(fake.written).toEqual([])
  })

  it('stop은 pty.kill 후 세션을 비운다', () => {
    const mgr = new PtyManager(spawnFn)
    const info = mgr.start({ command: 'pwsh', args: [], cwd: 'C:\\' })
    mgr.stop(info.sessionId)
    expect(fake.killed).toBe(true)
    expect(mgr.status(info.sessionId)).toBeNull()
  })

  it('start 재호출 시 이전 세션을 정리(교체)한다', () => {
    const mgr = new PtyManager(spawnFn)
    const first = makeFakePty(1)
    const second = makeFakePty(2)
    let n = 0
    const sf = vi.fn(() => (n++ === 0 ? first : second) as never)
    const mgr2 = new PtyManager(sf as SpawnFn)
    mgr2.start({ command: 'pwsh', args: [], cwd: 'C:\\' })
    mgr2.start({ command: 'pwsh', args: [], cwd: 'C:\\' })
    expect(first.killed).toBe(true)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './pty-manager'`.

- [ ] **Step 4: 최소 구현**

`electron/pty/pty-manager.ts`:
```ts
import type { IPty } from 'node-pty'
import type { SessionInfo, StartOpts } from '@shared/types'
import { RingBuffer } from './ring-buffer'
import { chunkInput } from './chunk-input'

export type SpawnFn = (
  file: string,
  args: string[],
  opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; encoding: null }
) => IPty

const MAX_SCROLLBACK_BYTES = 256 * 1024
const CHUNK_THRESHOLD = 512
const CHUNK_DELAY_MS = 15
const WIN_SHELLS = new Set(['pwsh', 'powershell', 'cmd', 'bash', 'wsl'])

// Windows에서 bare 셸 이름엔 .exe를 붙인다(node-pty 요구). 그 외 명령/경로는 그대로.
// adapted from agent-orchestrator/packages/plugins/runtime-process/src/pty-host.ts (MIT)
function resolveCommand(cmd: string): string {
  if (process.platform !== 'win32') return cmd
  if (cmd.includes('\\') || cmd.includes('/') || cmd.includes('.')) return cmd
  return WIN_SHELLS.has(cmd.toLowerCase()) ? `${cmd}.exe` : cmd
}

interface Session {
  id: string
  pty: IPty
  buffer: RingBuffer
  info: SessionInfo
}

export class PtyManager {
  private session: Session | null = null
  private dataCb: ((sessionId: string, data: Buffer) => void) | null = null
  private statusCb: ((info: SessionInfo) => void) | null = null
  private seq = 0

  constructor(private readonly spawnFn: SpawnFn) {}

  onData(cb: (sessionId: string, data: Buffer) => void): void { this.dataCb = cb }
  onStatus(cb: (info: SessionInfo) => void): void { this.statusCb = cb }

  start(opts: StartOpts): SessionInfo {
    // M2: 단일 세션 — 기존 것이 있으면 정리 후 교체.
    if (this.session) this.stop(this.session.id)
    const id = `s${++this.seq}`
    const pty = this.spawnFn(resolveCommand(opts.command), opts.args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd,
      env: process.env,
      encoding: null
    })
    const info: SessionInfo = { sessionId: id, status: 'running', pid: pty.pid }
    const session: Session = { id, pty, buffer: new RingBuffer(MAX_SCROLLBACK_BYTES), info }
    this.session = session

    pty.onData((data: string | Buffer) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8')
      session.buffer.append(buf)
      this.dataCb?.(id, buf)
    })
    pty.onExit(({ exitCode }: { exitCode: number }) => {
      session.info = { sessionId: id, status: 'exited', pid: pty.pid, exitCode }
      this.statusCb?.(session.info)
    })
    return info
  }

  send(sessionId: string, data: string): void {
    const s = this.session
    if (!s || s.id !== sessionId || s.info.status !== 'running') return
    if (data.length <= CHUNK_THRESHOLD) { s.pty.write(data); return }
    const parts = chunkInput(data, CHUNK_THRESHOLD)
    let i = 0
    const writeNext = (): void => {
      const cur = this.session
      if (!cur || cur.id !== sessionId || cur.info.status !== 'running' || i >= parts.length) return
      cur.pty.write(parts[i++])
      if (i < parts.length) setTimeout(writeNext, CHUNK_DELAY_MS)
    }
    writeNext()
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.session
    if (!s || s.id !== sessionId || s.info.status !== 'running') return
    try { s.pty.resize(cols, rows) } catch { /* 일시적 resize 오류 무시 */ }
  }

  getScrollback(sessionId: string): Buffer {
    const s = this.session
    return s && s.id === sessionId ? s.buffer.replay() : Buffer.alloc(0)
  }

  status(sessionId: string): SessionInfo | null {
    return this.session && this.session.id === sessionId ? this.session.info : null
  }

  stop(sessionId: string): void {
    const s = this.session
    if (!s || s.id !== sessionId) return
    try { if (s.info.status === 'running') s.pty.kill() } catch { /* 이미 죽음 */ }
    this.session = null
  }

  disposeAll(): void {
    if (this.session) this.stop(this.session.id)
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm test`
Expected: PASS (PtyManager 9개 포함 전체 통과).
Run: `pnpm typecheck`
Expected: 통과.

- [ ] **Step 6: Commit (마스터 승인 후)**

```bash
git add electron/pty/pty-manager.ts electron/pty/pty-manager.test.ts shared/types.ts
git commit -m "M2: PtyManager 단일 세션 코어"
```

---

## Task 6: shared 타입 + preload + ipc-client (API 표면)

> Main↔Renderer 계약. `sessions:*` invoke + `session:*` 이벤트 구독. (spec 부록 A 정렬.)

**Files:**
- Modify: `shared/types.ts`
- Modify: `electron/preload.ts`
- Modify: `src/ipc-client.ts`

- [ ] **Step 1: shared/types.ts에 IPC 입력/이벤트 타입 + API 표면 추가**

`shared/types.ts`에 추가(`StartOpts`/`SessionInfo`는 Task 5에서 이미 추가됨):
```ts
/** sessions:start IPC 입력 = StartOpts + 어느 프로젝트인지. */
export interface StartSessionInput extends StartOpts {
  projectId: string
}

/** session:terminalData 이벤트 페이로드. data는 렌더러에서 Uint8Array로 도착. */
export interface TerminalDataPayload {
  sessionId: string
  data: Uint8Array
}
```
그리고 기존 `DevConsoleApi` 인터페이스에 `sessions` 묶음 추가:
```ts
  sessions: {
    start(input: StartSessionInput): Promise<SessionInfo>
    stop(sessionId: string): Promise<void>
    send(sessionId: string, data: string): Promise<void>
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    attachTerminal(sessionId: string): Promise<SessionInfo | null>
    detachTerminal(sessionId: string): Promise<void>
    /** 구독 등록. 반환된 함수를 호출하면 해제. */
    onTerminalData(cb: (sessionId: string, data: Uint8Array) => void): () => void
    onStatusChange(cb: (info: SessionInfo) => void): () => void
  }
```
(`StartSessionInput`, `SessionInfo`, `TerminalDataPayload`가 `DevConsoleApi` 정의 위에 오도록 순서 정리.)

- [ ] **Step 2: preload.ts에 sessions API 노출**

`electron/preload.ts`를 다음으로 교체:
```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CreateProjectInput, DevConsoleApi, StartSessionInput, SessionInfo, TerminalDataPayload
} from '@shared/types'

const api: DevConsoleApi = {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input: CreateProjectInput) => ipcRenderer.invoke('projects:create', input),
    delete: (id: string) => ipcRenderer.invoke('projects:delete', id)
  },
  sessions: {
    start: (input: StartSessionInput) => ipcRenderer.invoke('sessions:start', input),
    stop: (sessionId: string) => ipcRenderer.invoke('sessions:stop', { sessionId }),
    send: (sessionId: string, data: string) => ipcRenderer.invoke('sessions:send', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('sessions:resize', { sessionId, cols, rows }),
    attachTerminal: (sessionId: string) => ipcRenderer.invoke('sessions:attachTerminal', { sessionId }),
    detachTerminal: (sessionId: string) => ipcRenderer.invoke('sessions:detachTerminal', { sessionId }),
    onTerminalData: (cb) => {
      const listener = (_e: IpcRendererEvent, payload: TerminalDataPayload): void =>
        cb(payload.sessionId, payload.data)
      ipcRenderer.on('session:terminalData', listener)
      return () => ipcRenderer.removeListener('session:terminalData', listener)
    },
    onStatusChange: (cb) => {
      const listener = (_e: IpcRendererEvent, info: SessionInfo): void => cb(info)
      ipcRenderer.on('session:statusChange', listener)
      return () => ipcRenderer.removeListener('session:statusChange', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 3: ipc-client.ts에 sessionsApi 추가**

`src/ipc-client.ts`에 추가:
```ts
import type { StartSessionInput, SessionInfo } from '@shared/types'

export const sessionsApi = {
  start: (input: StartSessionInput): Promise<SessionInfo> => window.api.sessions.start(input),
  stop: (sessionId: string): Promise<void> => window.api.sessions.stop(sessionId),
  send: (sessionId: string, data: string): Promise<void> => window.api.sessions.send(sessionId, data),
  resize: (sessionId: string, cols: number, rows: number): Promise<void> =>
    window.api.sessions.resize(sessionId, cols, rows),
  attachTerminal: (sessionId: string): Promise<SessionInfo | null> =>
    window.api.sessions.attachTerminal(sessionId),
  detachTerminal: (sessionId: string): Promise<void> => window.api.sessions.detachTerminal(sessionId),
  onTerminalData: (cb: (sessionId: string, data: Uint8Array) => void): (() => void) =>
    window.api.sessions.onTerminalData(cb),
  onStatusChange: (cb: (info: SessionInfo) => void): (() => void) =>
    window.api.sessions.onStatusChange(cb)
}
```

- [ ] **Step 4: 타입체크**

Run: `pnpm typecheck`
Expected: 통과(에러 0).

- [ ] **Step 5: Commit (마스터 승인 후)**

```bash
git add shared/types.ts electron/preload.ts src/ipc-client.ts
git commit -m "M2: sessions IPC API 표면 (types/preload/client)"
```

---

## Task 7: IPC 핸들러(sessions.ts) + main.ts 와이어링

> `PtyManager`를 Main에 인스턴스화하고 핸들러 등록. onData/onStatus를 webContents로 브로드캐스트. attach 시 스크롤백을 그 webContents에 먼저 전송(순서 보장). `will-quit`에서 `disposeAll()`(ConPTY teardown).

**Files:**
- Create: `electron/ipc/sessions.ts`
- Modify: `electron/ipc/index.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: sessions 핸들러 작성**

`electron/ipc/sessions.ts`:
```ts
import { ipcMain, BrowserWindow, type WebContents } from 'electron'
import type { PtyManager } from '../pty/pty-manager'
import type { StartSessionInput, SessionInfo, TerminalDataPayload } from '@shared/types'

// 터미널 뷰가 attach한 webContents 집합. live 출력은 여기로만 브로드캐스트.
export function registerSessionHandlers(ptyManager: PtyManager): void {
  const attached = new Set<WebContents>()

  ptyManager.onData((sessionId, data) => {
    const payload: TerminalDataPayload = { sessionId, data }
    for (const wc of attached) {
      if (wc.isDestroyed()) attached.delete(wc)
      else wc.send('session:terminalData', payload)
    }
  })
  ptyManager.onStatus((info: SessionInfo) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('session:statusChange', info)
    }
  })

  ipcMain.handle('sessions:start', (_e, input: StartSessionInput): SessionInfo =>
    ptyManager.start({ command: input.command, args: input.args, cwd: input.cwd, cols: input.cols, rows: input.rows })
  )
  ipcMain.handle('sessions:stop', (_e, { sessionId }: { sessionId: string }): void =>
    ptyManager.stop(sessionId)
  )
  ipcMain.handle('sessions:send', (_e, { sessionId, data }: { sessionId: string; data: string }): void =>
    ptyManager.send(sessionId, data)
  )
  ipcMain.handle('sessions:resize', (_e, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }): void =>
    ptyManager.resize(sessionId, cols, rows)
  )
  ipcMain.handle('sessions:attachTerminal', (e, { sessionId }: { sessionId: string }): SessionInfo | null => {
    attached.add(e.sender)
    // 스크롤백을 이 webContents에 먼저 보낸다. 이후 live onData는 같은 채널로
    // 뒤이어 도착하므로 순서가 보장된다(렌더러는 attach 전에 구독을 등록해 둠).
    const scrollback = ptyManager.getScrollback(sessionId)
    if (scrollback.length > 0) {
      const payload: TerminalDataPayload = { sessionId, data: scrollback }
      e.sender.send('session:terminalData', payload)
    }
    return ptyManager.status(sessionId)
  })
  ipcMain.handle('sessions:detachTerminal', (e, _arg: { sessionId: string }): void => {
    attached.delete(e.sender)
  })
}
```

- [ ] **Step 2: index.ts가 ptyManager를 받아 등록**

`electron/ipc/index.ts`를 교체:
```ts
import { registerProjectHandlers } from './projects'
import { registerSessionHandlers } from './sessions'
import type { PtyManager } from '../pty/pty-manager'

// 모든 IPC 핸들러 등록 진입점 (spec 부록 A). 마일스톤마다 확장.
export function registerIpcHandlers(ptyManager: PtyManager): void {
  registerProjectHandlers()
  registerSessionHandlers(ptyManager)
}
```

- [ ] **Step 3: main.ts에서 PtyManager 인스턴스화 + teardown 연결**

`electron/main.ts` 수정:
1) import 추가(상단):
```ts
import { PtyManager } from './pty/pty-manager'
import { spawn as nodePtySpawn } from './pty/node-pty'
```
2) 모듈 스코프에 인스턴스 생성(`createWindow` 정의 위):
```ts
// PTY는 Main이 소유한다(절대원칙 #1). env는 node-pty가 요구하는 형태로 캐스팅.
const ptyManager = new PtyManager((file, args, opts) =>
  nodePtySpawn(file, args, { ...opts, env: opts.env as { [k: string]: string } })
)
```
3) `registerIpcHandlers()` 호출을 `registerIpcHandlers(ptyManager)`로 변경.
4) `will-quit` 핸들러를 다음으로 교체(PTY를 먼저 정리해 ConPTY helper의 WER 0x800700e8 회피):
```ts
app.on('will-quit', () => {
  ptyManager.disposeAll()
  closeDatabase()
})
```

- [ ] **Step 4: 타입체크 + 빌드**

Run: `pnpm typecheck`
Expected: 통과.
Run: `pnpm build`
Expected: 성공(out/ 생성, 에러 0).

- [ ] **Step 5: Commit (마스터 승인 후)**

```bash
git add electron/ipc/sessions.ts electron/ipc/index.ts electron/main.ts
git commit -m "M2: sessions IPC 핸들러 + Main PtyManager 와이어링"
```

---

## Task 8: xterm 패키지 + XtermPane + Terminal 화면 + 스타일

> 표시는 xterm.js(@xterm/*). XtermPane은 인스턴스 1개를 세션에 바인딩하고, 언마운트 시 **detach만**(PTY 안 죽임). xterm 와이어링 패턴 AO `useXtermTerminal.ts` 차용(🟡, ws→IPC).

**Files:**
- Modify: `package.json` (xterm deps)
- Create: `src/components/XtermPane.tsx`
- Create: `src/views/Terminal.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: xterm 설치**

Run: `pnpm add @xterm/xterm @xterm/addon-fit @xterm/addon-web-links`

- [ ] **Step 2: XtermPane 작성**

`src/components/XtermPane.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { sessionsApi } from '@/ipc-client'

// xterm 인스턴스 1개를 Main의 PTY 세션에 IPC로 바인딩한다.
// 언마운트 시 detach(구독 해제)만 하고 PTY는 죽이지 않는다(절대원칙 #2).
// 재마운트하면 Main에서 스크롤백을 replay받는다.
// 패턴 adapted from agent-orchestrator/packages/web/src/components/terminal/useXtermTerminal.ts (MIT)
export default function XtermPane({ sessionId }: { sessionId: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Cascadia Code, Consolas, ui-monospace, monospace',
      theme: { background: '#121110', foreground: '#f0ece8' },
      allowProposedApi: true,
      scrollback: 5000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    fit.fit()

    // attach 전에 먼저 구독해야 스크롤백 이벤트를 놓치지 않는다.
    const unsub = sessionsApi.onTerminalData((id, data) => {
      if (id === sessionId) term.write(data)
    })
    const inputDisposable = term.onData((data) => { void sessionsApi.send(sessionId, data) })

    const syncSize = (): void => {
      try { fit.fit(); void sessionsApi.resize(sessionId, term.cols, term.rows) } catch { /* ignore */ }
    }
    const ro = new ResizeObserver(syncSize)
    ro.observe(host)

    // attach → 스크롤백 replay + 이후 live 출력. 끝나면 현재 크기를 PTY에 맞춤.
    void sessionsApi.attachTerminal(sessionId).then(syncSize)
    term.focus()

    return () => {
      void sessionsApi.detachTerminal(sessionId)  // PTY는 살려둔다
      unsub()
      inputDisposable.dispose()
      ro.disconnect()
      term.dispose()
    }
  }, [sessionId])

  return <div className="terminal-host" ref={hostRef} />
}
```

- [ ] **Step 3: Terminal 화면 작성**

`src/views/Terminal.tsx`:
```tsx
import { useSessionStore } from '@/stores/session'
import XtermPane from '@/components/XtermPane'
import type { Project } from '@shared/types'

export default function Terminal({
  project,
  onBack
}: {
  project: Project
  onBack: () => void
}): React.JSX.Element {
  const { sessionId, status, command, setCommand, start, stop } = useSessionStore()

  return (
    <section className="terminal">
      <div className="terminal__bar">
        <button className="btn" onClick={onBack}>← 대시보드</button>
        <input
          className="input terminal__cmd"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="실행할 명령 (예: pwsh, claude)"
        />
        <button className="btn btn--primary" onClick={() => void start(project.id, project.workspacePath)}>
          {sessionId ? '재시작' : '시작'}
        </button>
        <button className="btn btn--ghost-danger" onClick={() => void stop()} disabled={!sessionId}>
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

- [ ] **Step 4: 스타일 추가**

`src/styles.css` 끝에 추가:
```css
/* M2 터미널 */
.card__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.terminal {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 10px;
}

.terminal__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.terminal__cmd {
  flex: 1;
  min-width: 160px;
  font-family: var(--font-mono);
}

.terminal__status {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.terminal-host {
  flex: 1;
  min-height: 0;
  background: #121110;
  padding: 6px;
  border: 1px solid var(--border);
}
```

- [ ] **Step 5: 타입체크**

Run: `pnpm typecheck`
Expected: 통과. (아직 Terminal/XtermPane은 App에서 렌더되지 않지만 import는 Task 9에서 연결.)

- [ ] **Step 6: Commit (마스터 승인 후)**

```bash
git add package.json pnpm-lock.yaml src/components/XtermPane.tsx src/views/Terminal.tsx src/styles.css
git commit -m "M2: xterm 패키지 + XtermPane + Terminal 화면"
```

---

## Task 9: 세션 store + App 라우팅 + Dashboard 버튼

> Zustand 세션 store(명령/상태/start/stop), 상태 이벤트 구독으로 PTY 종료를 UI에 반영. App에 대시보드↔터미널 뷰 전환. 카드에 "터미널 열기".

**Files:**
- Create: `src/stores/session.ts`
- Modify: `src/App.tsx`
- Modify: `src/views/Dashboard.tsx`

- [ ] **Step 1: 세션 store 작성**

`src/stores/session.ts`:
```ts
import { create } from 'zustand'
import { sessionsApi } from '@/ipc-client'
import type { SessionInfo } from '@shared/types'

interface SessionState {
  sessionId: string | null
  status: SessionInfo['status'] | null
  command: string
  projectId: string | null
  setCommand: (c: string) => void
  start: (projectId: string, cwd: string) => Promise<void>
  stop: () => Promise<void>
}

export const useSessionStore = create<SessionState>((set, get) => {
  // 1회: Main의 상태 변경(예: PTY 종료)을 UI에 반영.
  sessionsApi.onStatusChange((info) => {
    if (info.sessionId === get().sessionId) set({ status: info.status })
  })
  return {
    sessionId: null,
    status: null,
    command: 'pwsh', // Windows 기본 셸. claude는 이 셸 안에서 입력(M2 비목표 — Preamble 참고).
    projectId: null,
    setCommand: (c) => set({ command: c }),
    start: async (projectId, cwd) => {
      const info = await sessionsApi.start({ projectId, command: get().command, args: [], cwd })
      set({ sessionId: info.sessionId, status: info.status, projectId })
    },
    stop: async () => {
      const id = get().sessionId
      if (!id) return
      await sessionsApi.stop(id)
      set({ sessionId: null, status: null })
    }
  }
})
```

- [ ] **Step 2: App 라우팅**

`src/App.tsx`를 교체:
```tsx
import { useState } from 'react'
import Dashboard from './views/Dashboard'
import Terminal from './views/Terminal'
import type { Project } from '@shared/types'

export default function App(): React.JSX.Element {
  const [active, setActive] = useState<Project | null>(null)

  return (
    <div className="app">
      <header className="app__topbar">
        <span className="app__brand">개발 상황판</span>
        <span className="app__tag">DEV CONSOLE · M2</span>
      </header>
      <main className="app__main">
        {active ? (
          <Terminal project={active} onBack={() => setActive(null)} />
        ) : (
          <Dashboard onOpenTerminal={setActive} />
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Dashboard에 "터미널 열기" 버튼**

`src/views/Dashboard.tsx` 수정:
1) 타입 import 추가:
```ts
import type { CreateProjectInput, Project } from '@shared/types'
```
2) 컴포넌트 시그니처를 prop 받도록:
```tsx
export default function Dashboard({
  onOpenTerminal
}: {
  onOpenTerminal: (p: Project) => void
}): React.JSX.Element {
```
3) 카드의 삭제 버튼을 액션 묶음으로 교체:
```tsx
              <div className="card__actions">
                <button className="btn" onClick={() => onOpenTerminal(p)}>
                  터미널 열기
                </button>
                <button className="btn btn--ghost-danger" onClick={() => void remove(p.id)}>
                  삭제
                </button>
              </div>
```
(기존 단독 `<button ... >삭제</button>`를 위 블록으로 대체.)

- [ ] **Step 4: 타입체크 + 빌드**

Run: `pnpm typecheck`
Expected: 통과.
Run: `pnpm build`
Expected: 성공.

- [ ] **Step 5: Commit (마스터 승인 후)**

```bash
git add src/stores/session.ts src/App.tsx src/views/Dashboard.tsx
git commit -m "M2: 세션 store + 대시보드/터미널 뷰 라우팅"
```

---

## Task 10: MIT 컴플라이언스(NOTICE + 출처 주석) + spec 부록 A 갱신

> AO 코드를 **실제로 처음 복사**하는 마일스톤이므로 AGENTS.md §차용 규칙 의무 이행. (출처 주석은 Task 3·4·5·8에서 이미 각 파일 상단에 넣었음 — 여기서 누락 점검 + NOTICE 신설.)

**Files:**
- Create: `NOTICE`
- Modify: `plan/dev-console-spec.md`
- 점검: `electron/pty/ring-buffer.ts`, `electron/pty/chunk-input.ts`, `electron/pty/pty-manager.ts`(resolveCommand), `src/components/XtermPane.tsx`

- [ ] **Step 1: NOTICE 생성**

`NOTICE` (루트):
```
This product includes code adapted from agent-orchestrator
(https://github.com/composio/agent-orchestrator), licensed under the MIT License.

The following files contain logic adapted from agent-orchestrator (see the
per-file "adapted from ..." headers for specifics):
  - electron/pty/ring-buffer.ts
  - electron/pty/chunk-input.ts
  - electron/pty/pty-manager.ts        (resolveCommand: Windows shell .exe 해석)
  - src/components/XtermPane.tsx        (xterm 와이어링 패턴)

---------------------------------------------------------------------------
agent-orchestrator — MIT License

MIT License

Copyright (c) 2025 Composio, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
> AO의 실제 GitHub URL이 다르면 Step에서 한 줄 수정. (LICENSE 저작권자 = Composio, Inc. 확인됨.)

- [ ] **Step 2: 출처 주석 누락 점검**

각 차용 파일 상단에 `// adapted from agent-orchestrator/... (MIT)` 주석이 있는지 확인. 없으면 추가:
- `ring-buffer.ts`, `chunk-input.ts` → 있음(Task 3·4).
- `pty-manager.ts`의 `resolveCommand` 위 → 있음(Task 5).
- `XtermPane.tsx` 상단 → 있음(Task 8).

- [ ] **Step 3: spec 부록 A에 sessions:resize 추가**

`plan/dev-console-spec.md`의 부록 A "Renderer → Main" 목록에서
```
'sessions:start' | 'sessions:stop' | 'sessions:send'
'sessions:attachTerminal' | 'sessions:detachTerminal'
```
를
```
'sessions:start' | 'sessions:stop' | 'sessions:send' | 'sessions:resize'
'sessions:attachTerminal' | 'sessions:detachTerminal'
```
로 수정.

- [ ] **Step 4: Commit (마스터 승인 후)**

```bash
git add NOTICE plan/dev-console-spec.md
git commit -m "M2: AO MIT NOTICE + 출처 주석 점검 + spec 부록A sessions:resize"
```

---

## Task 11: 전체 수동 검증 (ConPTY 합격 기준)

> 자동 테스트로는 닿지 않는 실 ConPTY 동작을 사람이 확인. `dev-console-m2-design.md` §6 합격 기준 그대로.

**Files:** 없음(검증만). 발견된 버그는 systematic-debugging으로 처리 후 해당 Task로 회귀.

- [ ] **Step 1: 앱 실행**

Run: `pnpm dev`
Expected: 앱이 뜨고 대시보드가 보인다. 프로젝트가 없으면 "+ 프로젝트 추가"로 워크스페이스 1개 등록(예: `C:\AI_project\testbed\dev-console`).

- [ ] **Step 2: PowerShell 왕복 (명령 = pwsh, 기본값)**

카드의 "터미널 열기" → 명령 입력이 `pwsh`인 상태로 "시작".
- [ ] 검은 터미널에 PowerShell 프롬프트가 뜬다(상태 = ● 실행 중).
- [ ] 키 입력이 그대로 보인다(왕복).

- [ ] **Step 3: 한글 (합격 기준)**

터미널에 `echo 안녕하세요 마스터` 입력 → Enter.
- [ ] 입력·출력 한글이 **깨지지 않는다**.

- [ ] **Step 4: 색상 (합격 기준)**

`Write-Host "RED" -ForegroundColor Red; Write-Host "GREEN" -ForegroundColor Green` 입력 → Enter.
- [ ] 빨강/초록 ANSI 색이 제대로 렌더된다.

- [ ] **Step 5: 리사이즈 (합격 기준)**

`ls` 등으로 줄바꿈이 보이게 한 뒤 창 크기를 좌우로 변경.
- [ ] 터미널 컬럼 수가 창에 맞춰 재배치된다(잘림/공백 줄무늬 없음).

- [ ] **Step 6: 출력 보존 (합격 기준 — 절대원칙 #2)**

"← 대시보드"로 나갔다가 다시 "터미널 열기"로 돌아온다.
- [ ] 이전 출력(echo/색상 등)이 **그대로 남아 있다**(스크롤백 replay). 세션 상태 = ● 실행 중 유지.

- [ ] **Step 7: 종료 정리 (합격 기준)**

"종료" 클릭.
- [ ] 세션 상태가 종료로 바뀐다.
- [ ] **윈도우 오류 다이얼로그(0x800700e8)가 뜨지 않는다.**
- [ ] 앱 자체를 닫아도(창 X) 오류창 없음. (`will-quit`의 `disposeAll` 동작.)
  - ※ 만약 0x800700e8이 뜨면: `PtyManager.stop`/`disposeAll`에서 `pty.kill()` 후 `app`이 즉시 종료되지 않도록 `will-quit`에서 `event.preventDefault()` + `setTimeout(()=>app.exit(0), 80)` 패턴(AO teardown의 50ms 대기 차용)을 추가한다. 이 경우 `main.ts`를 수정하고 Task 7로 회귀.

- [ ] **Step 8: claude 확인(선택, claude가 PATH에 있을 때)**

PowerShell 프롬프트에서 `claude` 입력 → Enter.
- [ ] Claude Code 인터랙티브 UI가 터미널에 뜬다(한글·색상·왕복 동일하게 동작).
  - ※ claude 미설치 시 이 단계는 생략 — M2 합격 기준은 Step 2–7로 충족(범용 구조라 무관).

- [ ] **Step 9: 검증 결과 기록 + design 문서 마감**

`dev-console-m2-design.md` §6 체크박스에 결과 반영. AGENTS.md §마일스톤의 "현재: M1 완료 — M2 대기"를 "M2 완료"로 갱신(마스터 확인 후).

- [ ] **Step 10: Commit (마스터 승인 후)**

```bash
git add plan/dev-console-m2-design.md AGENTS.md
git commit -m "M2: 검증 완료 — 단일 세션 ConPTY 합격"
```

---

## 자기 검토 (Self-Review) — 작성자 기록

**1. Spec 커버리지 (design 문서 대비):**
- D1 인프로세스 소유 → Task 5/7 (PtyManager, main 와이어링, 데몬/파이프 없음). ✅
- D2 출력 보존(링버퍼+replay) → Task 3(RingBuffer) + Task 7(attach 스크롤백 전송) + Task 8(구독 후 attach 순서) + Task 11 Step 6. ✅
- D3 범용 명령 → Task 5(StartOpts command) + Task 9(command 입력, 기본 pwsh). ✅
- AO 차용(teardown/청킹/링버퍼/셸명/xterm) → Task 3/4/5/8 + 출처 주석. ✅
- MIT 컴플라이언스 → Task 10(NOTICE + 주석). ✅
- node-pty 네이티브(무컴파일) → Task 1 스파이크. ✅
- 합격 기준(한글/색상/리사이즈/보존/종료) → Task 11. ✅
- 범위 밖(멀티세션/stream-json/알림/DB적재/복구) → 어느 태스크에도 없음(의도적). ✅

**2. 플레이스홀더 스캔:** "TBD/적당히/나중에" 없음. Task 1만 분기형 스파이크지만 각 분기에 실제 명령·DoD 존재(불확실성을 정직하게 분기로 처리). ✅

**3. 타입 일관성:** `SessionInfo`(객체, status: running|exited) ↔ 기존 `SessionStatus`(문자열 유니온) 충돌 회피 확인. `StartOpts`/`StartSessionInput`/`TerminalDataPayload`/`SpawnFn` 명칭이 Task 5·6·7·8 전반에서 일치. `sessionsApi`/`window.api.sessions` 메서드 시그니처 일치(preload↔client↔types). ✅

**알려진 의도적 결정(마스터 핸드백 시 고지):** M2 터미널은 셸을 띄우고 그 안에서 claude를 입력하는 방식(Windows .cmd 심 직접 spawn은 M3 어댑터로). design에서 "기본값 claude"라 했던 부분을 실무상 "기본 셸 pwsh + 셸 내 claude"로 구체화함.
