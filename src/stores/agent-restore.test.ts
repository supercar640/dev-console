import { describe, it, expect } from 'vitest'
import { restoreAgentState } from './agent-restore'
import { initialAgentState, appendEvent } from './agent-reducer'
import { computeProjectProgress } from './project-progress'
import type { RestoredSession } from '@shared/types'

const restored: RestoredSession = {
  projectId: 'p1',
  sessionId: 's-uuid',
  status: 'crashed',
  events: [
    { type: 'message', role: 'assistant', text: '시작합니다' },
    { type: 'tool_use', name: 'TodoWrite', input: { todos: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' }
    ] } }
  ]
}

describe('agent-restore', () => {
  it('이벤트 재생 결과 log가 라이브로 흘렸을 때와 동일하다', () => {
    const live = appendEvent(appendEvent(initialAgentState(), restored.events[0]), restored.events[1])
    const out = restoreAgentState(restored)
    expect(out.log).toEqual(live.log)
  })

  it('복원 상태는 읽기 전용(live=false) + 저장된 status + sessionId 다', () => {
    const out = restoreAgentState(restored)
    expect(out.live).toBe(false)
    expect(out.status).toBe('crashed')
    expect(out.sessionId).toBe('s-uuid')
  })

  it('복원된 log에서 진척도가 올바로 산출된다', () => {
    const progress = computeProjectProgress(restoreAgentState(restored))
    expect(progress.percent).toBe(50)
    expect(progress.current).toBe('b')
    expect(progress.todoCounts).toEqual({ done: 1, total: 2 })
  })
})
