# Codex 브리프 — M4a Phase 3 (렌더러 멀티 세션 컷오버)

구현만. git/테스트/타입체크 실행 금지(리드가 함). 권위 출처: `plan/dev-console-m4a-plan.md` **Task 7~11**의 코드 블록을 **그대로(verbatim)** 적용.

⚠️ 이건 단일→멀티 세션 컷오버라 중간에 타입에러가 나는 게 정상이다. 아래 9개 파일을 모두 적용한 뒤 끝내라. 타입체크는 리드가 마지막에 한 번 돌린다.

## 신규 생성
1. `src/stores/workspaces.ts` ← plan Task 7 Step 1
2. `src/components/StatusDot.tsx` ← plan Task 10 Step 1
3. `src/components/Sidebar.tsx` ← plan Task 10 Step 2

## 전체 교체(파일 내용을 plan 코드로 통째 교체)
4. `src/stores/agent.ts` ← plan Task 8 Step 1 (멀티 스토어 + useAgentProject + focusSession 점프)
5. `src/stores/session.ts` ← plan Task 9 Step 1 (멀티 스토어 + useTerminalProject + 재시작 시 기존 stop)
6. `src/App.tsx` ← plan Task 11 Step 1 (2-pane: Sidebar + 활성 Workspace/Dashboard, Workspace에 key=project.id)
7. `src/views/Workspace.tsx` ← plan Task 11 Step 3 (onBack 제거, 프로젝트별 selector)
8. `src/views/Terminal.tsx` ← plan Task 11 Step 4 (onBack/embedded 제거, useTerminalProject, 액션에 projectId)
9. `src/views/AgentView.tsx` ← plan Task 11 Step 5 (useAgentProject, 액션에 projectId)

## 부분 수정 — `src/views/Dashboard.tsx` (plan Task 11 Step 2)
- import에 `import { useWorkspacesStore } from '@/stores/workspaces'` 추가.
- 컴포넌트 시그니처를 `export default function Dashboard(): React.JSX.Element {` 로 변경(기존 `onOpenTerminal` prop 제거).
- 본문 맨 위에 `const open = useWorkspacesStore((s) => s.open)` 추가.
- 카드의 "터미널 열기" 버튼을 `<button className="btn" onClick={() => open(p)}>열기</button>` 로 교체.
- `AddProjectForm` 함수는 그대로 둔다.
- 결과적으로 `Project` 타입 import가 더 이상 안 쓰이면 import에서 제거(strict noUnusedLocals 통과). `CreateProjectInput`은 AddProjectForm에서 계속 쓰이니 유지.

끝나면 적용한 파일 목록만 보고하라.