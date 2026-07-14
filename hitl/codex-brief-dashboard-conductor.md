# Codex 브리프 — 대시보드 관제 보드 구현

## 작업
dev-console (Electron + React + TypeScript) 프로젝트. 대시보드를 카드 그리드에서
"지휘자 관점" 세로 라인 보드로 바꾼다. 각 줄에 상태 점·사람 개입 대기 강조·진척도
막대(%)·"지금 하는 중"을 표시하고 급한 순으로 정렬한다.

## 절대 준수
- **구현 계획서 `plan/dev-console-dashboard-conductor-plan.md` 를 읽고 Task 1 → 2 → 3
  순서로 그대로 구현하라.** 각 태스크의 전체 코드가 계획서 안에 이미 있다. 코드를
  새로 지어내지 말고 계획서의 코드 블록을 그대로 옮겨라.
- **커밋/푸시 금지.** 파일 생성/수정만 하라. 검증과 커밋은 사람이 한다.
- 계획서에 명시된 파일 외 **다른 파일은 건드리지 마라.**
- **인코딩:** 모든 파일을 **UTF-8(BOM 없음)** 으로 저장하라. 한글은 **리터럴 한글**
  (예: 관제 보드, 지금 하는 중, 대기 중, 승인 대기)로 쓰고 `\uXXXX` 이스케이프나
  `?` 로 치환하지 마라. 기존 한글 주석/문자열을 재인코딩하거나 건드리지 마라.

## 작업 목록 (계획서 코드 그대로)
1. **Task 1** — 생성:
   - `src/stores/project-progress.ts`
   - `src/stores/project-progress.test.ts`
2. **Task 2** — 생성:
   - `src/components/ProgressBar.tsx`
3. **Task 3** —
   - `src/views/Dashboard.tsx` **전체를** 계획서의 코드로 교체(`AddProjectForm` 포함).
   - `src/styles.css`: 기존 `.cards { … }` 부터 `.card__actions { … }` 까지의 블록을
     삭제하고, 계획서 Task 3 Step 2의 보드/진척도 스타일을 그 자리에 추가하라.
     (`.cards`/`.card` 는 Dashboard.tsx 외 사용처가 없음이 확인됨 → 안전하게 삭제.)

## 하지 마라
- 테스트/타입체크/빌드 실행 시도(샌드박스에서 안 된다). 사람이 직접 돌린다.
- 계획서에 없는 리팩터·스타일·파일 변경.
