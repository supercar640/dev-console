import { describe, it, expect } from 'vitest'
import { parseSdkMessage, type SdkMessage } from './event-parser'

describe('parseSdkMessage', () => {
  it('assistant 텍스트 블록 → message 이벤트', () => {
    const msg: SdkMessage = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '안녕하세요' }] }
    }
    expect(parseSdkMessage(msg)).toEqual([{ type: 'message', role: 'assistant', text: '안녕하세요' }])
  })

  it('assistant tool_use 블록 → tool_use 이벤트, thinking/빈 텍스트는 무시', () => {
    const msg: SdkMessage = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '...' },
          { type: 'text', text: '   ' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }
        ]
      }
    }
    expect(parseSdkMessage(msg)).toEqual([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }])
  })

  it('user tool_result 블록 → tool_result 이벤트(name=tool_use_id), 문자열 content(replay)는 무시', () => {
    const toolResult: SdkMessage = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }] }
    }
    expect(parseSdkMessage(toolResult)).toEqual([{ type: 'tool_result', name: 't1', output: 'done' }])

    const replay: SdkMessage = { type: 'user', message: { role: 'user', content: 'hi' } }
    expect(parseSdkMessage(replay)).toEqual([])
  })

  it('result(success) → usage 이벤트', () => {
    const msg: SdkMessage = {
      type: 'result', subtype: 'success', is_error: false, result: 'ok',
      usage: { input_tokens: 10, output_tokens: 3 }
    }
    expect(parseSdkMessage(msg)).toEqual([{ type: 'usage', tokens: { input: 10, output: 3 } }])
  })

  it('result(error) → error + usage', () => {
    const msg: SdkMessage = {
      type: 'result', subtype: 'error_during_execution', is_error: true, result: '터졌다',
      usage: { input_tokens: 1, output_tokens: 0 }
    }
    expect(parseSdkMessage(msg)).toEqual([
      { type: 'error', message: '터졌다', recoverable: false },
      { type: 'usage', tokens: { input: 1, output: 0 } }
    ])
  })

  it('system:init / rate_limit_event / 미지의 타입 → 빈 배열', () => {
    expect(parseSdkMessage({ type: 'system', subtype: 'init' } as SdkMessage)).toEqual([])
    expect(parseSdkMessage({ type: 'rate_limit_event' } as SdkMessage)).toEqual([])
    expect(parseSdkMessage({ type: 'nope' } as unknown as SdkMessage)).toEqual([])
  })
})
