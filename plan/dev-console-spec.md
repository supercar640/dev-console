# 개발 상황판 (Dev Console) — 설계 명세서

> LLM CLI(Claude Code 등)를 오케스트레이션하는 윈도우 데스크톱 앱.
> Google Antigravity와 달리, IDE가 아닌 **"에이전트 함대(fleet)를 외부에서 관제하는 대시보드"**가 목표.

---

## 0. 프로젝트 한 줄 요약

여러 워크스페이스에 여러 LLM CLI를 동시에 띄우고, 상태·알림·터미널·자동화·스케줄링을 하나의 화면에서 통제하는 윈도우 네이티브 앱.

---

## 1. 핵심 아키텍처

### 1-1. 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 셸 | **Electron** | node-pty의 윈도우(ConPTY) 지원이 가장 안정적. xterm.js와의 통합 표준. |
| 프론트엔드 | **React + TypeScript** | 상태가 복잡한 멀티세션 UI에 적합. |
| 상태관리 | **Zustand** (또는 Redux Toolkit) | 가볍고 IPC와 잘 어울림. |
| 백엔드(Main) | **Node.js** | Electron Main 프로세스. |
| 터미널 | **xterm.js + node-pty** | 사실상 표준 (VS Code, Hyper, Windows Terminal 동일). |
| DB | **better-sqlite3** | 동기 API, 단일 파일, Main 프로세스에 적합. |
| 스케줄러 | **node-cron** | 크론 표현식 지원. |
| 파일 감시 | **chokidar** | 워크스페이스 변경 감지. |

**Tauri를 쓰지 않는 이유**: PTY/터미널 생태계가 Node에 비해 미성숙. 이 앱의 핵심 가치가 "여러 터미널을 안정적으로 굴리는 것"이므로 검증된 길을 택함.

### 1-2. 프로세스 구조

```
┌──────────────────────────────────────────────────────────────┐
│  Renderer Process (프론트엔드) - React + TypeScript          │
│  - 대시보드 UI, 터미널 뷰(xterm.js), 알림 패널, 파일 선택    │
│  - 뷰의 역할만 담당. 비즈니스 로직 없음.                     │
└────────────────────────┬─────────────────────────────────────┘
                         │ IPC (contextBridge + ipcRenderer)
┌────────────────────────┴─────────────────────────────────────┐
│  Main Process (백엔드) - Node.js                             │
│  - Orchestrator 코어                                         │
│  - PTY 매니저 (node-pty로 Claude Code 등 spawn)              │
│  - 세션 상태머신, 이벤트 버스                                │
│  - SQLite 영속화                                             │
│  - 스케줄러 (node-cron)                                      │
│  - 파일시스템 watcher (chokidar)                             │
│  - 알림 디스패처                                             │
└──────────────────────────────────────────────────────────────┘
```

### 1-3. 절대 원칙

> **Main 프로세스가 진짜 백엔드, Renderer는 뷰일 뿐.**

- PTY 인스턴스와 세션 상태는 Main이 소유.
- UI 창을 닫거나 다른 탭으로 옮겨도 작업은 계속되어야 함.
- Renderer는 IPC로 "구독"만 함.
- React 컴포넌트 언마운트 시 PTY를 죽이면 안 됨 (흔한 실수).

---

## 2. 핵심 기술 결정: Claude Code를 어떻게 조종할 것인가

### 2-1. Headless 모드 + Stream JSON 채택

Claude Code의 `--output-format stream-json --input-format stream-json` 조합 사용.

- **stdout**: JSON 라인 스트림으로 모든 이벤트 수신 (도구 호출, 사용자 입력 요청, 토큰 사용량, 종료 사유)
- **stdin**: JSON 라인으로 메시지 송신
- ANSI 이스케이프 파싱 불필요
- 여러 세션 상태가 깨끗하게 분리됨

### 2-2. 듀얼 채널 구조

각 워크스페이스마다 두 종류 세션:

| 채널 | 용도 | 구현 |
|---|---|---|
| **Agent 채널** | 자동화 작업, "오늘 작업 시작", 크론잡, 체크리스트 실행 | headless + stream-json |
| **Terminal 채널** | 사용자가 직접 들어가서 명령 치는 인터랙티브 모드 | node-pty + xterm.js로 일반 `claude` 실행 |

