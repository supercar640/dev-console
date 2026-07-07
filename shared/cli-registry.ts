// 알려진 LLM CLI 정의(레지스트리). 1단계=메타데이터, 2단계 CliAdapter가 꽂히는 자리.
// dependency-free — Main/Renderer 양쪽에서 import (shared/types.ts와 동일 규약).

export interface CliDef {
  /** 안정 식별자. UI 선택·상태 저장 키. */
  id: string
  /** 드롭다운 표시명. */
  label: string
  /** 실행 명령(PtyManager로 그대로 전달). */
  command: string
  /** 기본 인자(현재 프리셋은 모두 빈 배열; sessions.start로 전달). */
  args: string[]
}

/** 프리셋에 없는 명령을 직접 입력하는 특수 선택지 id. 레지스트리 항목이 아니다. */
export const CUSTOM_CLI_ID = 'custom'

/** 기본 선택 CLI(범용 터미널). */
export const DEFAULT_CLI_ID = 'powershell'

export const CLI_REGISTRY: CliDef[] = [
  { id: 'claude',     label: 'Claude Code', command: 'claude',     args: [] },
  { id: 'codex',      label: 'Codex',       command: 'codex',      args: [] },
  { id: 'gemini',     label: 'Gemini',      command: 'gemini',     args: [] },
  { id: 'powershell', label: 'powershell',  command: 'powershell', args: [] }
]

/** 선택된 cliId(+custom일 때 입력 명령)를 실제 실행 command/args로 해석. */
export function resolveCli(cliId: string, customCommand: string): { command: string; args: string[] } {
  if (cliId === CUSTOM_CLI_ID) return { command: customCommand.trim(), args: [] }
  const def = CLI_REGISTRY.find((d) => d.id === cliId)
  if (!def) return { command: customCommand.trim(), args: [] }
  return { command: def.command, args: def.args }
}
