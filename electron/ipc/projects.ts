import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { getDatabase } from '../db'
import type { CreateProjectInput, Project } from '@shared/types'

interface ProjectRow {
  id: string
  name: string
  workspace_path: string
  created_at: string
  default_model: string | null
  default_effort: Project['defaultEffort']
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    workspacePath: row.workspace_path,
    createdAt: row.created_at,
    defaultModel: row.default_model,
    defaultEffort: row.default_effort
  }
}

export function registerProjectHandlers(): void {
  ipcMain.handle('projects:list', (): Project[] => {
    const rows = getDatabase()
      .prepare('SELECT * FROM projects ORDER BY created_at DESC')
      .all() as ProjectRow[]
    return rows.map(rowToProject)
  })

  ipcMain.handle('projects:create', (_e, input: CreateProjectInput): Project => {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      workspacePath: input.workspacePath,
      createdAt: new Date().toISOString(),
      defaultModel: input.defaultModel ?? null,
      defaultEffort: input.defaultEffort ?? null
    }
    getDatabase()
      .prepare(
        `INSERT INTO projects (id, name, workspace_path, created_at, default_model, default_effort)
         VALUES (@id, @name, @workspacePath, @createdAt, @defaultModel, @defaultEffort)`
      )
      .run(project)
    return project
  })

  ipcMain.handle('projects:delete', (_e, id: string): void => {
    getDatabase().prepare('DELETE FROM projects WHERE id = ?').run(id)
  })
}
