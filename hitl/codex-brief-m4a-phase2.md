# Codex 브리프 — M4a Phase 2 (렌더러 순수 로직 4모듈)

구현만. git/테스트 금지(리드가 함). **신규 파일 8개만 생성**, 기존 파일 수정 금지.
권위 출처: `plan/dev-console-m4a-plan.md`의 **Task 3·4·5·6**. 각 Step 1(테스트)·Step 3(구현)의 코드 블록을 **그대로(verbatim)** 새 파일로 만든다.

생성할 파일:
1. `src/stores/workspaces-reducer.ts` ← plan Task 3 Step 3
2. `src/stores/workspaces-reducer.test.ts` ← plan Task 3 Step 1
3. `src/stores/agent-multi.ts` ← plan Task 4 Step 3
4. `src/stores/agent-multi.test.ts` ← plan Task 4 Step 1
5. `src/stores/session-multi.ts` ← plan Task 5 Step 3
6. `src/stores/session-multi.test.ts` ← plan Task 5 Step 1
7. `src/stores/project-status.ts` ← plan Task 6 Step 3
8. `src/stores/project-status.test.ts` ← plan Task 6 Step 1

주의:
- `agent-multi.ts`는 기존 `./agent-reducer`(이미 존재)에서 `initialAgentState/startSession/appendEvent/appendUser/setStatus/addPending/removePending`·타입 `AgentState`를 import해 재사용한다. agent-reducer는 수정하지 마라.
- `project-status.ts`는 `./session-multi`에서 `TerminalStatus` 타입을 import한다.
- import 경로는 plan 코드 그대로(`@shared/types`, `./agent-reducer`, `./session-multi`).

끝나면 생성한 파일 목록만 보고하라.