// 열린 프로젝트 목록 + 활성 선택. 순수 전이 → node vitest.
// 닫기 = 사이드바에서만 제거(세션은 Main에서 계속 — 절대원칙 #2).
import type { Project } from '@shared/types'

export interface WorkspacesState {
  openProjects: Project[]
  activeProjectId: string | null
}

export function initialWorkspacesState(): WorkspacesState {
  return { openProjects: [], activeProjectId: null }
}

/** 사이드바에 추가(이미 있으면 그대로). 활성 선택은 바꾸지 않는다. */
export function openProject(s: WorkspacesState, project: Project): WorkspacesState {
  if (s.openProjects.some((p) => p.id === project.id)) return s
  return { ...s, openProjects: [...s.openProjects, project] }
}

/** 사이드바에서 제거. 활성이 닫히면 활성=null. */
export function closeProject(s: WorkspacesState, projectId: string): WorkspacesState {
  return {
    openProjects: s.openProjects.filter((p) => p.id !== projectId),
    activeProjectId: s.activeProjectId === projectId ? null : s.activeProjectId
  }
}

/** 활성 전환. null=대시보드. 열려있지 않은 id는 무시(불변식: active는 null 또는 열린 프로젝트). */
export function setActiveProject(s: WorkspacesState, projectId: string | null): WorkspacesState {
  if (projectId === null) return { ...s, activeProjectId: null }
  if (!s.openProjects.some((p) => p.id === projectId)) return s
  return { ...s, activeProjectId: projectId }
}
