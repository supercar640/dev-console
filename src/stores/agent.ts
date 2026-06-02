import { create } from 'zustand'
import { agentsApi } from '@/ipc-client'
import { useWorkspacesStore } from './workspaces'
import {
  type MultiAgentState, initialMultiAgentState, agentStateOf,
  startForProject, appendUserForProject, removePendingForProject,
  routeEvent, routeStatus, routePermission, projectOfSession
} from './agent-multi'
import { type AgentState, type LogItem, initialAgentState } from './agent-reducer'

interface AgentStore extends MultiAgentState {
  focusTick: number // focusSession 수신 시 증가 → 뷰가 반응(스크롤)
  start: (projectId: string, cwd: string, firstMessage?: string) => Promise<void>
  send: (projectId: string, text: string) => Promise<void>
  approve: (projectId: string, requestId: string) => Promise<void>
  deny: (projectId: string, requestId: string, message?: string) => Promise<void>
  interrupt: (projectId: string) => Promise<void>
  stop: (projectId: string) => Promise<void>
}

export const useAgentStore = create<AgentStore>((set, get) => {
  // 1회 구독: Main 이벤트를 sessionId→projectId 로 라우팅.
  agentsApi.onEvent(({ sessionId, event }) => set((s) => routeEvent(s, sessionId, event)))
  agentsApi.onStatusChange((info) => set((s) => routeStatus(s, info)))
  agentsApi.onPermissionRequest((req) => set((s) => routePermission(s, req)))
  agentsApi.onFocusSession((sessionId) => {
    const pid = projectOfSession(get(), sessionId)
    if (pid) useWorkspacesStore.getState().setActive(pid) // 알림 클릭 → 소속 프로젝트로 점프
    set((s) => ({ focusTick: s.focusTick + 1 }))
  })

  return {
    ...initialMultiAgentState(),
    focusTick: 0,
    start: async (projectId, cwd, firstMessage) => {
      const info = await agentsApi.start({ projectId, cwd, firstMessage })
      set((s) => startForProject(s, projectId, info.sessionId))
    },
    send: async (projectId, text) => {
      const id = agentStateOf(get(), projectId).sessionId
      if (!id) return
      set((s) => appendUserForProject(s, projectId, text))
      await agentsApi.send(id, text)
    },
    approve: async (projectId, requestId) => {
      const id = agentStateOf(get(), projectId).sessionId
      if (!id) return
      set((s) => removePendingForProject(s, projectId, requestId))
      await agentsApi.respondPermission(id, requestId, { behavior: 'allow' })
    },
    deny: async (projectId, requestId, message) => {
      const id = agentStateOf(get(), projectId).sessionId
      if (!id) return
      set((s) => removePendingForProject(s, projectId, requestId))
      await agentsApi.respondPermission(id, requestId, { behavior: 'deny', message })
    },
    interrupt: async (projectId) => {
      const id = agentStateOf(get(), projectId).sessionId
      if (id) await agentsApi.interrupt(id)
    },
    stop: async (projectId) => {
      const id = agentStateOf(get(), projectId).sessionId
      if (id) await agentsApi.stop(id)
    }
  }
})

// 프로젝트별 슬라이스 선택 훅. 셀렉터는 안정 참조(undefined)를 반환하고,
// 없을 때만 모듈 상수로 대체 → 무한 리렌더(매번 새 객체) 방지.
const EMPTY_AGENT_STATE: AgentState = initialAgentState()
export function useAgentProject(projectId: string): AgentState {
  return useAgentStore((s) => s.byProject[projectId]) ?? EMPTY_AGENT_STATE
}

export type { LogItem }
