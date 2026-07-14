# M4a 마무리 — SDK ESM 로드 버그 수정 & 수동 스모크 체크리스트

- 작성: 2026-06-04 (밤)
- 브랜치: `m4a-multisession`
- 다음 할 일: **2026-06-05(내일) 수동 스모크** → 이상 없으면 PR → 원격 머지

---

## 1. 지금까지 (M4a 멀티세션 코어)

자동 검증은 전부 통과한 상태입니다.

- `pnpm test` — 73 passed / 1 skipped
- `pnpm run typecheck` — green
- `pnpm build` — green (main / preload / renderer 전부 빌드)

구현 범위: 메인 프로세스 세션 다중화(PtyManager·ClaudeAgentManager를 Map 기반으로),
프로젝트별 상태 라우터(agent-multi / session-multi / workspaces / project-status, 순수 TDD),
Zustand 멀티 스토어, 사이드바 2-pane UI + 프로젝트별 상태 점.

남은 것은 **사람이 눈으로 확인하는 수동 스모크**뿐이었습니다(아래 5장).

---

## 2. 발견한 버그 — `pnpm dev` 실행 시 자바스크립트 에러

### 증상
앱을 실제로 처음 띄우자 Electron 메인 프로세스가 로드 중 죽음:

```
App threw an error during load
Error [ERR_REQUIRE_ESM]: require() of ES Module
  ...@anthropic-ai\claude-agent-sdk\sdk.mjs not supported.
Instead change the require of ...sdk.mjs to a dynamic import()...
    at Object.<anonymous> (out\main\index.js:7:24)
```

### 원인 (쉬운 말)
앱 본체는 **구형 모듈 방식(CommonJS)**으로 조립돼 있는데, 클로드 에이전트 SDK 부품은
**신형 방식(ESM)으로만 끼울 수 있는 규격**입니다. 본체가 구형 방식 그대로 부품을
끼우려다 "그 규격은 그렇게 못 끼운다"며 멈춘 것. 에러 메시지조차 "`require` 말고
동적 `import()`를 쓰라"고 직접 알려줬습니다.

### 원인 (기술)
- electron-vite의 main 번들은 CJS로 출력되고 deps를 externalize함.
- `@anthropic-ai/claude-agent-sdk`는 ESM 전용(`sdk.mjs`).
- `sdk-query.ts`의 **정적** `import { query } from '@anthropic-ai/claude-agent-sdk'` →
  런타임에 `require('...sdk.mjs')` → `ERR_REQUIRE_ESM`.

### 중요: 이번 M4a 작업과 무관 (기존 잠복 버그)
git 이력 확인 결과 이 코드는 **M3 커밋 `6816edd`**(에이전트 SDK 배선)에서 들어왔고,
M4a 브랜치에서는 해당 파일(`sdk-query.ts`, `main.ts`)을 건드린 적이 없습니다.
자동 테스트는 가짜 queryFn으로만 돌아 진짜 SDK 경로를 안 타기 때문에 여태 안 걸렸고,
앱을 실제로 처음 띄우면서 드러난 것입니다.

---

## 3. 수정 내용

**파일: `electron/agent/sdk-query.ts` (1개)**

SDK를 끼우는 방식을 정적 import → **동적 `import()`**로 변경(에러 메시지가 권한 그 방법).
SDK는 외부 의존성으로 그대로 둬서(번들에 안 섞음) SDK가 내부적으로 쓰는 CLI 경로
해석 등이 깨지지 않습니다. 핸들은 동기로 돌려줘야 하므로, 첫 async 순회/interrupt
시점에 모듈을 `await`한 뒤 실제 query에 위임하도록 래핑했습니다.

```ts
let sdkModule: Promise<SdkModule> | null = null
function loadSdk(): Promise<SdkModule> {
  sdkModule ??= import('@anthropic-ai/claude-agent-sdk')
  return sdkModule
}
// createSdkQueryFn(): 동기 진입점에서 import 시작 →
//   asyncIterator / interrupt 에서 await ready 후 실제 query 위임
```

---

## 4. 검증 (자동 관문 전부 통과)

- 타입체크 ✅
- 빌드 ✅ — **빌드 결과물에 `import("@anthropic-ai/claude-agent-sdk")`가 동적 import
  그대로 보존됨**(`require()`로 되돌아가지 않음 — 이게 핵심 관문이었음).
