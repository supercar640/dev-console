import { create } from 'zustand'
import type { CreateProjectInput, Project } from '@shared/types'
import { projectsApi } from '@/ipc-client'

interface ProjectsState {
  projects: Project[]
  loading: boolean
  error: string | null
  load: () => Promise<void>
  add: (input: CreateProjectInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null })
    try {
      const projects = await projectsApi.list()
      set({ projects, loading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },
  add: async (input) => {
    await projectsApi.create(input)
    await get().load()
  },
  remove: async (id) => {
    await projectsApi.delete(id)
    await get().load()
  }
}))
