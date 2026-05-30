# 개발 상황판(Dev Console) — 방향성 / 핵심 결정문

> 이 문서는 `dev-console-spec.md`(설계 명세) 위에 얹는 **전략 결정 기록**이다.
> 명세가 "무엇을 만드나"라면, 이 문서는 "왜 이렇게 정했나 / 무엇을 빌려오나 / 무엇을 먼저 검증하나"를 못 박는다.
> 동반 문서: `dev-console-reuse-map.md` (agent-orchestrator 자산 재사용 매핑).
> 작성: 2026-05-29.

---

## 0. 배경

마스터가 `agent-orchestrator`(이하 **AO**, `C:\AI_project\testbed\agent-orchestrator`)를 설치·사용해보고 실망함.
그 코드베이스를 검토해 ① dev-console의 핵심 베팅(stream-json)을 유지할지 ② 어떤 부품을 빌려올지 판단함.

**AO의 정체:** "사람은 자리를 뜨고(walks away), 알림이 올 때만 개입한다"는 **fire-and-forget 이슈→PR 자동화 봇 팜**.
대시보드는 2차 drill-down일 뿐(철학: *Push, not pull*). dev-console이 원하는 **"손에 쥐고 관제하는 함대 콘솔"** 과는 제품 철학이 다르다 — 이것이 실망의 근원으로 추정됨.

---

## 1. 핵심 결정: stream-json 베팅은 **유지한다 (조건부)**

### 1-1. AO는 stream-json을 "몰라서"가 아니라 "일부러" 안 썼다

증거:
- AO 설계문(`artifacts/architecture-design.md`)에 `claude-headless` 런타임(`claude -p --output-format stream-json` + stdout 파싱)이 **설계돼 있으나 플러그인으로 출시 안 됨.** 알고도 인터랙티브(`claude-code`)를 기본 출하.
- `agent-claude-code/src/index.ts:1039` 주석: `-p / --print`는 **one-shot 종료**를 유발하므로 회피, 위치 인자로 프롬프트만 자동 제출하고 **인터랙티브 유지**.
- `runtime-tmux/README.md`: tmux 선택 이유 = "어태치해서 디버깅", "인터랙티브 AI 도구와 잘 맞음".

### 1-2. AO가 stream-json을 비켜간 이유 4개 — 그 중 우리에게 해당하는 건 **④번 하나뿐**

| AO의 회피 이유 | dev-console에 해당? |
|---|---|
| ① 인터랙티브 세션을 한 채널로 유지하고 싶었다 | ❌ 명세 2-2가 **Agent(headless) / Terminal(인터랙티브) 채널을 이미 분리.** AO가 욱여넣다 포기한 걸 처음부터 둘로 쪼갬 → 우리 설계가 더 낫다 |
| ② `--print`가 one-shot이라 multi-turn 불가 | ❌ `--input-format stream-json`(양방향)으로 해소. 명세가 이미 전제 |
| ③ "사람이 살아있는 터미널에 붙는다" | ❌ 그게 정확히 우리 Terminal 채널 + ConPTY attach/reattach. 충돌 없음 |
| ④ **7종 CLI를 한 방식으로 묶으려면 stream-json은 Claude 전용** | ✅ **유효한 경고.** Codex/Gemini 어댑터 붙이는 순간 동일한 벽 |

### 1-3. 따라서 채택하는 교훈 3개

