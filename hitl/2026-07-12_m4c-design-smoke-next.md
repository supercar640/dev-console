# 재개 메모 — 2026-07-12

> 다음 세션은 이 파일을 먼저 읽고 **현재 브랜치에서 M4 마감 스모크**부터 재개한다.

## 현재 상태

- 현재 브랜치: `agent/align-ui-design`
- HEAD: `f97d0fa Align UI with design system`
- 원격: `origin/agent/align-ui-design`에 push 완료, PR·main 병합은 아직.
- `main`: `78a226e feat: add M4c file references`
- 디자인 수정: `src/styles.css`만 변경. 원안의 6/8/10px 반경, 코랄 위험색, 불투명 disabled 상태, focus 스타일 적용.
- 자동 검증: `pnpm typecheck` PASS, `pnpm test` 103 PASS / 1 SKIP(기존 live), `pnpm build` PASS.
- 실제 Electron 계산 스타일도 버튼 6px·입력 8px·대시보드 행 10px, 코랄 `rgb(239,111,108)`로 확인.

## 다음에 바로 할 일

1. **M4c 파일 참조 수동 스모크**
   - 파일 1개 → Agent 입력창에 `@절대경로` 삽입.
   - 여러 파일 → 공백 구분 삽입.
   - 기존 문장 뒤 삽입 시 공백 정상.
   - 선택 취소 시 입력 불변.
   - 삽입 후 실제 전송하여 에이전트가 파일을 읽는지도 확인(문서 기준보다 강한 제품 검증).
2. **디자인 수동 회귀**
   - Dashboard / Agent / Terminal의 둥근 모서리.
   - 코랄 위험 버튼, disabled, hover, keyboard focus.
   - Terminal의 `overflow: hidden` 때문에 글자·스크롤바가 잘리지 않는지.
3. **검증 기록이 약한 라이브 항목을 가능하면 함께 확인**
   - 관제 대시보드: TodoWrite 진척도, 가짜 % 없음, 승인 대기 최상단, 줄 클릭.
   - 다중 CLI: PowerShell·Claude·Codex·Gemini·직접 입력의 PTY 전달. 2026-07-08에 Codex/Gemini 라이브 성공 기록은 있음.
4. PASS 후 `AGENTS.md`의 M4c를 수동 스모크 PASS(날짜 포함)로 갱신하고 발견 수정만 커밋·push.
5. PR 생성 → 원격에서 `main` 병합(로컬 머지 금지).
6. 이후 M5 설계/계획 작성: 체크리스트 파서, 오늘 작업 시작, 개발일지, chokidar.

## 주의 / 블로커

- `gh auth status`: `supercar640` 토큰 만료. Git push는 Credential Manager로 성공했지만 자동 PR 생성 전 `gh auth login -h github.com` 필요.
- 원격 GitHub가 단일 진실 공급원. 스모크 전 현재 feature 브랜치를 유지한다.
- 코드 TODO는 CSP 하드닝 1건이 있으나 M5 진입 차단 항목은 아님.

## 관련 문서

- `AGENTS.md` 마일스톤: M4c 자동 검증 완료·수동 스모크 대기.
- `plan/dev-console-dashboard-conductor-plan.md` 수동 스모크.
- `plan/dev-console-multi-cli-plan.md` Task 5 라이브 실행 검증.
- `plan/dev-console-spec.md` M5 자동화 범위.
