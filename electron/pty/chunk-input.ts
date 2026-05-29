// 문자열을 size 길이(UTF-16 코드유닛) 이하 조각으로 분할.
// Windows ConPTY가 큰 단일 write에서 바이트를 버리는 문제를 회피한다.
// adapted from agent-orchestrator/packages/plugins/runtime-process/src/pty-client.ts (MIT)
export function chunkInput(data: string, size = 512): string[] {
  if (size <= 0) throw new Error('chunk size must be positive')
  if (data.length === 0) return []
  if (data.length <= size) return [data]
  const out: string[] = []
  for (let i = 0; i < data.length; i += size) {
    out.push(data.slice(i, i + size))
  }
  return out
}
