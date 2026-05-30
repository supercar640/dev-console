// 실제 Agent SDK 배선. ClaudeAgentSession 에 주입할 QueryFn 을 만든다.
// PoC 근거: settingSources:[] 로 유저 defaultMode:auto 격리, permissionMode:'default' 라야
// 권한 필요한 도구에서 canUseTool 이 발화한다(direction.md §2-bis).
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { QueryFn, SdkQueryHandle } from './claude-agent-session'
import type { SdkMessage } from './event-parser'

export function createSdkQueryFn(): QueryFn {
  return (params): SdkQueryHandle => {
    const q = query({
      prompt: params.prompt as never,
      options: {
        cwd: params.cwd,
        model: params.model,
        permissionMode: 'default',
        settingSources: [],
        canUseTool: async (toolName, input) => params.canUseTool(toolName, input as Record<string, unknown>)
      }
    })
    return {
      [Symbol.asyncIterator]: () => q[Symbol.asyncIterator]() as AsyncIterator<SdkMessage>,
      interrupt: () => q.interrupt()
    }
  }
}