**두 채널은 동시 활성화 금지** (파일 충돌 방지). UI에서 토글로 전환.

### 2-3. CLI 어댑터 패턴 (확장성의 핵심)

```typescript
interface CliAdapter {
  start(config: AgentConfig): SessionHandle;
  send(message: AgentMessage): Promise<void>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: (e: AgentEvent) => void): void;
}
```

구현체: `ClaudeCodeAdapter`, `CodexAdapter`, `GeminiCliAdapter`, ...
새 CLI는 어댑터 한 개 추가로 통합 가능.

---

## 3. 데이터 모델 (SQLite)

```sql
projects (
  id, name, workspace_path, created_at,
  default_model, default_effort
)

cli_agents (              -- 한 프로젝트에 여러 개
  id, project_id,
  cli_type,               -- 'claude-code' | 'codex' | 'gemini-cli' ...
  role_label,             -- 예: '백엔드 담당', '테스트 담당'
  model, effort,
  system_prompt_override
)

sessions (                -- 실행 인스턴스
  id, agent_id,
  status,                 -- 'running' | 'waiting_user' | 'idle' | 'crashed' | 'done'
  started_at, ended_at, pty_pid
)

events (                  -- stream-json에서 받은 모든 이벤트 로그
  id, session_id, type, payload_json, timestamp
)

checklists (
  id, project_id, source_file_path,
  content_md, parsed_tasks_json
)

schedules (
  id, project_id, cron_expr, task_ref,
  enabled, last_run_at
)
```

**모든 이벤트를 적재**해두면 개발일지 자동 생성, 리플레이, 감사 기능을 모두 얹을 수 있음.

---

## 4. 기능 요구사항별 구현 방향

### 4-1. 프로젝트 + LLM CLI 등록 및 현황 파악

워크스페이스 등록 시 **요약 전용 짧은 세션**을 1회 실행.

프롬프트 예시:
> "이 워크스페이스의 README, 최근 git log 20개, `.dev-console/logs/` 의 최신 일지를 읽고, ① 프로젝트 한 줄 요약 ② 마지막으로 진행된 작업 ③ 다음 할 일 후보 3개를 JSON으로 답하라."

결과를 대시보드 카드로 표시. chokidar로 워크스페이스 변경 감지 시 갱신 플래그 표시.

### 4-2. 모델 / Effort 선택

- **모델**: 드롭다운. 앱 시작 시 헬퍼 명령으로 동적 조회.
- **Effort**: low / medium / high / max 4단계 프리셋. 내부적으로 thinking budget 또는 모델 조합으로 매핑.
- CLI별 플래그 차이는 **어댑터가 흡수**.

### 4-3. "질문/지시 필요" 알림

stream-json에서 다음 이벤트 감지 시:
- 권한 요청
- 명시적 사용자 질문
- N초 이상 idle 상태

처리 순서:
1. Main이 세션을 `waiting_user`로 마크
2. IPC로 Renderer에 전달 → 대시보드 카드 깜빡임
3. **Electron `Notification` API**로 윈도우 네이티브 우측 하단 토스트
4. 알림 클릭 시 앱 포커스 + 해당 세션 뷰로 점프
5. 트레이 아이콘에 카운트 배지

### 4-4. 터미널 들락날락 + 명령어 입력

- **PTY 인스턴스 = Main 소유 (영속)**
- **xterm.js 인스턴스 = Renderer 소유, 탭 전환 시 detach/reattach**
- 화면 밖일 때 출력은 Main의 **링 버퍼**(최근 N KB)에 적재
- 재attach 시 버퍼 replay
- 사용자 키 입력은 그대로 stdin으로 전달 → 모든 CLI 명령어 사용 가능

### 4-5. 파일 참조 버튼

- `dialog.showOpenDialog`로 파일/다중 파일 선택
- 선택 경로를 활성 세션 입력 큐에 `@경로/파일.ext` 형태로 삽입
- Claude Code는 `@` prefix를 파일 참조로 인식

### 4-6. 멀티 에이전트 오케스트레이션

**v1 (단순 분담)**:
- 한 프로젝트에 N개 에이전트 등록 가능
- 각자 다른 모델/역할 부여
- 사용자가 수동으로 각 에이전트에 지시

