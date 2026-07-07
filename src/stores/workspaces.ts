import { create } from 'zustand'
import type { Project } from '@shared/types'
import {
  type WorkspacesState, initialWorkspacesState,
  openProject, closeProject, setActiveProject
} from './workspaces-reducer'

interface WorkspacesStore extends WorkspacesState {
  open: (project: Project) => void
  close: (projectId: string) => void
  setActive: (projectId: string | null) => void
}

// 주: Zustand set 은 얕은 병합 — reducer가 데이터만 돌려줘도 액션은 보존된다.
export const useWorkspacesStore = create<WorkspacesStore>((set) => ({
  ...initialWorkspacesState(),
  open: (project) => set((s) => setActiveProject(openProject(s, project), project.id)),
  close: (projectId) => set((s) => closeProject(s, projectId)),
  setActive: (projectId) => set((s) => setActiveProject(s, projectId))
}))
