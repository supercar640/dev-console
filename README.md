# Dev Console (개발 상황판)

> LLM CLI(Claude Code 등)를 함대처럼 **외부에서 관제하는 Windows 네이티브 데스크톱 앱.**
> Google Antigravity와 달리 IDE가 아니라 "에이전트 함대(fleet)를 관제하는 대시보드"가 목표.

여러 워크스페이스에 여러 LLM CLI를 동시에 띄우고 상태·알림·터미널·자동화·스케줄링을
하나의 화면에서 통제한다.

## 기술 스택

Electron · React + TypeScript · Zustand · xterm.js + node-pty · better-sqlite3 · node-cron · chokidar
(빌드: electron-vite)

## 개발

```bash
pnpm install   # 의존성 + postinstall이 better-sqlite3 Electron prebuilt 자동 다운로드
pnpm dev       # 개발 모드 (HMR)
pnpm build     # 프로덕션 번들 → out/
pnpm start     # 빌드된 앱 실행
pnpm typecheck # tsc 타입체크 (node + web)
```

네이티브 모듈은 Electron prebuilt 바이너리를 내려받으므로 **C++ 컴파일러(MSVC)가 필요 없다.**

## 구조

| 경로 | 역할 |
|---|---|
| `electron/` | Main 프로세스 (백엔드): 진입점·IPC·DB·(향후) PTY/오케스트레이터 |
| `src/` | Renderer (React 뷰) |
| `shared/` | Main/Renderer 공통 타입 |
| `plan/` | 설계 명세·방향성·재사용 매핑 문서 |

## 현황

마일스톤 M1(골격) 완료 — Electron+React+TS 보일러플레이트, IPC, SQLite 마이그레이션,
빈 대시보드(프로젝트 CRUD). 로드맵은 `plan/dev-console-spec.md` §6 참고.

## 라이선스

[MIT](./LICENSE).
agent-orchestrator(MIT)의 일부 패턴/코드를 차용하며 출처를 코드 주석에 표기한다.
