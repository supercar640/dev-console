import { registerProjectHandlers } from './projects'

// Single entry point for all IPC handler registration (spec 부록 A).
// Grows per milestone: agents, sessions, files, schedules, ...
export function registerIpcHandlers(): void {
  registerProjectHandlers()
}
