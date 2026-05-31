import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentNotifier, type NotifyOpts } from './notifier'
import type { PermissionRequest } from '@shared/types'

const req: PermissionRequest = { requestId: 'p1', sessionId: 'a1', toolName: 'Write', input: {}, kind: 'tool' }

describe('AgentNotifier', () => {
  let notes: NotifyOpts[]
  let badges: number[]
  let n: AgentNotifier
  beforeEach(() => {
    vi.useFakeTimers()
    notes = []; badges = []
    n = new AgentNotifier({ notify: (o) => notes.push(o), setBadgeCount: (c) => badges.push(c), idleMs: 1000 })
  })
  afterEach(() => vi.useRealTimers())

  it('권한 요청 → 알림 1회 + 배지 1', () => {
    n.onPermissionRequest(req)
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toContain('Write')
    expect(notes[0].sessionId).toBe('a1')
    expect(badges.at(-1)).toBe(1)
  })

  it('running 진입 시 배지 0으로(대기 해제)', () => {
    n.onPermissionRequest(req)
    n.onStatus({ sessionId: 'a1', status: 'running' })
    expect(badges.at(-1)).toBe(0)
  })

  it('idle 60초(여기선 1000ms) 지속 → 지시 대기 알림', () => {
    n.onStatus({ sessionId: 'a1', status: 'idle' })
    expect(notes).toHaveLength(0)
    vi.advanceTimersByTime(1000)
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toContain('지시 대기')
  })

  it('idle 후 타이머 만료 전 상태 변경 → 알림 없음', () => {
    n.onStatus({ sessionId: 'a1', status: 'idle' })
    n.onStatus({ sessionId: 'a1', status: 'running' })
    vi.advanceTimersByTime(1000)
    expect(notes).toHaveLength(0)
  })
})
