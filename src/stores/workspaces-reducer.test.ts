import { describe, it, expect } from 'vitest'
import {
  initialWorkspacesState, openProject, closeProject, setActiveProject
} from './workspaces-reducer'
import type { Project } from '@shared/types'

const mk = (id: string): Project => ({
  id, name: id, workspacePath: `C:\\${id}`, createdAt: '', defaultModel: null, defaultEffort: null
})

describe('workspaces-reducer', () => {
  it('openProject는 추가하고 중복은 무시하며 활성은 바꾸지 않는다', () => {
    let s = initialWorkspacesState()
    s = openProject(s, mk('a'))
    s = openProject(s, mk('a'))
    s = openProject(s, mk('b'))
    expect(s.openProjects.map((p) => p.id)).toEqual(['a', 'b'])
    expect(s.activeProjectId).toBeNull()
  })

  it('setActiveProject는 열린 프로젝트만 활성화하고 미열림 id는 무시한다', () => {
    let s = openProject(initialWorkspacesState(), mk('a'))
    s = setActiveProject(s, 'a')
    expect(s.activeProjectId).toBe('a')
    s = setActiveProject(s, 'ghost')
    expect(s.activeProjectId).toBe('a')
    s = setActiveProject(s, null)
    expect(s.activeProjectId).toBeNull()
  })

  it('closeProject는 목록에서 제거하고, 활성이 닫히면 활성을 해제한다', () => {
    let s = openProject(openProject(initialWorkspacesState(), mk('a')), mk('b'))
    s = setActiveProject(s, 'b')
    s = closeProject(s, 'b')
    expect(s.openProjects.map((p) => p.id)).toEqual(['a'])
    expect(s.activeProjectId).toBeNull()
  })

  it('비활성 프로젝트를 닫아도 활성은 유지된다', () => {
    let s = openProject(openProject(initialWorkspacesState(), mk('a')), mk('b'))
    s = setActiveProject(s, 'a')
    s = closeProject(s, 'b')
    expect(s.activeProjectId).toBe('a')
  })
})
