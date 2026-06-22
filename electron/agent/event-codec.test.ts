import { describe, it, expect } from 'vitest'
import { encodeEvent, decodeEvent, resolveRestoredStatus } from './event-codec'
import type { AgentEvent } from '@shared/types'

const SAMPLES: AgentEvent[] = [
  { type: 'message', role: 'assistant', text: 'hi\nthere' },
  { type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'a', status: 'completed' }] } },
  { type: 'tool_result', name: 'Bash', output: 'ok' },
  { type: 'permission_request', description: 'Bash: ls' },
  { type: 'user_input_required', prompt: '{"q":1}' },
  { type: 'usage', tokens: { input: 3, output: 5 } },
  { type: 'error', message: 'boom', recoverable: false },
  { type: 'session_end', reason: 'done' }
]

describe('event-codec', () => {
  it('모든 AgentEvent variant를 직렬화→역직렬화하면 원본과 같다', () => {
    for (const e of SAMPLES) {
      expect(decodeEvent(encodeEvent(e))).toEqual(e)
    }
  })

  it('깨진 JSON / null / 미지 타입은 null로 방어한다', () => {
    expect(decodeEvent('{not json')).toBeNull()
    expect(decodeEvent(null)).toBeNull()
    expect(decodeEvent('123')).toBeNull()
    expect(decodeEvent('{"type":"bogus"}')).toBeNull()
  })

  it('미종료(ended_at 없음)+살아있던 상태는 crashed로 강등한다', () => {
    expect(resolveRestoredStatus('running', null)).toBe('crashed')
    expect(resolveRestoredStatus('waiting_user', null)).toBe('crashed')
    expect(resolveRestoredStatus('idle', null)).toBe('crashed')
  })

  it('정상 종료(ended_at 있음)는 저장된 상태를 보존한다', () => {
    expect(resolveRestoredStatus('done', '2026-06-22T00:00:00.000Z')).toBe('done')
    expect(resolveRestoredStatus('crashed', '2026-06-22T00:00:00.000Z')).toBe('crashed')
  })
})
