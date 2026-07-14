# Codex 작업 브리프 — M3 Agent 엔진 (계획서 그대로 전사)

당신의 역할: 이미 완성된 계획서의 코드 블록을 **그대로 옮겨 적는 것**. 설계·개선·리팩터·추론 금지. 창의성 금지.

- 레포: `c:\AI_project\testbed\dev-console` (Windows)
- 계획서: `plan/dev-console-m3-plan.md` — **먼저 전체를 읽어라.** 각 파일의 정확한 코드가 그 안에 있다.

## 할 일: 계획서의 Task 2 ~ Task 7 구현

### 새로 생성 (해당 Task/Step의 코드 블록을 **글자 그대로** 전사)
- `electron/agent/event-parser.ts`            ← Task 2, Step 3
- `electron/agent/event-parser.test.ts`       ← Task 2, Step 1
- `electron/agent/claude-agent-session.ts`     ← Task 3, Step 3
- `electron/agent/claude-agent-session.test.ts`← Task 3, Step 1
- `electron/agent/agent-manager.ts`            ← Task 4, Step 3
- `electron/agent/agent-manager.test.ts`       ← Task 4, Step 1
- `electron/agent/sdk-query.ts`                ← Task 5, Step 1
- `electron/ipc/agents.ts`                     ← Task 6, Step 1

### 기존 파일 수정 (계획서 지시대로 정확히)
- `electron/ipc/index.ts`  ← Task 6, Step 2 의 코드로 파일 내용을 교체
- `electron/main.ts`       ← Task 6, Step 3: import 2줄 추가, `agentManager` 인스턴스 줄 추가(ptyManager 생성 아래), `registerIpcHandlers(ptyManager)` → `registerIpcHandlers(ptyManager, agentManager)`, will-quit 핸들러에 `agentManager.disposeAll()` 추가
- `electron/preload.ts`    ← Task 7, Step 1: 타입 import에 Agent 타입들 추가, `api` 객체의 `sessions` 뒤에 `agents` 블록 추가(respondPermission은 **3-인자** 버전 사용)
- `src/ipc-client.ts`      ← Task 7, Step 2: import 확장 + `agentsApi` export 추가

## 금지 사항 (엄수)
- `shared/types.ts` 건드리지 마라 (이미 완료됨).
- `package.json`, `pnpm-workspace.yaml`, 계획서(`plan/*.md`), 그 외 어떤 파일도 건드리지 마라.
- 테스트·빌드·타입체크 실행하지 마라 (샌드박스에서 안 된다 — 리드(Claude)가 직접 돌린다).
- **commit / stage / push 하지 마라.** git에 손대지 마라.
- 계획서에 없는 코드를 추가하지 마라. 주석·서명도 임의로 넣지 마라.

## 끝나면
생성/수정한 파일 목록만 보고하라. 검증과 커밋은 리드가 한다.
