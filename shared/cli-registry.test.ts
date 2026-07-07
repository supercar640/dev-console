import { describe, it, expect } from 'vitest'
import { CLI_REGISTRY, CUSTOM_CLI_ID, DEFAULT_CLI_ID, resolveCli } from './cli-registry'

describe('cli-registry', () => {
  it('프리셋에 claude/codex/gemini/powershell이 있다', () => {
    const ids = CLI_REGISTRY.map((d) => d.id)
    expect(ids).toEqual(expect.arrayContaining(['claude', 'codex', 'gemini', 'powershell']))
  })

  it('id는 유일하고 command는 비어있지 않다', () => {
    const ids = CLI_REGISTRY.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of CLI_REGISTRY) expect(d.command.length).toBeGreaterThan(0)
  })

  it('기본 CLI는 레지스트리에 존재한다', () => {
    expect(CLI_REGISTRY.some((d) => d.id === DEFAULT_CLI_ID)).toBe(true)
  })

  it('resolveCli: 프리셋(.exe)은 레지스트리의 command/args를 돌려준다', () => {
    expect(resolveCli('claude', '')).toEqual({ command: 'claude', args: [] })
  })

  it('resolveCli: .cmd 프리셋은 cmd.exe /c 로 감싼 command/args를 돌려준다', () => {
    expect(resolveCli('codex', '')).toEqual({ command: 'cmd.exe', args: ['/c', 'codex'] })
  })

  it('resolveCli: custom은 입력 명령을 trim해 돌려준다', () => {
    expect(resolveCli(CUSTOM_CLI_ID, '  npm  ')).toEqual({ command: 'npm', args: [] })
  })

  it('resolveCli: 미지의 id는 custom 입력으로 폴백한다', () => {
    expect(resolveCli('ghost', 'bash')).toEqual({ command: 'bash', args: [] })
  })
})
