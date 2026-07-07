import { describe, it, expect } from 'vitest'
import { computeProjectProgress } from './project-progress'
import { initialAgentState, appendEvent, startSession, type AgentState } from './agent-reducer'
import type { AgentEvent } from '@shared/types'

function withEvents(...events: AgentEvent[]): AgentState {
  let s = startSession(initialAgentState(), 'a1')
  for (const e of events) s = appendEvent(s, e)
  return s
}
const todoWrite = (todos: unknown[]): AgentEvent =>
  ({ type: 'tool_use', name: 'TodoWrite', input: { todos } })

describe('computeProjectProgress', () => {
  it('빈 상태는 모두 null', () => {
    expect(computeProjectProgress(initialAgentState())).toEqual({
      percent: null, current: null, todoCounts: null
    })
  })

  it('5개 중 2 완료 + 1 진행 → 40%, current=진행 항목(activeForm)', () => {
    const s = withEvents(todoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
      { content: 'c', status: 'in_progress', activeForm: '로그인 폼 테스트 작성 중' },
      { content: 'd', status: 'pending' },
      { content: 'e', status: 'pending' }
    ]))
    expect(computeProjectProgress(s)).toEqual({
      percent: 40, current: '로그인 폼 테스트 작성 중', todoCounts: { done: 2, total: 5 }
    })
  })

  it('activeForm 없으면 content 로 대체', () => {
    const s = withEvents(todoWrite([{ content: '빌드 실행', status: 'in_progress' }]))
    expect(computeProjectProgress(s).current).toBe('빌드 실행')
  })

  it('가장 최근 TodoWrite 스냅샷을 채택', () => {
    const s = withEvents(
      todoWrite([{ content: 'a', status: 'pending' }, { content: 'b', status: 'pending' }]),
      todoWrite([{ content: 'a', status: 'completed' }, { content: 'b', status: 'completed' }])
    )
    expect(computeProjectProgress(s).percent).toBe(100)
  })

  it('TodoWrite 없으면 막대 없음 + 마지막 assistant 메시지를 current 로(첫 줄·80자)', () => {
    const s = withEvents(
      { type: 'tool_use', name: 'Read', input: {} },
      { type: 'message', role: 'assistant', text: '파일을 분석했습니다\n다음 줄' }
    )
    expect(computeProjectProgress(s)).toEqual({
      percent: null, current: '파일을 분석했습니다', todoCounts: null
    })
  })

  it('메시지 없으면 마지막 tool_use 이름을 current 로(TodoWrite 는 활동에서 제외)', () => {
    expect(computeProjectProgress(withEvents({ type: 'tool_use', name: 'Bash', input: {} })).current)
      .toBe('Bash 실행 중')
  })

  it('todos 가 배열이 아니면 진척도 없음', () => {
    const s = withEvents({ type: 'tool_use', name: 'TodoWrite', input: { todos: 'oops' } })
    expect(computeProjectProgress(s).percent).toBeNull()
  })

  it('in_progress 없고 일부 완료면 %만, current=null(TodoWrite 만 있으므로)', () => {
    const s = withEvents(todoWrite([
      { content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }
    ]))
    expect(computeProjectProgress(s)).toEqual({
      percent: 50, current: null, todoCounts: { done: 1, total: 2 }
    })
  })
})
