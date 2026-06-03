// 실제 Agent SDK 배선. ClaudeAgentSession 에 주입할 QueryFn 을 만든다.
// PoC 근거: settingSources:[] 로 유저 defaultMode:auto 격리, permissionMode:'default' 라야
// 권한 필요한 도구에서 canUseTool 이 발화한다(direction.md §2-bis).
//
// 주: @anthropic-ai/claude-agent-sdk 는 ESM 전용(sdk.mjs)이다. electron-vite main 은
// CJS 로 번들되므로 정적 import 는 런타임에 require() → ERR_REQUIRE_ESM 으로 죽는다.
// → 동적 import() 로 지연 로드한다. 외부 의존성으로 남겨(번들에 안 섞음) SDK 의 CLI
//   경로 해석도 보존된다. 핸들은 동기로 돌려줘야 하므로 첫 async 순회/interrupt 시점에
//   모듈을 await 한 뒤 실제 query 에 위임한다.
import type { QueryFn, SdkQueryHandle, SdkQueryParams } from './claude-agent-session'
import type { SdkMessage } from './event-parser'

type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk')
let sdkModule: Promise<SdkModule> | null = null
function loadSdk(): Promise<SdkModule> {
  sdkModule ??= import('@anthropic-ai/claude-agent-sdk')
  return sdkModule
}

export function createSdkQueryFn(): QueryFn {
  return (params: SdkQueryParams): SdkQueryHandle => {
    // 동기 진입점에서 import 를 시작해 둔다(start 직후 consume 가 바로 순회 시작하므로 지연 최소).
    const ready = loadSdk().then(({ query }) =>
      query({
        prompt: params.prompt as never,
        options: {
          cwd: params.cwd,
          model: params.model,
          permissionMode: 'default',
          settingSources: [],
          canUseTool: async (toolName, input) => params.canUseTool(toolName, input as Record<string, unknown>)
        }
      })
    )
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<SdkMessage> {
        const q = await ready
        for await (const msg of q) yield msg as SdkMessage
      },
      interrupt: async (): Promise<void> => {
        const q = await ready
        await q.interrupt?.()
      }
    }
  }
}
