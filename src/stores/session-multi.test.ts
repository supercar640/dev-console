import { describe, it, expect } from 'vitest'
import {
  initialMultiTerminalState, terminalStateOf, setCommandForProject,
  startTerminalForProject, stopTerminalForProject, routeTerminalStatus
} from './session-multi'

describe('session-multi', () => {
  it('startTerminalForProject는 프로젝트별 세션을 running으로 등록한다', () => {
    let s = startTerminalForProject(initialMultiTerminalState(), 'p1', 's1')
    s = startTerminalForProject(s, 'p2', 's2')
    expect(terminalStateOf(s, 'p1')).toMatchObject({ sessionId: 's1', status: 'running' })
    expect(terminalStateOf(s, 'p2')).toMatchObject({ sessionId: 's2', status: 'running' })
  })

  it('routeTerminalStatus는 소속 프로젝트 상태만 바꾼다(exited)', () => {
    let s = startTerminalForProject(startTerminalForProject(initialMultiTerminalState(), 'p1', 's1'), 'p2', 's2')
    s = routeTerminalStatus(s, { sessionId: 's1', status: 'exited', pid: 1, exitCode: 0 })
    expect(terminalStateOf(s, 'p1').status).toBe('exited')
    expect(terminalStateOf(s, 'p2').status).toBe('running')
  })

  it('routeTerminalStatus는 미지의 sessionId를 무시한다(동일 참조)', () => {
    const s0 = startTerminalForProject(initialMultiTerminalState(), 'p1', 's1')
    const s1 = routeTerminalStatus(s0, { sessionId: 'ghost', status: 'exited', pid: 9 })
    expect(s1).toBe(s0)
  })

  it('setCommandForProject는 프로젝트별 명령을 보관(기본 powershell)', () => {
    let s = initialMultiTerminalState()
    expect(terminalStateOf(s, 'p1').command).toBe('powershell')
    s = setCommandForProject(s, 'p1', 'claude')
    expect(terminalStateOf(s, 'p1').command).toBe('claude')
    expect(terminalStateOf(s, 'p2').command).toBe('powershell')
  })

  it('stopTerminalForProject는 세션을 비우되 command는 유지한다', () => {
    let s = startTerminalForProject(initialMultiTerminalState(), 'p1', 's1')
    s = setCommandForProject(s, 'p1', 'claude')
    s = stopTerminalForProject(s, 'p1')
    expect(terminalStateOf(s, 'p1')).toMatchObject({ sessionId: null, status: null, command: 'claude' })
  })
})