1. **`CliAdapter`는 stream-json을 전제하지 않는다.** "각 어댑터가 *자기만의 이벤트 소스*를 제공한다"로 추상화. stream-json은 `ClaudeCodeAdapter`의 *구현 디테일*일 뿐. (명세 부록 B `AgentEvent` 타입이 이미 이 방향)
2. **사람이 보는 터미널 출력을 정규식으로 긁어 상태를 추론하지 않는다.** AO가 15커밋 갈아넣고 폐기한 길(`index.ts:1071` 주석, 이슈 #1932). stream-json은 Claude에 대해 이걸 깔끔히 회피 — **베팅의 핵심 가치가 여기 있다.**
3. **Terminal 채널 상태감지 = Claude Code 훅 + `~/.claude/projects/*.jsonl`.** AO가 도달한 최종해. 결과적으로 dev-console은 **Agent 채널=stream-json / Terminal 채널=훅·JSONL** 조합으로 양쪽 다 정규식 없이 간다 → AO보다 한 수 위 설계.

---

## 2. 검증 게이트 (PoC) — M3 착수 전 필수 ⚠️

> `claude --input-format stream-json --output-format stream-json` 이 **진짜 다중 턴 인터랙티브 제어**(stdin으로 후속 메시지 주입 → 응답 수신 반복)를 지원하는가?

- M3(stream-json 통합)의 **사활**이 여기 걸린다. 이게 안 되면 Agent 채널 설계를 재검토해야 함.
- AO 코드가 아니라 **Claude Code 자체 기능** 확인 사항. 30분 PoC로 못 박고 M3 진입.
- M1(골격)·M2(ConPTY 단일 세션)는 이 결과와 무관하게 선행 가능.

---

## 2-bis. 게이트 결과 + Agent 채널 아키텍처 확정 (2026-05-30)

**① 다중 턴 게이트 = ✅ PASS.** `claude --print --input-format stream-json --output-format stream-json`(claude 2.1.158)에 stdin으로 후속 user 메시지를 주입 → 응답 수신을 반복 확인. 두 턴이 동일 `session_id`를 공유하고 맥락("42")을 유지 → **one-shot 아님, 진짜 다중 턴.** (하네스: `hitl/m3-poc/multiturn-poc.mjs`)

**② 그러나 "stream-json 직접 파싱"으로는 권한/질문을 못 받는다.** 도구(Bash) + `--permission-mode default`에서 모델이 `tool_use`를 낸 뒤 **권한 요청 이벤트 없이 그대로 블록**됨 → Claude Code 알려진 버그 [#34046](https://github.com/anthropics/claude-code/issues/34046)(`--permission-prompt-tool stdio`가 `can_use_tool` control_request를 안 보냄) 재현. **사람이 화면에서 승인하는 흐름을 손코딩 stream-json으로는 구현 불가.**

**③ 결정: `ClaudeCodeAdapter`는 공식 Agent SDK(`@anthropic-ai/claude-agent-sdk`, TS) 위에 세운다.**
- SDK가 내부적으로 같은 stream-json 프로토콜 + 제어 채널을 구현 → 우리는 **`canUseTool` 콜백**으로 권한 요청(도구명+입력)을 받아 GUI로 띄우고 allow/deny를 돌려준다.
- claude가 사람에게 묻는 경우(`AskUserQuestion`)도 **같은 `canUseTool` 통로**로 들어옴 → "질문 대기 감지"가 사실상 무료.
- 스트리밍 입력(다중 턴)·`interrupt()`·`setPermissionMode()` 제공.
- **방향 유지:** 명세 §2-3 어댑터 추상화와 정합 — "stream-json은 ClaudeCodeAdapter의 구현 디테일"(§1-3-1)이라는 교훈 그대로. SDK는 그 디테일을 **안정적으로 제공하는 더 나은 수단**일 뿐. 고정 스택 불변(npm 의존성 1개 추가). 명세 §2-1의 "stdin/stdout JSON 직접 파싱" 문구는 이 결정으로 갱신됨.

**④ SDK 증명 PoC = ✅ PASS.** SDK 0.3.158로 Write 도구 요청 시 `canUseTool` 발화(도구명/입력 수신) 확인, deny가 claude로 되돌아가 거부 처리(파일 미생성), 같은 세션 다중 턴·맥락 유지 동시 확인. (하네스: `hitl/m3-poc/sdk-proof.mjs`) ⚠️ 주의: 유저 `defaultMode:auto` 및 safe-command(예: `echo`) 자동허용을 피하려면 `settingSources:[]` + **권한 필요한 도구(Write/Edit 등)** 로 테스트해야 콜백이 발화한다.

**M3 함의:** `permission_request`/`user_input_required` AgentEvent(부록 B)는 native 이벤트가 아니라 **`canUseTool` 콜백에서 합성**한다. 이벤트 파서는 SDK 메시지(`system:init` / `assistant`(text·tool_use·thinking) / `user`(tool_result) / `result` / `rate_limit_event`)를 부록 B 타입으로 매핑.

---

## 3. 절대 원칙 재확인 (명세 §1-3에서 승계)

- **Main 프로세스가 진짜 백엔드, Renderer는 뷰일 뿐.** PTY/세션 상태는 Main 소유.
- **React 언마운트 시 PTY를 죽이지 않는다** (흔한 실수). 탭 전환·창 닫기와 작업 수명은 분리.
- 모든 상호작용을 **이벤트 스트림**으로 모델링 → UI는 투영(projection).

---

## 4. 출처 근거 파일 (AO 내부, 재확인용)

- `artifacts/architecture-design.md` — 8 플러그인 슬롯, `claude-headless` 설계, 제품 철학(Push not pull)
- `packages/plugins/agent-claude-code/src/index.ts` — interactive vs `--print` 결정, detectActivity 폐기 주석
- `packages/plugins/agent-claude-code/src/activity-detection.ts` — `~/.claude/projects/*.jsonl` 탐색·인코딩 처리(금광)
- `packages/plugins/runtime-tmux/README.md` — "Why tmux over raw processes?"
- `packages/plugins/runtime-process/src/{pty-host,pty-client}.ts` — Windows ConPTY 구현(최대 노다지)
