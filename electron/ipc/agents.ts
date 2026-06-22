import { ipcMain, BrowserWindow } from 'electron'
import type { ClaudeAgentManager } from '../agent/agent-manager'
import type { AgentNotifier } from '../agent/notifier'
import type { AgentStore } from '../db/agent-store'
import type {
  AgentStartInput, AgentSessionInfo, AgentEventPayload, PermissionDecision, PermissionRequest,
  RestoredSession
} from '@shared/types'

export function registerAgentHandlers(
  agentManager: ClaudeAgentManager,
  notifier: AgentNotifier,
  agentStore: AgentStore
): void {
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
  }
  // 저장은 best-effort 부수효과 — 실패해도 앱/세션을 멈추지 않는다(로깅만).
  const safe = (fn: () => void): void => {
    try { fn() } catch (err) { console.error('[agent-store]', err) }
  }

  agentManager.onEvent((sessionId, event) => {
    const payload: AgentEventPayload = { sessionId, event }
    broadcast('agent:event', payload)
    safe(() => agentStore.recordEvent(sessionId, event, new Date().toISOString()))
  })
  agentManager.onStatus((info: AgentSessionInfo) => {
    broadcast('agent:statusChange', info)
    notifier.onStatus(info)
    if (info.status === 'done' || info.status === 'crashed') {
      safe(() => agentStore.recordSessionEnd(info.sessionId, info.status, new Date().toISOString()))
    }
  })
  agentManager.onPermissionRequest((req: PermissionRequest) => {
    broadcast('agent:permissionRequest', req)
    notifier.onPermissionRequest(req)
  })

  ipcMain.handle('agents:start', (_e, input: AgentStartInput): AgentSessionInfo => {
    const info = agentManager.start(input)
    safe(() => agentStore.recordSessionStart(info.sessionId, input.projectId, new Date().toISOString()))
    return info
  })
  ipcMain.handle('agents:send', (_e, { sessionId, text }: { sessionId: string; text: string }): void =>
    agentManager.send(sessionId, text))
  ipcMain.handle('agents:respondPermission',
    (_e, a: { sessionId: string; requestId: string; decision: PermissionDecision }): void =>
      agentManager.respondPermission(a.sessionId, a.requestId, a.decision))
  ipcMain.handle('agents:interrupt', (_e, { sessionId }: { sessionId: string }): Promise<void> =>
    agentManager.interrupt(sessionId))
  ipcMain.handle('agents:stop', (_e, { sessionId }: { sessionId: string }): void =>
    agentManager.stop(sessionId))
  ipcMain.handle('agents:loadHistory', (): RestoredSession[] => {
    // 복원 읽기도 best-effort — 실패해도 빈 목록으로 정상 부팅(로깅만).
    try { return agentStore.loadHistory() } catch (err) { console.error('[agent-store]', err); return [] }
  })
}
