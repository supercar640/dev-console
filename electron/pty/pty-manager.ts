import type { IPty } from 'node-pty'
import type { SessionInfo, StartOpts } from '@shared/types'
import { RingBuffer } from './ring-buffer'
import { chunkInput } from './chunk-input'

export type SpawnFn = (
  file: string,
  args: string[],
  opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; encoding: null }
) => IPty

const MAX_SCROLLBACK_BYTES = 256 * 1024
const CHUNK_THRESHOLD = 512
const CHUNK_DELAY_MS = 15
const WIN_SHELLS = new Set(['pwsh', 'powershell', 'cmd', 'bash', 'wsl'])

// Windows에서 bare 셸 이름엔 .exe를 붙인다(node-pty 요구). 그 외 명령/경로는 그대로.
// adapted from agent-orchestrator/packages/plugins/runtime-process/src/pty-host.ts (MIT)
function resolveCommand(cmd: string): string {
  if (process.platform !== 'win32') return cmd
  if (cmd.includes('\\') || cmd.includes('/') || cmd.includes('.')) return cmd
  return WIN_SHELLS.has(cmd.toLowerCase()) ? `${cmd}.exe` : cmd
}

interface Session {
  id: string
  pty: IPty
  buffer: RingBuffer
  info: SessionInfo
}

export class PtyManager {
  private session: Session | null = null
  private dataCb: ((sessionId: string, data: Buffer) => void) | null = null
  private statusCb: ((info: SessionInfo) => void) | null = null
  private seq = 0

  constructor(private readonly spawnFn: SpawnFn) {}

  onData(cb: (sessionId: string, data: Buffer) => void): void { this.dataCb = cb }
  onStatus(cb: (info: SessionInfo) => void): void { this.statusCb = cb }

  start(opts: StartOpts): SessionInfo {
    // M2: 단일 세션 — 기존 것이 있으면 정리 후 교체.
    if (this.session) this.stop(this.session.id)
    const id = `s${++this.seq}`
    const pty = this.spawnFn(resolveCommand(opts.command), opts.args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd,
      env: process.env,
      encoding: null
    })
    const info: SessionInfo = { sessionId: id, status: 'running', pid: pty.pid }
    const session: Session = { id, pty, buffer: new RingBuffer(MAX_SCROLLBACK_BYTES), info }
    this.session = session

    pty.onData((data: string | Buffer) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8')
      session.buffer.append(buf)
      this.dataCb?.(id, buf)
    })
    pty.onExit(({ exitCode }: { exitCode: number }) => {
      session.info = { sessionId: id, status: 'exited', pid: pty.pid, exitCode }
      this.statusCb?.(session.info)
    })
    return info
  }

  send(sessionId: string, data: string): void {
    const s = this.session
    if (!s || s.id !== sessionId || s.info.status !== 'running') return
    if (data.length <= CHUNK_THRESHOLD) { s.pty.write(data); return }
    const parts = chunkInput(data, CHUNK_THRESHOLD)
    let i = 0
    const writeNext = (): void => {
      const cur = this.session
      if (!cur || cur.id !== sessionId || cur.info.status !== 'running' || i >= parts.length) return
      cur.pty.write(parts[i++])
      if (i < parts.length) setTimeout(writeNext, CHUNK_DELAY_MS)
    }
    writeNext()
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.session
    if (!s || s.id !== sessionId || s.info.status !== 'running') return
    try { s.pty.resize(cols, rows) } catch { /* 일시적 resize 오류 무시 */ }
  }

  getScrollback(sessionId: string): Buffer {
    const s = this.session
    return s && s.id === sessionId ? s.buffer.replay() : Buffer.alloc(0)
  }

  status(sessionId: string): SessionInfo | null {
    return this.session && this.session.id === sessionId ? this.session.info : null
  }

  stop(sessionId: string): void {
    const s = this.session
    if (!s || s.id !== sessionId) return
    try { if (s.info.status === 'running') s.pty.kill() } catch { /* 이미 죽음 */ }
    this.session = null
  }

  disposeAll(): void {
    if (this.session) this.stop(this.session.id)
  }
}