**v2 (워크플로)**:
- 노드 그래프 에디터 (React Flow)
- 패턴:
  - **Coordinator**: 조율자 에이전트가 작업 분배 + 결과 통합
  - **Pipeline**: A → B → C (설계 → 구현 → 테스트)
  - **Parallel**: 같은 작업 여러 모델로 동시 실행, 결과 비교
- 에이전트 간 통신은 **Main의 메시지 버스**를 거침 (직접 stdin/stdout 연결 금지)

### 4-7. 종료 시 개발일지 자동 작성

"종료" 버튼은 2단계:

1. 현재 작업을 안전 지점까지 마무리하라는 시그널
2. 정해진 템플릿으로 일지 생성:
   - 오늘 한 일
   - 변경된 파일 목록
   - 다음 할 일
   - 미해결 이슈
3. 저장 위치: `{workspace}/.dev-console/logs/YYYY-MM-DD.md`

**이 디렉토리가 다음 세션의 "현황 파악" 입력이 되므로 형식 일관성 필수.**

### 4-8. "오늘 작업 시작" 버튼

플로우:
1. 프로젝트에 등록된 체크리스트(.md/.html) 파일 탐색
2. 체크박스 항목 파싱 (`- [ ]` 패턴, 또는 HTML 체크박스)
3. headless 세션 기동 + 시스템 프롬프트로 진행 지시 주입
4. 진행 상황을 대시보드 진행률 바로 표시

체크리스트 파서는 **인터페이스 추상화**: 정규식 기본 + YAML 프론트매터/JSON 스펙 확장 가능.

### 4-9. 스케줄링 (크론 + 예약)

- **node-cron**으로 표현식 처리
- `schedules` 테이블에 저장
- **앱 상시 동작 보장**: 트레이 상주 모드 제공
- 더 강한 보장이 필요하면 윈도우 작업 스케줄러 등록 옵션 추가
- 예약 시각 도래 → "오늘 작업 시작" 플로우 자동 트리거

### 4-10. 에러 자동 복구 (5분 이내 재개)

- 모든 세션에 **헬스체크 워치독** (30초 ping)
- 감지 조건:
  - stream-json 에러 이벤트
  - PTY 비정상 종료
  - N분간 출력 없음
- 감지 시 `crashed` 상태 전환 → **지수 백오프 재시도**: 30초 → 1분 → 2분 → 4분 (최대 5분)
- 재개 시 Claude Code의 `--resume` 또는 `--continue` 활용해 컨텍스트 이어받기
- 5분 내 3회 실패 시 사용자 알림 + 수동 개입 요청

---

## 5. 확장성 설계 원칙 (v1부터 지킬 것)

1. **CLI 어댑터 인터페이스 표준화** → 새 CLI 추가가 어댑터 한 개 추가로 끝남.
2. **모든 상호작용을 이벤트 스트림으로 모델링** → UI는 이벤트의 투영(projection). 리플레이, 원격 모니터링, 팀 공유 등이 자연스럽게 얹힘.
3. **플러그인 가능한 알림/액션 디스패처** → 윈도우 알림이 기본. 향후 슬랙/디스코드/이메일/모바일 푸시 라우팅 가능.

---

## 6. 마일스톤 (Claude Code에게 던질 단위)

각 마일스톤은 **독립적으로 동작 가능한 상태**를 목표로 함.

### M1: 골격
- Electron + React + TypeScript 보일러플레이트
- IPC 채널 구조
- SQLite 초기화 및 마이그레이션
- 빈 대시보드 UI (프로젝트 카드 리스트만)

### M2: 단일 세션
- 프로젝트/워크스페이스 1개 등록
- Claude Code 1개를 node-pty로 spawn
- xterm.js로 보기, stdin/stdout 왕복
- 종료 시 PTY 정리

### M3: Stream-JSON 통합
- headless 모드로 전환
- stream-json 이벤트 파서
- "질문 대기" 감지 + 윈도우 네이티브 알림
- 듀얼 채널(Agent/Terminal) 토글

### M4: 멀티 세션 + 영속화
- 여러 프로젝트, 여러 에이전트 동시 실행
- 모든 이벤트 SQLite 적재
- 탭 detach/reattach + 링 버퍼 replay
- 파일 참조 버튼

