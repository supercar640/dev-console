# Codex 작업 브리프 — M3 UI (React 컴포넌트·로직, 계획서 전사)

당신의 역할: 완성된 계획서의 코드를 **그대로 옮겨 적기**. 설계·개선·리팩터 금지.

- 레포: `c:\AI_project\testbed\dev-console` (Windows), 브랜치 `m3-agent-ui`
- 계획서: `plan/dev-console-m3-ui-plan.md` — **전체를 먼저 읽어라.**

## 할 일: 계획서 Task 1 ~ Task 8 구현 (Task 9·10 제외)

**중요: `src/styles.css` 는 이미 작성돼 있다(리드가 확정 팔레트로 완료). 절대 건드리지 마라. Task 9(스타일)는 건너뛴다.**

### 생성/수정 (계획서 해당 Task의 코드를 글자 그대로 전사)
- Task 1: `vitest.config.ts`(include에 src 추가), `shared/types.ts`(`agents.onFocusSession` 추가), `electron/preload.ts`(onFocusSession), `src/ipc-client.ts`(onFocusSession)
- Task 2: `src/stores/agent-reducer.ts` + `src/stores/agent-reducer.test.ts`
- Task 3: `electron/agent/notifier.ts` + `electron/agent/notifier.test.ts`
- Task 4: `src/stores/agent.ts`
- Task 5: `src/components/AgentEventItem.tsx`, `src/components/PermissionCard.tsx`
- Task 6: `src/views/AgentView.tsx`
- Task 7: `src/views/Workspace.tsx`, `src/views/Terminal.tsx`(embedded prop 추가), `src/App.tsx`
- Task 8: `electron/ipc/agents.ts`, `electron/ipc/index.ts`, `electron/main.ts`

### ⚠️ 계획서 대비 2가지 변경 (확정 디자인 반영 — 계획서 코드 대신 이걸 써라)
1. **PermissionCard.tsx**: 거부 버튼을 고스트가 아니라 **솔리드 danger** 로.
   계획서의 `<button className="btn btn--ghost-danger" onClick={onDeny}>거부</button>` →
   `<button className="btn btn--danger" onClick={onDeny}>거부</button>`
2. **AgentEventItem.tsx**: `tool_use` 줄의 화살표를 emerald span 으로 감싼다.
   계획서의 `return <div className="ev ev--tool">▸ {e.name} <code>{short(e.input)}</code></div>` →
   `return <div className="ev ev--tool"><span className="ev__arrow">▸</span> {e.name} <code>{short(e.input)}</code></div>`

## 금지 사항 (엄수)
- `src/styles.css` 절대 수정 금지(이미 완료).
- `package.json`, `pnpm-*`, 계획서, design/ 폴더, 그 외 안 적힌 파일 건드리지 마라.
- 테스트·빌드·타입체크 실행하지 마라(샌드박스에서 안 됨 — 리드가 직접 돌린다).
- **git add/commit/push 하지 마라.**
- 계획서에 없는 코드 추가 금지. 임의 주석·서명 금지.

## 끝나면
생성/수정한 파일 목록만 보고하라. 검증·커밋은 리드가 한다.
