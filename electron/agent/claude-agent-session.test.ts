import { describe, it, expect, vi } from 'vitest'
import { ClaudeAgentSession, type QueryFn, type SdkQueryParams } from './claude-agent-session'
import type { AgentEvent, PermissionRequest, SessionStatus } from '@shared/types'
import type { SdkMessage } from './event-parser'

/** 스크립트된 메시지를 흘려주는 가짜 queryFn. canUseTool 호출도 시뮬레이트. */
function fakeQuery(script: (p: SdkQueryParams) => AsyncIterable<SdkMessage>): QueryFn {
  return (p) => {
    const it = script(p)[Symbol.asyncIterator]()
    return { [Symbol.asyncIterator]: () => it, interrupt: vi.fn(async () => {}) }
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('ClaudeAgentSession', () => {
  it('start는 running 상태로 전이하고 첫 메시지를 큐에 넣는다', async () => {
    const seen: SdkUserSeen[] = []
    type SdkUserSeen = { content: string }
    const session = new ClaudeAgentSession(
      'a1',
      fakeQuery(async function* (p) {
        for await (const m of p.prompt) seen.push({ content: (m.message.content as string) })
        yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }
      })
    )
    const statuses: SessionStatus[] = []
    session.onStatus((i) => statuses.push(i.status))
    session.start({ cwd: 'C:\\', firstMessage: '안녕' })
    await flush()
    expect(statuses[0]).toBe('running')
    expect(seen[0]?.content).toBe('안녕')
  })

  it('assistant/result 메시지를 파서로 변환해 onEvent로 흘리고, result 후 idle', async () => {
    const events: AgentEvent[] = []
    const statuses: SessionStatus[] = []
    const session = new ClaudeAgentSession(
      'a1',
      fakeQuery(async function* (p) {
        yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '하이' }] } }
        yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 2, output_tokens: 1 } }
        // 스트리밍 입력 모드 모사: result 뒤에도 입력 스트림이 열려 있어 종료하지 않는다(idle 유지).
        for await (const m of p.prompt) void m
      })
    )
    session.onEvent((e) => events.push(e))
    session.onStatus((i) => statuses.push(i.status))
    session.start({ cwd: 'C:\\', firstMessage: 'go' })
    await flush(); await flush()
    expect(events).toContainEqual({ type: 'message', role: 'assistant', text: '하이' })
    expect(events).toContainEqual({ type: 'usage', tokens: { input: 2, output: 1 } })
    expect(statuses.at(-1)).toBe('idle')
  })

  it('canUseTool(Bash) 발화 시 permission_request + waiting_user, respondPermission(allow)로 진행', async () => {
    const reqs: PermissionRequest[] = []
    const events: AgentEvent[] = []
    let decision: { behavior: string } | null = null
    const session = new ClaudeAgentSession(
      'a1',
      fakeQuery(async function* (p) {
        decision = await p.canUseTool('Bash', { command: 'rm -rf x' })
        yield { type: 'result', subtype: 'success', is_error: false, result: 'done', usage: { input_tokens: 1, output_tokens: 1 } }
      })
    )
    session.onPermissionRequest((r) => reqs.push(r))
    session.onEvent((e) => events.push(e))
    session.start({ cwd: 'C:\\', firstMessage: 'go' })
    await flush()
    expect(reqs).toHaveLength(1)
    expect(reqs[0].toolName).toBe('Bash')
    expect(reqs[0].kind).toBe('tool')
    expect(events).toContainEqual({ type: 'permission_request', description: expect.stringContaining('Bash') })
    expect(session.info().status).toBe('waiting_user')

    session.respondPermission(reqs[0].requestId, { behavior: 'allow' })
    await flush()
    expect(decision).toEqual({ behavior: 'allow', updatedInput: { command: 'rm -rf x' } })
  })

  it('canUseTool(AskUserQuestion) → user_input_required + kind=question', async () => {
    const reqs: PermissionRequest[] = []
    const events: AgentEvent[] = []
    const session = new ClaudeAgentSession(
      'a1',
      fakeQuery(async function* (p) {
        await p.canUseTool('AskUserQuestion', { questions: [{ question: '어느 DB?' }] })
        yield { type: 'result', subtype: 'success', is_error: false, result: 'x', usage: { input_tokens: 1, output_tokens: 1 } }
      })
    )
    session.onPermissionRequest((r) => reqs.push(r))
    session.onEvent((e) => events.push(e))
    session.start({ cwd: 'C:\\', firstMessage: 'go' })
    await flush()
    expect(reqs[0].kind).toBe('question')
    expect(events.some((e) => e.type === 'user_input_required')).toBe(true)
  })

  it('respondPermission(deny)는 deny 메시지를 SDK로 돌려준다', async () => {
    let decision: { behavior: string; message?: string } | null = null
    const reqs: PermissionRequest[] = []
    const session = new ClaudeAgentSession(
      'a1',
      fakeQuery(async function* (p) {
        decision = await p.canUseTool('Write', { file_path: 'x' })
        yield { type: 'result', subtype: 'success', is_error: false, result: 'x', usage: { input_tokens: 1, output_tokens: 1 } }
      })
    )
    session.onPermissionRequest((r) => reqs.push(r))
    session.start({ cwd: 'C:\\', firstMessage: 'go' })
    await flush()
    session.respondPermission(reqs[0].requestId, { behavior: 'deny', message: '거부' })
    await flush()
    expect(decision).toEqual({ behavior: 'deny', message: '거부' })
  })

  it('이터레이션 정상 종료 시 done, 예외 시 crashed + error 이벤트', async () => {
    const okStatuses: SessionStatus[] = []
    const ok = new ClaudeAgentSession('a1', fakeQuery(async function* () { /* 즉시 종료 */ }))
    ok.onStatus((i) => okStatuses.push(i.status))
    ok.start({ cwd: 'C:\\' })
    await flush()
    expect(okStatuses.at(-1)).toBe('done')

    const crashStatuses: SessionStatus[] = []
    const crashEvents: AgentEvent[] = []
    const bad = new ClaudeAgentSession('a1', fakeQuery(async function* () { throw new Error('boom') }))
    bad.onStatus((i) => crashStatuses.push(i.status))
    bad.onEvent((e) => crashEvents.push(e))
    bad.start({ cwd: 'C:\\' })
    await flush()
    expect(crashStatuses.at(-1)).toBe('crashed')
    expect(crashEvents).toContainEqual({ type: 'error', message: 'boom', recoverable: false })
  })
})
