# Codex 작업 브리프 — M4a Phase 1 (Main 엔진: 매니저 단일→다중)

너는 구현만 한다. **git 명령 금지(커밋/푸시 금지), 테스트 실행 금지** — 테스트와 커밋은 내가(리드) 직접 한다.
아래 두 파일 묶음만 수정한다. **다른 파일은 건드리지 마라.**

권위 있는 출처는 `plan/dev-console-m4a-plan.md`의 **Task 1**과 **Task 2**다. 그 안의 코드 블록을 **그대로(verbatim)** 적용하라. 아래는 핵심 요약이며, 충돌 시 plan 파일의 코드가 정답이다.

---

## 변경 1 — `electron/pty/pty-manager.ts`

`PtyManager` 클래스를 단일 세션에서 멀티 세션(Map)으로 바꾼다. 상단 import·상수(`MAX_SCROLLBACK_BYTES` 등)·`resolveCommand`·`Session` 인터페이스는 **그대로 유지**하고, 클래스 본문만 plan Task 1 Step 3의 코드로 교체한다. 핵심:

- `private session: Session | null = null` → `private sessions = new Map<string, Session>()`
- `start()`: 맨 앞의 `if (this.session) this.stop(this.session.id)` 제거(교체하지 않고 추가). `this.session = session` → `this.sessions.set(id, session)`. `onData`/`onExit` 콜백 본문은 동일.
- `send/resize/getScrollback/status/stop`: `this.session` 단일 참조 → `this.sessions.get(sessionId)` 조회. `send`의 청킹 `writeNext`도 매 호출마다 `this.sessions.get(sessionId)` 재조회. `stop`은 `this.sessions.delete(sessionId)`.
- `disposeAll()`: `for (const id of [...this.sessions.keys()]) this.stop(id)`.

정확한 전체 클래스 코드는 plan Task 1 Step 3 참조.

## 변경 1-테스트 — `electron/pty/pty-manager.test.ts`

- 기존 마지막 테스트 `'start 재호출 시 이전 세션을 정리(교체)한다'`(파일 끝 근처) **삭제**.
- `describe` 블록 닫기 직전에 plan Task 1 Step 1의 멀티 세션 테스트 묶음(`multiManager()` 헬퍼 + 5개 `it`)을 **그대로 추가**. 다른 기존 테스트는 유지.

---

## 변경 2 — `electron/agent/agent-manager.ts`

`ClaudeAgentManager` 클래스를 멀티 세션(Map)으로 바꾼다. 상단 주석·import 유지, 클래스 본문만 plan Task 2 Step 3 코드로 교체. 핵심:

- `private session: ClaudeAgentSession | null` + `private currentId: string | null` → `private sessions = new Map<string, ClaudeAgentSession>()`
- `start()`: 맨 앞 `if (this.session) this.stop(this.currentId!)` 제거(추가만). `this.session=session; this.currentId=id` → `this.sessions.set(id, session)`.
- `send/respondPermission/interrupt/status/stop`: `this.currentId === sessionId ? this.session : ...` 분기 제거 → `this.sessions.get(sessionId)?.…`. `stop`은 `this.sessions.delete(sessionId)`.
- `disposeAll()`: `for (const id of [...this.sessions.keys()]) this.stop(id)`.

정확한 전체 클래스 코드는 plan Task 2 Step 3 참조.

## 변경 2-테스트 — `electron/agent/agent-manager.test.ts`

- 기존 `'start 재호출 시 이전 세션을 정리(교체)한다'` 테스트 **삭제**.
- 그 자리에 plan Task 2 Step 1의 3개 `it`(둘 다 살아있음 / 한 세션 stop 격리 / 이벤트 라우팅)을 **그대로 추가**. 나머지 두 테스트 유지. 기존 상단 `flush`/`fakeQuery` 헬퍼 재사용(이미 파일에 있음).

---

## 끝나면

수정한 파일 목록만 보고하라. typecheck/vitest/커밋은 내가 한다.
