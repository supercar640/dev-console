import { ipcMain, BrowserWindow } from 'electron'
import type { ClaudeAgentManager } from '../agent/agent-manager'
import type { AgentNotifier } from '../agent/notifier'
import type {
  AgentStartInput, AgentSessionInfo, AgentEventPayload, PermissionDecision, PermissionRequest
} from '@shared/types'

export function registerAgentHandlers(agentManager: ClaudeAgentManager, notifier: AgentNotifier): void {
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
  }

  agentManager.onEvent((sessionId, event) => {
    const payload: AgentEventPayload = { sessionId, event }
    broadcast('agent:event', payload)
  })
  agentManager.onStatus((info: AgentSessionInfo) => {
    broadcast('agent:statusChange', info)
    notifier.onStatus(info)
  })
  agentManager.onPermissionRequest((req: PermissionRequest) => {
    broadcast('agent:permissionRequest', req)
    notifier.onPermissionRequest(req)
  })

  ipcMain.handle('agents:start', (_e, input: AgentStartInput): AgentSessionInfo => agentManager.start(input))
  ipcMain.handle('agents:send', (_e, { sessionId, text }: { sessionId: string; text: string }): void =>
    agentManager.send(sessionId, text))
  ipcMain.handle('agents:respondPermission',
    (_e, a: { sessionId: string; requestId: string; decision: PermissionDecision }): void =>
      agentManager.respondPermission(a.sessionId, a.requestId, a.decision))
  ipcMain.handle('agents:interrupt', (_e, { sessionId }: { sessionId: string }): Promise<void> =>
    agentManager.interrupt(sessionId))
  ipcMain.handle('agents:stop', (_e, { sessionId }: { sessionId: string }): void =>
    agentManager.stop(sessionId))
}
