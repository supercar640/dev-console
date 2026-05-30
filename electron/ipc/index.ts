import { registerProjectHandlers } from './projects'
import { registerSessionHandlers } from './sessions'
import { registerDialogHandlers } from './dialog'
import { registerAgentHandlers } from './agents'
import type { PtyManager } from '../pty/pty-manager'
import type { ClaudeAgentManager } from '../agent/agent-manager'

export function registerIpcHandlers(ptyManager: PtyManager, agentManager: ClaudeAgentManager): void {
  registerProjectHandlers()
  registerSessionHandlers(ptyManager)
  registerDialogHandlers()
  registerAgentHandlers(agentManager)
}
