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

  // --- M4a 멀티 세션 ---
  function multiManager(): { mgr: PtyManager; a: FakePty; b: FakePty } {
    const a = makeFakePty(1)
    const b = makeFakePty(2)
    let n = 0
    const sf = vi.fn(() => (n++ === 0 ? a : b) as never)
    return { mgr: new PtyManager(sf as SpawnFn), a, b }
  }

  it('start를 두 번 호출하면 두 세션이 모두 살아있다(교체하지 않음)', () => {
    const { mgr, a, b } = multiManager()
    const first = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    const second = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(a.killed).toBe(false)
    expect(b.killed).toBe(false)
    expect(mgr.status(first.sessionId)?.status).toBe('running')
    expect(mgr.status(second.sessionId)?.status).toBe('running')
  })

  it('send는 sessionId로 해당 세션에만 전달된다', () => {
    const { mgr, a, b } = multiManager()
    const first = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    const second = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    mgr.send(first.sessionId, 'A\r')
    mgr.send(second.sessionId, 'B\r')
    expect(a.written).toEqual(['A\r'])
    expect(b.written).toEqual(['B\r'])
  })

  it('한 세션 stop이 다른 세션에 영향을 주지 않는다', () => {
    const { mgr, a, b } = multiManager()
    const first = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    const second = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    mgr.stop(first.sessionId)
    expect(a.killed).toBe(true)
    expect(b.killed).toBe(false)
    expect(mgr.status(first.sessionId)).toBeNull()
    expect(mgr.status(second.sessionId)?.status).toBe('running')
  })

  it('getScrollback은 sessionId별로 독립적이다', () => {
    const { mgr, a, b } = multiManager()
    const first = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    const second = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    a._emitData(Buffer.from('AAA'))
    b._emitData(Buffer.from('BBB'))
    expect(mgr.getScrollback(first.sessionId).toString('utf-8')).toBe('AAA')
    expect(mgr.getScrollback(second.sessionId).toString('utf-8')).toBe('BBB')
  })

  it('disposeAll은 모든 세션을 정리한다', () => {
    const { mgr, a, b } = multiManager()
    const first = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    const second = mgr.start({ command: 'powershell', args: [], cwd: 'C:\\' })
    mgr.disposeAll()
    expect(a.killed).toBe(true)
    expect(b.killed).toBe(true)
    expect(mgr.status(first.sessionId)).toBeNull()
    expect(mgr.status(second.sessionId)).toBeNull()
  })
})
