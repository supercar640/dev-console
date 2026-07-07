import { create } from 'zustand'
import { sessionsApi } from '@/ipc-client'
import { resolveCli, DEFAULT_CLI_ID } from '@shared/cli-registry'
import {
  type MultiTerminalState, type TerminalState, initialMultiTerminalState, terminalStateOf,
  setCliForProject, setCustomCommandForProject, startTerminalForProject, stopTerminalForProject, routeTerminalStatus
} from './session-multi'

interface SessionStore extends MultiTerminalState {
  selectCli: (projectId: string, cliId: string) => void
  setCustomCommand: (projectId: string, command: string) => void
  start: (projectId: string, cwd: string) => Promise<void>
  stop: (projectId: string) => Promise<void>
}

export const useSessionStore = create<SessionStore>((set, get) => {
  // 1회: Main 상태 변경(PTY 종료 등)을 소속 프로젝트로 라우팅.
  sessionsApi.onStatusChange((info) => set((s) => routeTerminalStatus(s, info)))
  return {
    ...initialMultiTerminalState(),
    selectCli: (projectId, cliId) => set((s) => setCliForProject(s, projectId, cliId)),
    setCustomCommand: (projectId, command) => set((s) => setCustomCommandForProject(s, projectId, command)),
    start: async (projectId, cwd) => {
      // 같은 프로젝트에 살아있는 세션이 있으면 먼저 정지(재시작 — Main은 추가만 하므로 누수 방지).
      const prev = terminalStateOf(get(), projectId)
      if (prev.sessionId) await sessionsApi.stop(prev.sessionId)
      const { command, args } = resolveCli(prev.cliId, prev.customCommand)
      const info = await sessionsApi.start({ projectId, command, args, cwd })
      set((s) => startTerminalForProject(s, projectId, info.sessionId))
    },
    stop: async (projectId) => {
      const id = terminalStateOf(get(), projectId).sessionId
      if (!id) return
      await sessionsApi.stop(id)
      set((s) => stopTerminalForProject(s, projectId))
    }
  }
})

const EMPTY_TERMINAL_STATE: TerminalState = { sessionId: null, status: null, cliId: DEFAULT_CLI_ID, customCommand: '' }
export function useTerminalProject(projectId: string): TerminalState {
  return useSessionStore((s) => s.byProject[projectId]) ?? EMPTY_TERMINAL_STATE
}
