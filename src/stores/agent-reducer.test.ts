import { describe, it, expect } from 'vitest'
import {
  initialAgentState, startSession, appendEvent, appendUser,
  setStatus, addPending, removePending
} from './agent-reducer'
import type { PermissionRequest } from '@shared/types'

const req = (id: string, sid = 'a1'): PermissionRequest =>
  ({ requestId: id, sessionId: sid, toolName: 'Write', input: {}, kind: 'tool' })

describe('agent-reducer', () => {
  it('startSession은 running 으로 리셋한다', () => {
    let s = initialAgentState()
    s = appendUser(s, 'old')
    s = startSession(s, 'a1')
    expect(s).toMatchObject({ sessionId: 'a1', status: 'running', log: [], pending: [] })
  })

  it('appendEvent / appendUser 는 증가하는 id 로 로그에 쌓인다', () => {
    let s = startSession(initialAgentState(), 'a1')
    s = appendUser(s, '안녕')
    s = appendEvent(s, { type: 'message', role: 'assistant', text: '하이' })
    expect(s.log).toEqual([
      { id: 0, kind: 'user', text: '안녕' },
      { id: 1, kind: 'event', event: { type: 'message', role: 'assistant', text: '하이' } }
    ])
  })

  it('setStatus 는 현재 세션만 반영(다른 sessionId 무시)', () => {
    let s = startSession(initialAgentState(), 'a1')
    s = setStatus(s, { sessionId: 'a2', status: 'idle' })
    expect(s.status).toBe('running')
    s = setStatus(s, { sessionId: 'a1', status: 'waiting_user' })
    expect(s.status).toBe('waiting_user')
  })

  it('addPending / removePending', () => {
    let s = startSession(initialAgentState(), 'a1')
    s = addPending(s, req('p1'))
    s = addPending(s, req('p2'))
    expect(s.pending.map((p) => p.requestId)).toEqual(['p1', 'p2'])
    s = removePending(s, 'p1')
    expect(s.pending.map((p) => p.requestId)).toEqual(['p2'])
  })

  it('addPending 은 다른 세션의 요청을 무시', () => {
    let s = startSession(initialAgentState(), 'a1')
    s = addPending(s, req('p1', 'other'))
    expect(s.pending).toHaveLength(0)
  })
})
