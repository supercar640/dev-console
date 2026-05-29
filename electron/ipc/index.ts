import { registerProjectHandlers } from './projects'
import { registerSessionHandlers } from './sessions'
import type { PtyManager } from '../pty/pty-manager'

// Single entry point for all IPC handler registration (spec 부록 A).
// Grows per milestone: agents, sessions, files, schedules, ...
export function registerIpcHandlers(ptyManager: PtyManager): void {
  registerProjectHandlers()
  registerSessionHandlers(ptyManager)
}
