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

/** The API surface exposed to the renderer through contextBridge (`window.api`).
 *  Mirrors the IPC channels in spec 부록 A. Grows per milestone. */
export interface DevConsoleApi {
  projects: {
    list(): Promise<Project[]>
    create(input: CreateProjectInput): Promise<Project>
    delete(id: string): Promise<void>
  }
}
