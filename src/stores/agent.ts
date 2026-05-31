import { create } from 'zustand'
import { agentsApi } from '@/ipc-client'
import {
  type AgentState, type LogItem,
  initialAgentState, startSession, appendEvent, appendUser, setStatus, addPending, removePending
} from './agent-reducer'

interface AgentStore extends AgentState {
  focusTick: number // focusSession 수신 시 증가 → 뷰가 반응(탭 전환/스크롤)
  start: (projectId: string, cwd: string, firstMessage?: string) => Promise<void>
  send: (text: string) => Promise<void>
  approve: (requestId: string) => Promise<void>
  deny: (requestId: string, message?: string) => Promise<void>
  interrupt: () => Promise<void>
  stop: () => Promise<void>
}

export const useAgentStore = create<AgentStore>((set, get) => {
  // 1회 구독: Main 이벤트를 reducer 로 reduce.
  agentsApi.onEvent(({ sessionId, event }) => {
    if (sessionId === get().sessionId) set((s) => appendEvent(s as AgentState, event))
  })
  agentsApi.onStatusChange((info) => set((s) => setStatus(s as AgentState, info)))
  agentsApi.onPermissionRequest((req) => set((s) => addPending(s as AgentState, req)))
  agentsApi.onFocusSession((sessionId) => {
    if (sessionId === get().sessionId) set((s) => ({ focusTick: s.focusTick + 1 }))
  })

  return {
    ...initialAgentState(),
    focusTick: 0,
    start: async (projectId, cwd, firstMessage) => {
      const info = await agentsApi.start({ projectId, cwd, firstMessage })
      set((s) => ({ ...startSession(s as AgentState, info.sessionId), focusTick: s.focusTick }))
    },
    send: async (text) => {
      const id = get().sessionId
      if (!id) return
      set((s) => appendUser(s as AgentState, text))
      await agentsApi.send(id, text)
    },
    approve: async (requestId) => {
      const id = get().sessionId
      if (!id) return
      set((s) => removePending(s as AgentState, requestId))
      await agentsApi.respondPermission(id, requestId, { behavior: 'allow' })
    },
    deny: async (requestId, message) => {
      const id = get().sessionId
      if (!id) return
      set((s) => removePending(s as AgentState, requestId))
      await agentsApi.respondPermission(id, requestId, { behavior: 'deny', message })
    },
    interrupt: async () => {
      const id = get().sessionId
      if (id) await agentsApi.interrupt(id)
    },
    stop: async () => {
      const id = get().sessionId
      if (id) await agentsApi.stop(id)
    }
  }
})

export type { LogItem }
