import type { CreateProjectInput, Project } from '@shared/types'

// Thin typed wrapper over the contextBridge surface (window.api).
// Renderer code imports from here, never touches window.api directly.
export const projectsApi = {
  list: (): Promise<Project[]> => window.api.projects.list(),
  create: (input: CreateProjectInput): Promise<Project> => window.api.projects.create(input),
  delete: (id: string): Promise<void> => window.api.projects.delete(id)
}
