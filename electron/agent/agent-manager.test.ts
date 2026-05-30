import { describe, it, expect } from 'vitest'
import { ClaudeAgentManager } from './agent-manager'
import type { QueryFn } from './claude-agent-session'
import type { AgentEvent, AgentSessionInfo } from '@shared/types'
import type { SdkMessage } from './event-parser'

const flush = () => new Promise((r) => setTimeout(r, 0))
const fakeQuery: QueryFn = (p) => ({
  async *[Symbol.asyncIterator](): AsyncIterator<SdkMessage> {
    yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }
    // 스트리밍 입력 모드 모사: result 뒤에도 입력 스트림이 열려 있어 종료하지 않는다(idle 유지).
    for await (const m of p.prompt) void m
  }
})

describe('ClaudeAgentManager', () => {
  it('start는 running 정보를 반환하고 이벤트/상태를 밖으로 라우팅한다', async () => {
    const mgr = new ClaudeAgentManager(() => fakeQuery)
    const events: Array<{ sessionId: string; event: AgentEvent }> = []
    const statuses: AgentSessionInfo[] = []
    mgr.onEvent((sid, e) => events.push({ sessionId: sid, event: e }))
    mgr.onStatus((i) => statuses.push(i))
    const info = mgr.start({ projectId: 'p1', cwd: 'C:\\' })
    expect(info.status).toBe('running')
    await flush(); await flush()
    expect(events.some((x) => x.event.type === 'message')).toBe(true)
    expect(statuses.at(-1)?.status).toBe('idle')
  })

  it('start 재호출 시 이전 세션을 정리(교체)한다', () => {
    const mgr = new ClaudeAgentManager(() => fakeQuery)
    const first = mgr.start({ projectId: 'p1', cwd: 'C:\\' })
    const second = mgr.start({ projectId: 'p1', cwd: 'C:\\' })
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(mgr.status(first.sessionId)).toBeNull()
  })

  it('알 수 없는 sessionId로의 send/respond는 무시(throw 안 함)', () => {
    const mgr = new ClaudeAgentManager(() => fakeQuery)
    mgr.start({ projectId: 'p1', cwd: 'C:\\' })
    expect(() => mgr.send('nope', 'x')).not.toThrow()
    expect(() => mgr.respondPermission('nope', 'rq', { behavior: 'allow' })).not.toThrow()
  })
})
