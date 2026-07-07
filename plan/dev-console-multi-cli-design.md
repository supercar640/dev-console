# 개발 상황판 — 다중 LLM CLI 선택 기능 설계

> 여러 LLM CLI(Claude Code / Codex / Gemini …)를 골라서 띄울 수 있게 한다.
> 제품 비전(AGENTS.md §머리말: "여러 LLM CLI를 함대처럼 관제")의 직접 구현.
> 방향 근거: `dev-console-direction.md` §1-3(‘CliAdapter는 stream-json을 전제하지 않는다’).
> 작성: 2026-07-07. 소유자 결정으로 **단계적(staged) 접근** 확정.

---

## 0. 배경 · 현재 상태

- **터미널 채널(M2)** = `sessions.*` IPC → `PtyManager` → node-pty. 프로젝트별 자유입력 `command`(기본 `powershell`)로 **이미 아무 명령이나 실행**한다. (`src/views/Terminal.tsx` 입력칸)
- **Agent 채널(M3/M4)** = `agents.*` IPC → `ClaudeAgentManager` → `ClaudeAgentSession` → `QueryFn`(sdk-query → `@anthropic-ai/claude-agent-sdk`). 정규화 `AgentEvent`를 emit. **Claude 전용 하드코딩.**
- 락인 지점은 **Agent 채널** 하나. 터미널 채널은 이미 범용이다.
- `shared/types.ts` §부록B 주석이 이미 명시: `AgentEvent`는 어댑터 무관 형태이고 stream-json은 `ClaudeCodeAdapter`의 구현 디테일. → 이 설계는 새 방향이 아니라 **계획된 추상화의 실현**이다.

## 1. 스코프 결정 (소유자 확정)

- **통합 수준 = 단계적.** 1단계는 터미널 채널에서 CLI를 고를 수 있게(가벼움), 2단계는 PoC로 검증된 CLI만 Agent 채널 1급 관제로 승격.
- **프리셋 = Claude Code · Codex · Gemini** + `powershell`(기본 터미널) + `직접 입력`(자유입력 escape hatch).
- **비목표(YAGNI):** 1단계에서 Agent 채널 확장 없음. 어댑터 추상화 구현 없음. 클래스 리네이밍 없음.

---

## 2. 1단계 설계 — CLI 레지스트리 + 선택기

### 2-1. CLI 등록소 `shared/cli-registry.ts` (신규, 의존성 free)

알려진 CLI를 **데이터**로 정의. 1단계에선 메타데이터일 뿐이나, 2단계 어댑터가 꽂히는 자리.

```ts
export interface CliDef {
  id: string          // 'claude' | 'codex' | 'gemini' | 'powershell'
  label: string       // 표시명
  command: string     // 실행 명령
  args: string[]      // 기본 인자
  supportsAgent: boolean  // Agent 채널 1급 지원 여부(claude=true, 나머지=false)
}

export const CLI_REGISTRY: CliDef[] = [
  { id: 'claude',     label: 'Claude Code', command: 'claude',     args: [], supportsAgent: true  },
  { id: 'codex',      label: 'Codex',       command: 'codex',      args: [], supportsAgent: false },
  { id: 'gemini',     label: 'Gemini',      command: 'gemini',     args: [], supportsAgent: false },
  { id: 'powershell', label: 'powershell',  command: 'powershell', args: [], supportsAgent: false },
]
// 'custom'(직접 입력)은 레지스트리 항목이 아니라 UI의 특수 선택지.
```

- 위치: `shared/`(양 프로세스 공유, 의존성 free — `shared/types.ts`와 동일 규약).
- 인터페이스는 **닫힌 계약**: id 유일, command 비어있지 않음(단위 테스트로 강제).

### 2-2. 터미널 채널 UI 변경 (`src/views/Terminal.tsx`)

- 자유 입력칸 → **드롭다운**: 레지스트리 항목 + 구분선 + `직접 입력…`.
- `직접 입력…` 선택 시에만 기존 자유입력칸 노출(현행 범용 터미널 기능 보존 = 후퇴 없음).
- 시작 버튼은 선택된 CLI의 `command`/`args`로 **기존 `sessions.start` 그대로 호출**. 백엔드(PtyManager) 무변경.

