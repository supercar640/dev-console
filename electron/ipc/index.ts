import { registerProjectHandlers } from './projects'
import { registerSessionHandlers } from './sessions'
import { registerDialogHandlers } from './dialog'
import { registerAgentHandlers } from './agents'
import type { PtyManager } from '../pty/pty-manager'
import type { ClaudeAgentManager } from '../agent/agent-manager'
import type { AgentNotifier } from '../agent/notifier'
import type { AgentStore } from '../db/agent-store'

export function registerIpcHandlers(
  ptyManager: PtyManager,
  agentManager: ClaudeAgentManager,
  notifier: AgentNotifier,
  agentStore: AgentStore
): void {
  registerProjectHandlers()
  registerSessionHandlers(ptyManager)
  registerDialogHandlers()
  registerAgentHandlers(agentManager, notifier, agentStore)
}
