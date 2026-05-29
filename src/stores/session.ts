import { create } from 'zustand'
import { sessionsApi } from '@/ipc-client'
import type { SessionInfo } from '@shared/types'

interface SessionState {
  sessionId: string | null
  status: SessionInfo['status'] | null
  command: string
  projectId: string | null
  setCommand: (c: string) => void
  start: (projectId: string, cwd: string) => Promise<void>
  stop: () => Promise<void>
}

export const useSessionStore = create<SessionState>((set, get) => {
  // 1회: Main의 상태 변경(예: PTY 종료)을 UI에 반영.
  sessionsApi.onStatusChange((info) => {
    if (info.sessionId === get().sessionId) set({ status: info.status })
  })
  return {
    sessionId: null,
    status: null,
    // Windows 기본 셸. claude는 이 셸 안에서 입력(M2 비목표 — pwsh는 이 머신에 미설치).
    command: 'powershell',
    projectId: null,
    setCommand: (c) => set({ command: c }),
    start: async (projectId, cwd) => {
      const info = await sessionsApi.start({ projectId, command: get().command, args: [], cwd })
      set({ sessionId: info.sessionId, status: info.status, projectId })
    },
    stop: async () => {
      const id = get().sessionId
      if (!id) return
      await sessionsApi.stop(id)
      set({ sessionId: null, status: null })
    }
  }
})
