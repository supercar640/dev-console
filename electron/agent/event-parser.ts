// SDK 메시지 → 정규화 AgentEvent 변환 (spec 부록 B). 순수·무상태.
// 권한/질문(permission_request / user_input_required)은 여기서 나오지 않는다 —
// 그건 claude-agent-session 의 canUseTool 콜백이 합성한다(direction.md §2-bis).
import type { AgentEvent } from '@shared/types'

/** SDK 메시지의 느슨한 부분집합. 우리가 실제로 읽는 필드만 선언한다. */
export type SdkMessage =
  | { type: 'assistant'; message: { role: 'assistant'; content: SdkContentBlock[] | string } }
  | { type: 'user'; message: { role: 'user'; content: SdkContentBlock[] | string } }
  | { type: 'result'; subtype: string; is_error: boolean; result?: string; usage?: SdkUsage }
  | { type: 'system'; subtype: string }
  | { type: 'rate_limit_event' }
  | { type: string }

type SdkContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown }
  | { type: string; [k: string]: unknown }

interface SdkUsage { input_tokens: number; output_tokens: number }

export function parseSdkMessage(msg: SdkMessage): AgentEvent[] {
  switch (msg.type) {
    case 'assistant':
      return blocksOf(msg).flatMap((b): AgentEvent[] => {
        if (b.type === 'text') {
          const text = (b as { text: string }).text
          return text.trim() ? [{ type: 'message', role: 'assistant', text }] : []
        }
        if (b.type === 'tool_use') {
          const tu = b as { name: string; input: unknown }
          return [{ type: 'tool_use', name: tu.name, input: tu.input }]
        }
        return [] // thinking 등 무시
      })
    case 'user':
      return blocksOf(msg).flatMap((b): AgentEvent[] => {
        if (b.type === 'tool_result') {
          const tr = b as { tool_use_id: string; content: unknown }
          return [{ type: 'tool_result', name: tr.tool_use_id, output: tr.content }]
        }
        return []
      })
    case 'result': {
      const r = msg as { is_error: boolean; result?: string; usage?: SdkUsage }
      const out: AgentEvent[] = []
      if (r.is_error) out.push({ type: 'error', message: r.result ?? 'unknown error', recoverable: false })
      if (r.usage) out.push({ type: 'usage', tokens: { input: r.usage.input_tokens, output: r.usage.output_tokens } })
      return out
    }
    default:
      return []
  }
}

function blocksOf(msg: SdkMessage): SdkContentBlock[] {
  const c = (msg as { message?: { content?: SdkContentBlock[] | string } }).message?.content
  return Array.isArray(c) ? c : []
}
