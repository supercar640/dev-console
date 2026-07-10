// Shared types between Main and Renderer (spec §8 `shared/`).
// Keep this dependency-free so both processes can import it.

export type Effort = 'low' | 'medium' | 'high' | 'max'

/** spec §3 `projects` table */
export interface Project {
  id: string
  name: string
  workspacePath: string
  createdAt: string
  defaultModel: string | null
  defaultEffort: Effort | null
}

export interface CreateProjectInput {
  name: string
  workspacePath: string
  defaultModel?: string | null
  defaultEffort?: Effort | null
}

/** spec §3 `sessions.status` / lifecycle state machine */
export type SessionStatus = 'running' | 'waiting_user' | 'idle' | 'crashed' | 'done'

/** spec 부록 B — normalized event emitted by every CliAdapter.
 *  NOTE: this is the adapter-agnostic shape. stream-json is an implementation
 *  detail of ClaudeCodeAdapter, not a contract here (see plan/dev-console-direction.md §1-3). */
export type AgentEvent =
  | { type: 'message'; role: 'assistant'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; output: unknown }
  | { type: 'permission_request'; description: string }
  | { type: 'user_input_required'; prompt: string }
  | { type: 'usage'; tokens: { input: number; output: number } }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'session_end'; reason: string }

/** M3 Agent 채널 — 세션 시작 입력. */
export interface AgentStartInput {
  projectId: string
  cwd: string
  model?: string
  /** 시작과 동시에 보낼 첫 사용자 메시지(없으면 send로 첫 턴 시작). */
  firstMessage?: string
}

/** M3 Agent 세션 런타임 정보 (lifecycle = SessionStatus). */
export interface AgentSessionInfo {
  sessionId: string
  status: SessionStatus
}

/** M4b — 재시작 시 복원되는 "프로젝트별 마지막 세션 1건"(읽기 전용). */
export interface RestoredSession {
  projectId: string
  sessionId: string
  status: SessionStatus
  events: AgentEvent[]
}

/** waiting_user 상태에서 UI로 올라가는 승인/질문 요청. */
export interface PermissionRequest {
  requestId: string
  sessionId: string
  toolName: string
  input: unknown
  /** AskUserQuestion = 'question', 그 외 도구 = 'tool'. */
  kind: 'tool' | 'question'
}

/** UI가 돌려주는 권한 결정. */
export type PermissionDecision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message?: string }

/** Main → Renderer: 정규화 이벤트 1건. */
export interface AgentEventPayload {
  sessionId: string
  event: AgentEvent
}

/** The API surface exposed to the renderer through contextBridge (`window.api`).
 *  Mirrors the IPC channels in spec 부록 A. Grows per milestone. */
export interface DevConsoleApi {
  projects: {
    list(): Promise<Project[]>
    create(input: CreateProjectInput): Promise<Project>
    delete(id: string): Promise<void>
  }
  sessions: {
    start(input: StartSessionInput): Promise<SessionInfo>
    stop(sessionId: string): Promise<void>
    send(sessionId: string, data: string): Promise<void>
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    attachTerminal(sessionId: string): Promise<SessionInfo | null>
    detachTerminal(sessionId: string): Promise<void>
    /** 구독 등록. 반환된 함수를 호출하면 해제. */
    onTerminalData(cb: (sessionId: string, data: Uint8Array) => void): () => void
    onStatusChange(cb: (info: SessionInfo) => void): () => void
  }
  agents: {
    start(input: AgentStartInput): Promise<AgentSessionInfo>
    send(sessionId: string, text: string): Promise<void>
    respondPermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>
    interrupt(sessionId: string): Promise<void>
    stop(sessionId: string): Promise<void>
    /** 구독 등록. 반환 함수 호출 시 해제. */
    onEvent(cb: (payload: AgentEventPayload) => void): () => void
    onStatusChange(cb: (info: AgentSessionInfo) => void): () => void
    onPermissionRequest(cb: (req: PermissionRequest) => void): () => void
    onFocusSession(cb: (sessionId: string) => void): () => void
    /** M4b — 재시작 시 프로젝트별 마지막 세션을 복원용으로 일괄 조회. */
    loadHistory(): Promise<RestoredSession[]>
  }
  dialog: {
    /** 네이티브 폴더 선택 다이얼로그. 취소 시 null. */
    openDirectory(): Promise<string | null>
  }
  files: {
    /** 참조할 파일을 복수 선택. 취소 시 빈 배열. */
    pickForReference(): Promise<string[]>
  }
}

/** M2 PtyManager 입력 (spec §6 M2, design D3 범용 명령). */
export interface StartOpts {
  command: string
  args: string[]
  cwd: string
  cols?: number
  rows?: number
}

/** M2 단일 세션 런타임 정보. (lifecycle 문자열 유니온 `SessionStatus`와 별개 — M2는 running/exited만.) */
export interface SessionInfo {
  sessionId: string
  status: 'running' | 'exited'
  pid: number
  exitCode?: number
}

/** sessions:start IPC 입력 = StartOpts + 어느 프로젝트인지. */
export interface StartSessionInput extends StartOpts {
  projectId: string
}

/** session:terminalData 이벤트 페이로드. data는 렌더러에서 Uint8Array로 도착. */
export interface TerminalDataPayload {
  sessionId: string
  data: Uint8Array
}
