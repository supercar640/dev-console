// 최근 PTY 출력의 롤링 바이트 버퍼. (재)attach 시 스크롤백 replay용.
// 디코딩하지 않고 raw 바이트로 보관 → 멀티바이트 UTF-8(한글 등)이 청크 경계에서
// 깨지지 않는다.
// adapted from agent-orchestrator/packages/plugins/runtime-process/src/pty-host.ts (MIT)
export class RingBuffer {
  private chunks: Buffer[] = []
  private bytes = 0

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer): void {
    this.chunks.push(chunk)
    this.bytes += chunk.length
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!
      this.bytes -= dropped.length
    }
  }

  replay(): Buffer {
    return Buffer.concat(this.chunks)
  }

  clear(): void {
    this.chunks = []
    this.bytes = 0
  }
}