### 2-3. 상태 (`src/stores/session-multi.ts`)

- 현재 프로젝트별 `command: string` 보유(기본 `powershell`, 인메모리 zustand). → **선택된 CLI id + (custom일 때) 자유 command** 를 담도록 확장.
- 영속화: 현행도 command를 DB에 저장하지 않으므로 1단계도 인메모리 parity 유지. (선택 CLI를 `projects.defaultCli`로 DB 영속화하는 것은 **선택적 1.5단계** — 이번 스코프 밖.)

### 2-4. 테스트 (TDD, vitest)

- `cli-registry` 단위 테스트: 프리셋 3종 존재, id 유일, command 비어있지 않음, claude만 `supportsAgent`.
- `session-multi` 라우팅 테스트 확장: CLI 선택/변경 시 프로젝트별 command 반영, custom 입력 경로.

---

## 3. 2단계 설계 — Agent 채널 1급 승격 (PoC 게이트)

### 3-1. PoC 게이트 (CLI마다, M3 게이트와 동일 방법론)

각 CLI(`codex`/`gemini`)가 다음을 제공하는지 `hitl/`에 PoC 하네스로 확인(`hitl/m3-poc` 패턴):

1. **다중 턴 스트리밍 제어** — stdin 후속 주입 → 응답 반복(동일 세션 맥락 유지).
2. **구조화 이벤트** — message/tool_use 등을 json 등으로 관측 가능.
3. **권한 승인 훅** ⚠️ 관건 — 사람이 GUI에서 allow/deny 하는 통로. Claude도 stream-json 직접 파싱으론 못 받아 SDK `canUseTool`로 우회(버그 #34046).

**게이트 실패 시:** 그 CLI는 **터미널 전용으로 남긴다.** direction.md 원칙 #2/#3(‘터미널 출력 정규식 긁어 상태 추론 금지’) 준수 — 가짜 관제를 만들지 않는다.

### 3-2. `CliAdapter` 추상화 도입 (게이트 통과 후)

- 현 `QueryFn` / `ClaudeAgentSession`을 일반화: 어댑터마다 **자기 이벤트 소스**로 정규화 `AgentEvent`를 emit + 권한 요청/응답 경로 제공.
- `ClaudeCodeAdapter` = 현 `ClaudeAgentSession`을 그대로 감쌈(SDK `canUseTool` → `permission_request`/`user_input_required` 합성, 현행 유지).
- `CodexAdapter`/`GeminiAdapter` = **PoC 통과분만** 추가.
- `ClaudeAgentManager` → 어댑터 맵을 소유하는 일반 `AgentManager`로 승격(레지스트리의 `supportsAgent`로 분기). **1단계에선 리네이밍 안 함.**

### 3-3. 테스트

- 어댑터별 `event-parser` 테스트(부록 B 매핑).
- 가짜 어댑터 주입으로 `AgentManager` 분기/수명 단위 테스트(현 `agent-manager.test.ts` 패턴).

---

## 4. 단계 경계 · 검증

- **1단계 완료 정의:** 앱에서 프로젝트 터미널 → 드롭다운으로 Codex/Gemini/powershell/직접입력 선택 → 해당 CLI가 터미널 탭에서 실제 실행(라이브 관측). typecheck·테스트 그린.
- **2단계 진입 조건:** CLI별 PoC 게이트 결과 문서화(통과/실패). 실패 CLI는 승격하지 않음을 명시.
- **비가역 결정 없음** — 전부 two-way door(코드 추가). 소유자 승인 없이 진행 가능한 범위는 1단계 구현까지.

## 5. 파일 영향 요약

| 단계 | 파일 | 변경 |
|---|---|---|
| 1 | `shared/cli-registry.ts` | **신규** — CLI 정의 데이터 |
| 1 | `src/views/Terminal.tsx` | 자유입력칸 → 드롭다운(+custom) |
| 1 | `src/stores/session-multi.ts`, `session.ts` | CLI 선택 상태 확장 |
| 1 | 테스트 | 레지스트리·라우팅 단위 테스트 |
| 2 | `hitl/…-poc` | **신규** — CLI별 PoC 하네스 |
| 2 | `electron/agent/*` | `CliAdapter` 추상화, 어댑터 추가, 매니저 승격 |