- `pnpm dev` 재실행 ✅ — 이전의 `ERR_REQUIRE_ESM`가 사라지고 `start electron app...`까지
  정상 진행, 앱 창이 뜸.
- 변경 파일(`sdk-query.ts`)은 테스트가 가짜 부품으로 대체하는 부분이라 73개 테스트 결과에
  영향 없음.
- 검증에 띄웠던 dev 인스턴스 + 이전 크래시가 남긴 dev-console 좀비 프로세스 정리 완료
  (다른 Electron 앱 — VS Code 등 — 은 경로로 구분해 건드리지 않음).

> 단, 로드 시점 크래시는 확실히 해결됐지만 SDK 부품이 **실제로 동작**하는 건 에이전트를
> "시작"하는 순간 처음 불려옵니다 → 이 부분은 내일 스모크에서 직접 눌러봐야 최종 확인됩니다.

---

## 5. 내일(6/5) 할 수동 스모크 체크리스트

`pnpm dev`로 앱을 띄운 뒤 아래를 순서대로 확인하세요.

- [ ] **앱 기동**: 창이 정상으로 뜨고 자바스크립트 에러 대화상자가 없음.
- [ ] **프로젝트 2개 열기**: 대시보드에서 프로젝트 두 개를 "열기" → 왼쪽 사이드바에 둘 다 뜸.
- [ ] **양쪽 에이전트 시작**: 프로젝트 A에서 에이전트에 지시 입력→시작, B에서도 시작.
      (← 여기서 SDK가 실제로 로드됨. 에러 없이 응답이 오면 2장 수정이 런타임까지 OK.)
- [ ] **전환해도 안 끊김**: A↔B 사이드바로 왔다갔다 해도 각 에이전트 진행이 멈추거나
      초기화되지 않음(렌더러는 보기일 뿐, 세션은 메인이 소유).
- [ ] **상태 점 독립 갱신**: 사이드바 점이 프로젝트별로 따로 바뀜
      (실행=초록, 사람대기=초록 깜빡임, 유휴=흰색, 완료/없음=회색, 비정상=빨강).
- [ ] **알림 클릭 점프**: 한쪽이 "사람 대기"가 되면 시스템 알림 → 클릭 시 해당 프로젝트로 점프.
- [ ] **터미널 재attach**: 한 프로젝트에서 터미널 시작 → 다른 프로젝트 갔다 돌아오면
      터미널 내용(스크롤백)이 그대로 복원됨.
- [ ] **닫고 다시 열기**: 프로젝트를 닫았다 다시 열어도 살아있던 세션이 유지됨.
- [ ] **듀얼채널 경고**: 한 채널(에이전트/터미널)이 실행 중일 때 다른 채널로 전환하면
      "동시에 실행됩니다" 확인창이 뜸(차단 아님, 확인 시 전환).

### 문제가 보이면
- 에이전트 시작 시 에러가 나면 → 2장의 동적 import가 런타임에서 풀렸을 수 있음.
  터미널의 `pnpm dev` 출력을 캡처해서 알려주세요(메인 프로세스 에러는 거기 찍힘).
- 그 외 UI 이상(점 색·전환·재attach 등)은 본 문서 + 변경 파일 기준으로 바로 잡겠습니다.

---

## 6. 커밋 & 푸시 기록

이 문서 작성 직후 진행. (hitl/ 는 gitignore라 이 문서 자체는 커밋에 안 들어감 — 로컬 기록용)

- 커밋 1 — `448ca3d` `docs(m4a): M4a 구현계획서 (TDD)` : `plan/dev-console-m4a-plan.md`
- 커밋 2 — `d5bad5e` `fix(agent): claude-agent-sdk 를 동적 import 로 로드 (ESM)`
  : `electron/agent/sdk-query.ts`
- 푸시 ✅ — `git push -u origin m4a-multisession` (원격에 새 브랜치 생성, upstream 설정 완료)
- 제외: `design/dev-console-m3.pen` (작업과 무관한 기존 변경 — 건드리지 않고 그대로 둠)

### PR (내일 스모크 통과 후)
- PR 생성 링크: https://github.com/supercar640/dev-console/pull/new/m4a-multisession
- 통합은 PR → GitHub에서 머지 경유(로컬 머지 안 함).
