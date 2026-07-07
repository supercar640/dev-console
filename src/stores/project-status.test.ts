import { describe, it, expect } from 'vitest'
import { aggregateProjectStatus, statusDotClass } from './project-status'

describe('aggregateProjectStatus', () => {
  it('둘 다 없으면 null', () => {
    expect(aggregateProjectStatus(null, null)).toBeNull()
  })
  it('사람대기가 실행보다 우선', () => {
    expect(aggregateProjectStatus('waiting_user', 'running')).toBe('waiting_user')
  })
  it('에이전트 유휴 + 터미널 실행 → running', () => {
    expect(aggregateProjectStatus('idle', 'running')).toBe('running')
  })
  it('터미널 exited는 done으로 정규화', () => {
    expect(aggregateProjectStatus(null, 'exited')).toBe('done')
  })
  it('충돌은 가장 낮은 우선순위: 에이전트 충돌 + 터미널 실행 → running', () => {
    expect(aggregateProjectStatus('crashed', 'running')).toBe('running')
  })
  it('에이전트만 충돌(터미널 없음) → crashed', () => {
    expect(aggregateProjectStatus('crashed', null)).toBe('crashed')
  })
})

describe('statusDotClass', () => {
  it('상태별 색 클래스 suffix', () => {
    expect(statusDotClass('waiting_user')).toBe('waiting')
    expect(statusDotClass('running')).toBe('running')
    expect(statusDotClass('idle')).toBe('idle')
    expect(statusDotClass('done')).toBe('done')
    expect(statusDotClass('crashed')).toBe('crashed')
    expect(statusDotClass(null)).toBe('none')
  })
})
