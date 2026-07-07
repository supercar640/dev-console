import { describe, it, expect } from 'vitest'
import {
  initialMultiTerminalState, terminalStateOf, setCliForProject, setCustomCommandForProject,
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

  it('setCliForProject는 프로젝트별 cliId를 보관(기본 powershell)', () => {
    let s = initialMultiTerminalState()
    expect(terminalStateOf(s, 'p1').cliId).toBe('powershell')
    s = setCliForProject(s, 'p1', 'codex')
    expect(terminalStateOf(s, 'p1').cliId).toBe('codex')
    expect(terminalStateOf(s, 'p2').cliId).toBe('powershell')
  })

  it('setCustomCommandForProject는 customCommand를 보관한다', () => {
    let s = setCustomCommandForProject(initialMultiTerminalState(), 'p1', 'bash')
    expect(terminalStateOf(s, 'p1').customCommand).toBe('bash')
  })

  it('stopTerminalForProject는 세션을 비우되 cliId/customCommand는 유지한다', () => {
    let s = startTerminalForProject(initialMultiTerminalState(), 'p1', 's1')
    s = setCliForProject(s, 'p1', 'codex')
    s = stopTerminalForProject(s, 'p1')
    expect(terminalStateOf(s, 'p1')).toMatchObject({ sessionId: null, status: null, cliId: 'codex', customCommand: '' })
  })
})