### M5: 자동화
- 체크리스트 파서 (.md/.html)
- "오늘 작업 시작" 플로우
- 종료 시 개발일지 자동 생성
- chokidar 기반 워크스페이스 갱신 감지

### M6: 스케줄러 + 복구
- node-cron 통합
- 트레이 상주 모드
- 헬스체크 워치독
- 지수 백오프 자동 재시작

### M7: 멀티 에이전트 오케스트레이션
- Coordinator 패턴 (v1: 수동 분담)
- 메시지 버스 구조
- (v2) Pipeline / Parallel 패턴
- (v2) React Flow 그래프 에디터

---

## 7. 미리 점검해둘 위험 요소

- **Claude Code stream-json 스키마 변경**: 어댑터에서 한 번 감싸고, 스키마 버전 감지 + 호환 레이어 도입.
- **윈도우 ConPTY 까다로움**: 한글 인코딩, 색상 코드, 창 리사이즈 이벤트. **M2에서 충분히 검증할 것.**
- **토큰 비용 누적**: 동시 세션이 많을수록 가속화. **대시보드에 누적 토큰/비용 표시는 v1 필수.**
- **파일 충돌**: 여러 에이전트가 같은 파일을 동시에 건드릴 위험. v1은 파일 단위 락 + 경고. v2에서 **git worktree 분리** 전략 고려.

---

## 8. 디렉토리 구조 제안

```
dev-console/
├── package.json
├── electron/
│   ├── main.ts                  # Main 진입점
│   ├── ipc/                     # IPC 핸들러
│   ├── orchestrator/            # 세션 매니저, 이벤트 버스
│   ├── adapters/                # CliAdapter 구현체
│   │   ├── claude-code.ts
│   │   ├── codex.ts
│   │   └── base.ts              # 인터페이스
│   ├── pty/                     # node-pty 래퍼, 링 버퍼
│   ├── db/                      # better-sqlite3 + 마이그레이션
│   ├── scheduler/               # node-cron
│   ├── watcher/                 # chokidar
│   ├── notify/                  # 알림 디스패처
│   └── recovery/                # 헬스체크, 재시도
├── src/                         # Renderer (React)
│   ├── App.tsx
│   ├── views/                   # 대시보드, 터미널, 설정
│   ├── components/
│   ├── stores/                  # Zustand
│   └── ipc-client.ts            # IPC 래퍼
├── shared/                      # Main/Renderer 공통 타입
│   └── types.ts
└── workspace-template/          # 워크스페이스에 주입할 .dev-console/ 템플릿
    └── .dev-console/
        ├── logs/
        └── config.json
```

---

## 9. Claude Code에게 작업 시작할 때 던질 첫 지시 예시

> "이 명세서를 읽고 M1만 먼저 구현하라. 디렉토리 구조는 8절을 따르되, M1에 필요한 최소한만 만들어라. Electron + React + TypeScript 보일러플레이트 + 빈 IPC 채널 + SQLite 초기화 + 프로젝트 카드 리스트가 보이는 빈 대시보드까지. 끝나면 M2로 넘어가기 전 동작 확인을 요청하라."

---

## 부록 A: 핵심 IPC 채널 (초안)

```typescript
// Renderer → Main
'projects:list' | 'projects:create' | 'projects:delete'
'agents:list' | 'agents:create' | 'agents:update'
'sessions:start' | 'sessions:stop' | 'sessions:send' | 'sessions:resize'
'sessions:attachTerminal' | 'sessions:detachTerminal'
'files:pickForReference'
'schedules:list' | 'schedules:create' | 'schedules:toggle'

// Main → Renderer (이벤트 푸시)
'session:event'         // stream-json 이벤트
'session:statusChange'  // running/waiting_user/...
'session:terminalData'  // PTY 출력 (Terminal 채널일 때)
'notification:show'     // UI에서도 표시할 알림
```

## 부록 B: AgentEvent 타입 (초안)

```typescript
type AgentEvent =
  | { type: 'message'; role: 'assistant'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; output: unknown }
  | { type: 'permission_request'; description: string }
  | { type: 'user_input_required'; prompt: string }
  | { type: 'usage'; tokens: { input: number; output: number } }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'session_end'; reason: string };
```
