# Dev Console — agent-orchestrator 재사용 매핑

> agent-orchestrator(AO, `C:\AI_project\testbed\agent-orchestrator`, **MIT 라이선스**)에서
> dev-console로 가져올 자산을 명세 §8 디렉토리 구조에 매핑한다.
> 동반 문서: `dev-console-direction.md`. 작성: 2026-05-29.
>
> 태그: 🟢 **거의 그대로 이식** / 🟡 **적응 필요** / 🔵 **레퍼런스만(코드 X, 설계 참고)**

---

## A. 근본 차이 (왜 통째로는 못 가져오나)

| | dev-console | AO |
|---|---|---|
| 셸 | **Electron 네이티브 앱** | CLI + **Next.js 웹** |
| 중심 단위 | **워크스페이스 + 체크리스트** | **이슈/PR** (트래커마다 worktree→PR) |
| 에이전트 조종 | **headless stream-json** (Agent) + node-pty (Terminal) | **PTY 인터랙티브 + JSONL/훅 감지** |
| 런타임 | Electron Main이 PTY 소유 | tmux(유닉스) / named-pipe ConPTY(윈도우) |
| 철학 | 손에 쥐고 관제 | fire-and-forget, 알림 받고 drill-down |

→ 세션매니저·paths(해시 worktree)·scm/tracker 플러그인 등 "골격"은 이슈 중심이라 **안 맞음.** 부품 단위로만 차용.

---

## B. 디렉토리 매핑

```
dev-console/
├── electron/
│   ├── pty/                     ★ AO 최대 노다지
│   │   ├── pty-host.ts          🟢 ← runtime-process/src/pty-host.ts
│   │   │                            바이너리 프레이밍(0x01~0x08), attach 스크롤백 replay,
│   │   │                            ConPTY graceful teardown(WER 0x800700e8 회피)
│   │   ├── pty-client.ts        🟢 ← runtime-process/src/pty-client.ts  (WebSocket→IPC만 교체)
│   │   ├── windows-pty-registry.ts 🟢 ← core/src/windows-pty-registry.ts  (orphan PID 레지스트리)
│   │   └── ring-buffer.ts       🟡 ← pty-host outputBuffer 분리 (명세 4-4)
│   │
│   ├── recovery/                🟡 ← core/src/recovery/ 전체
│   │                                scan→assess→act(recover/cleanup/escalate/skip)+dry-run 골격.
│   │                                worktree/PR 검증부 → "PTY 생존 + stream-json 에러"로 교체.
│   │                                명세 4-10 지수백오프 신규 추가.
│   ├── orchestrator/
│   │   ├── lifecycle-state.ts        🟡 ← core/src/lifecycle-state.ts
│   │   ├── lifecycle-transition.ts   🟡 ← core/src/lifecycle-transition.ts  ("전이는 한 경계 통과" 규율)
│   │   ├── event-bus.ts              🔵 ← architecture-design.md Event Bus 설계
│   │   └── session-manager.ts        🔵 AO는 이슈/worktree 결합도 높음 → 인터페이스만 차용, 신규 작성
│   │
│   ├── db/
│   │   ├── events-db.ts          🟡 ← core/src/events-db.ts  (better-sqlite3 + FTS, 스택 동일!) 테이블만 명세 §3로 교체
│   │   ├── query-activity-events.ts 🟡 ← core/src/query-activity-events.ts
│   │   └── atomic-write.ts       🟢 ← core/src/atomic-write.ts
│   │
│   ├── adapters/
│   │   ├── base.ts               🔵 ← architecture-design.md "Agent 인터페이스" + 명세 2-3 합성
│   │   ├── claude-code.ts        🟡 ← agent-claude-code/src/{index,activity-detection}.ts
│   │   │                            stream-json은 신규. ~/.claude/projects/*.jsonl 탐색·
│   │   │                            인코딩·훅 이벤트 읽기는 금광(Terminal 채널 감지용)
│   │   └── (codex/gemini…)       🔵 나머지 어댑터 = "CLI별 quirk 사전"
│   │
│   ├── notify/                   🟡 ← notifier-* + core/notification-data.ts
│   │   ├── dispatcher.ts             🟡 notifier-resolution.ts (라우팅 추상화)
│   │   ├── notification-data.ts      🟢 구조화 알림 스키마
│   │   ├── desktop.ts                🟡 ← notifier-desktop → Electron Notification으로 교체
│   │   └── (slack/discord/webhook)   🟡 v2
│   │
│   ├── scheduler/                🔵 node-cron 신규 (AO 직접 대응물 적음)
│   └── watcher/                  🔵 chokidar 신규
│
├── src/ (Renderer)
│   ├── components/terminal/      🟡 ← web/src/components/terminal/ (xterm v6 + addon-fit/web-links). ws→IPC
│   └── (디자인)                  🔵 AO DESIGN.md "Warm Terminal" 색 토큰/상태색 차용 가능
│
└── electron/util/ (or shared/)
    ├── platform.ts (killProcessTree 등) 🟢 ← core/src/platform.ts
    ├── file-lock.ts (명세 위험 #4)      🟢 ← core/src/file-lock.ts
    ├── daemon-children.ts (orphan 청소)  🟡 ← core/src/daemon-children.ts
    └── prompt-builder.ts                🔵 ← core/src/prompt-builder.ts (현황파악/오늘작업 프롬프트 조립)
```

---

## C. 마일스톤별 이식 우선순위

| 마일스톤 | AO에서 당겨올 것 | 효과 |
|---|---|---|
| **M2 (단일 세션·ConPTY)** | 🟢 pty-host / pty-client / windows-pty-registry / atomic-write / platform | **최대.** 명세 위험 #1(ConPTY) + M2 거의 해결 |
| **M3 (stream-json)** | 🟡 claude-code 어댑터의 JSONL/훅 부분, 부록B 이벤트 타입 | 본체 신규, 폴백/Terminal감지 차용 |
| **M4 (멀티+영속)** | 🟡 events-db(FTS) / lifecycle-state·transition / query | SQLite 적재·상태머신 골격 |
| **M5 (자동화)** | 🔵 prompt-builder (체크리스트는 신규) | 프롬프트 조립 패턴 |
| **M6 (스케줄·복구)** | 🟡 recovery/ 전체, 🟡 daemon-children | 복구 파이프라인 + orphan 청소 |
| **M7 (멀티에이전트)** | 🔵 event-bus / plugin-registry / notifier 라우팅 | 메시지버스·플러그인 설계 |

---

## D. 함정 3개

1. **모노레포 의존 거미줄.** 파일 하나 떼면 `paths.ts`/`types.ts`/`activity-events.ts`가 줄줄이 딸려옴. → **함수 단위 복붙 + 의존성 끊기.** 패키지째 link 금지.
2. **worktree/PR/이슈 개념 박힘.** recovery·lifecycle 그대로 쓰면 안 맞는 필드 따라옴. 골격만 살리고 검증 로직 교체.
3. **ESM `.js` 확장자 import**(`from "./foo.js"`). dev-console tsconfig(moduleResolution)와 맞춰야 복붙이 깔끔.
