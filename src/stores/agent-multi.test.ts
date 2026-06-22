import { describe, it, expect } from 'vitest'
import {
  initialMultiAgentState, agentStateOf, startForProject, appendUserForProject,
  removePendingForProject, routeEvent, routeStatus, routePermission, projectOfSession,
  hydrateProject, resetForProject
} from './agent-multi'
import type { PermissionRequest, RestoredSession } from '@shared/types'

const perm = (requestId: string, sessionId: string): PermissionRequest =>
  ({ requestId, sessionId, toolName: 'Write', input: {}, kind: 'tool' })

describe('agent-multi', () => {
  it('startForProject는 프로젝트별 상태(running)와 인덱스를 만든다', () => {
    let s = startForProject(initialMultiAgentState(), 'p1', 'a1')
    s = startForProject(s, 'p2', 'a2')
    expect(agentStateOf(s, 'p1').sessionId).toBe('a1')
    expect(agentStateOf(s, 'p1').status).toBe('running')
    expect(agentStateOf(s, 'p2').sessionId).toBe('a2')
    expect(projectOfSession(s, 'a1')).toBe('p1')
    expect(projectOfSession(s, 'a2')).toBe('p2')
  })

  it('routeEvent는 sessionId로 올바른 프로젝트에만 적재한다', () => {
    let s = startForProject(startForProject(initialMultiAgentState(), 'p1', 'a1'), 'p2', 'a2')
    s = routeEvent(s, 'a1', { type: 'message', role: 'assistant', text: '하이' })
    expect(agentStateOf(s, 'p1').log).toHaveLength(1)
    expect(agentStateOf(s, 'p2').log).toHaveLength(0)
  })

  it('routeEvent는 미지의 sessionId를 무시한다(동일 참조 반환)', () => {
    const s0 = startForProject(initialMultiAgentState(), 'p1', 'a1')
    const s1 = routeEvent(s0, 'ghost', { type: 'message', role: 'assistant', text: 'x' })
    expect(s1).toBe(s0)
  })

  it('routeStatus는 소속 프로젝트 상태만 바꾼다', () => {
    let s = startForProject(startForProject(initialMultiAgentState(), 'p1', 'a1'), 'p2', 'a2')
    s = routeStatus(s, { sessionId: 'a2', status: 'waiting_user' })
    expect(agentStateOf(s, 'p1').status).toBe('running')
    expect(agentStateOf(s, 'p2').status).toBe('waiting_user')
  })

  it('routePermission은 소속 프로젝트 pending에 추가, removePendingForProject로 제거', () => {
    let s = startForProject(initialMultiAgentState(), 'p1', 'a1')
    s = routePermission(s, perm('r1', 'a1'))
    expect(agentStateOf(s, 'p1').pending.map((p) => p.requestId)).toEqual(['r1'])
    s = removePendingForProject(s, 'p1', 'r1')
    expect(agentStateOf(s, 'p1').pending).toHaveLength(0)
  })

  it('appendUserForProject는 해당 프로젝트 로그에 사용자 입력을 넣는다', () => {
    let s = startForProject(initialMultiAgentState(), 'p1', 'a1')
    s = appendUserForProject(s, 'p1', '안녕')
    expect(agentStateOf(s, 'p1').log).toEqual([{ id: 0, kind: 'user', text: '안녕' }])
  })

  it('startForProject 재호출 시 이전 sessionId 인덱스를 제거(스테일 이벤트 무시)', () => {
    let s = startForProject(initialMultiAgentState(), 'p1', 'a1')
    s = startForProject(s, 'p1', 'a1b')
    expect(projectOfSession(s, 'a1')).toBeNull()
    expect(projectOfSession(s, 'a1b')).toBe('p1')
    const before = s
    expect(routeEvent(s, 'a1', { type: 'message', role: 'assistant', text: 'stale' })).toBe(before)
  })

  it('agentStateOf는 미지 프로젝트에 초기 상태를 돌려준다', () => {
    expect(agentStateOf(initialMultiAgentState(), 'none')).toMatchObject({ sessionId: null, status: null, log: [] })
  })
})

const restored: RestoredSession = {
  projectId: 'p1',
  sessionId: 's-uuid',
  status: 'done',
  events: [{ type: 'message', role: 'assistant', text: 'hi' }]
}

describe('agent-multi 복원/리셋', () => {
  it('hydrateProject는 읽기 전용 복원본을 채우고 인덱스를 등록한다', () => {
    const s = hydrateProject(initialMultiAgentState(), restored)
    const st = agentStateOf(s, 'p1')
    expect(st.live).toBe(false)
    expect(st.status).toBe('done')
    expect(st.log).toHaveLength(1)
    expect(s.sessionIndex['s-uuid']).toBe('p1')
  })

  it('resetForProject는 라이브 빈 상태로 비우고 이전 sessionId 인덱스를 제거한다', () => {
    const hydrated = hydrateProject(initialMultiAgentState(), restored)
    const reset = resetForProject(hydrated, 'p1')
    const st = agentStateOf(reset, 'p1')
    expect(st.live).toBe(true)
    expect(st.sessionId).toBeNull()
    expect(st.log).toHaveLength(0)
    expect(reset.sessionIndex['s-uuid']).toBeUndefined()
  })
})
