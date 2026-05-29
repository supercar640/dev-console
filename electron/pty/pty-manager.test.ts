import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PtyManager, type SpawnFn } from './pty-manager'

interface FakePty {
  pid: number
  written: string[]
  killed: boolean
  resized: Array<[number, number]>
  onData(cb: (d: Buffer) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(d: string): void
  resize(c: number, r: number): void
  kill(): void
  _emitData(buf: Buffer): void
  _emitExit(code: number): void
}

function makeFakePty(pid = 4321): FakePty {
  const dataCbs: Array<(d: Buffer) => void> = []
  const exitCbs: Array<(e: { exitCode: number }) => void> = []
  return {
    pid, written: [], killed: false, resized: [],
    onData(cb) { dataCbs.push(cb) },
    onExit(cb) { exitCbs.push(cb) },
    write(d) { this.written.push(d) },
    resize(c, r) { this.resized.push([c, r]) },
    kill() { this.killed = true },
    _emitData(buf) { dataCbs.forEach((cb) => cb(buf)) },
    _emitExit(code) { exitCbs.forEach((cb) => cb({ exitCode: code })) }
  }
}

describe('PtyManager', () => {
  let fake: FakePty
  let spawnFn: SpawnFn

  beforeEach(() => {
    fake = makeFakePty()
    spawnFn = vi.fn(() => fake as never)
  })

  it('start는 running 상태와 pid를 반환한다', () => {
    const mgr = new PtyManager(spawnFn)
    const info = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    expect(info.status).toBe('running')
    expect(info.pid).toBe(4321)
    expect(spawnFn).toHaveBeenCalledOnce()
  })

  it('pty 출력을 링버퍼에 적재하고 onData 콜백으로 전달한다', () => {
    const mgr = new PtyManager(spawnFn)
    const seen: Buffer[] = []
    mgr.onData((_id, data) => seen.push(data))
    const info = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    fake._emitData(Buffer.from('가나'))
    expect(seen[0].toString('utf-8')).toBe('가나')
    expect(mgr.getScrollback(info.sessionId).toString('utf-8')).toBe('가나')
  })

  it('짧은 입력은 그대로 한 번 write', () => {
    const mgr = new PtyManager(spawnFn)
    const info = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    mgr.send(info.sessionId, 'ls\r')
    expect(fake.written).toEqual(['ls\r'])
  })

  it('512자 초과 입력은 청킹하여 여러 번 write (타이머 진행 필요)', () => {
    vi.useFakeTimers()
    const mgr = new PtyManager(spawnFn)
    const info = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    const big = 'x'.repeat(1100)
    mgr.send(info.sessionId, big)
    expect(fake.written.length).toBe(1)
    vi.runAllTimers()
    expect(fake.written.length).toBe(3)
    expect(fake.written.join('')).toBe(big)
    vi.useRealTimers()
  })

  it('resize는 살아있는 세션에 전달된다', () => {
    const mgr = new PtyManager(spawnFn)
    const info = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    mgr.resize(info.sessionId, 120, 40)
    expect(fake.resized).toEqual([[120, 40]])
  })

  it('pty 종료 시 status가 exited로 바뀌고 onStatus 콜백 호출', () => {
    const mgr = new PtyManager(spawnFn)
    const infos: Array<{ status: string; exitCode?: number }> = []
    mgr.onStatus((i) => infos.push(i))
    const info = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    fake._emitExit(0)
    expect(mgr.status(info.sessionId)?.status).toBe('exited')
    expect(infos.at(-1)).toMatchObject({ status: 'exited', exitCode: 0 })
  })

  it('종료된 세션에는 write하지 않는다', () => {
    const mgr = new PtyManager(spawnFn)
    const info = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    fake._emitExit(1)
    mgr.send(info.sessionId, 'x')
    expect(fake.written).toEqual([])
  })

  it('stop은 pty.kill 후 세션을 비운다', () => {
    const mgr = new PtyManager(spawnFn)
    const info = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    mgr.stop(info.sessionId)
    expect(fake.killed).toBe(true)
    expect(mgr.status(info.sessionId)).toBeNull()
  })

  it('start 재호출 시 이전 세션을 정리(교체)한다', () => {
    const first = makeFakePty(1)
    const second = makeFakePty(2)
    let n = 0
    const sf = vi.fn(() => (n++ === 0 ? first : second) as never)
    const mgr = new PtyManager(sf as SpawnFn)
    mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    expect(first.killed).toBe(true)
  })
})
