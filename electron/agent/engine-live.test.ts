// 라이브 통합 스모크 — 실제 claude 에 붙여 엔진 전체 스택을 검증한다.
// (매니저 → 세션 → 파서 → 실제 Agent SDK). 실제 API 호출이라 비용·네트워크 발생 →
// 평소 `pnpm test` 에선 건너뛴다. 실행: LIVE_SDK=1 pnpm vitest run electron/agent/engine-live.test.ts
// 검증 포인트: Write 시도 시 permission_request 가 매니저 경계까지 흐르고 waiting_user 로 가며,
// deny 응답이 claude 로 되돌아간다(직접 파싱으로 못 받던 신호가 엔진을 통과).
import { describe, it, expect } from 'vitest'
import { ClaudeAgentManager } from './agent-manager'
import { createSdkQueryFn } from './sdk-query'
import type { AgentEvent, AgentSessionInfo, PermissionRequest } from '@shared/types'

const LIVE = !!process.env.LIVE_SDK

describe.skipIf(!LIVE)('ClaudeAgentManager (LIVE 실제 SDK)', () => {
  it(
    'Write 권한 요청이 엔진을 통과하고 deny 가 반영된다',
    async () => {
      const mgr = new ClaudeAgentManager(() => createSdkQueryFn())
      const events: AgentEvent[] = []
      const statuses: AgentSessionInfo[] = []
      const reqs: PermissionRequest[] = []
      mgr.onEvent((_sid, e) => events.push(e))
      mgr.onStatus((i) => statuses.push(i))

      const gotReq = new Promise<PermissionRequest>((resolve) => {
        mgr.onPermissionRequest((r) => { reqs.push(r); resolve(r) })
      })

      const info = mgr.start({
        projectId: 'live-smoke',
        cwd: process.cwd(),
        model: 'haiku',
        firstMessage:
          'Use the Write tool to create a file named live_smoke.txt with the contents HELLO. Just do it, do not explain.'
      })
      expect(info.status).toBe('running')

      const req = await gotReq
      expect(req.toolName).toBe('Write')
      expect(req.kind).toBe('tool')
      expect(events.some((e) => e.type === 'permission_request')).toBe(true)
      expect(statuses.some((s) => s.status === 'waiting_user')).toBe(true)

      // 거부 → claude 가 거부를 인지하고 후속 메시지를 낸다.
      mgr.respondPermission(info.sessionId, req.requestId, { behavior: 'deny', message: 'smoke deny' })

      // 다음 result(턴 종료)까지 잠시 대기.
      await new Promise((r) => setTimeout(r, 8000))
      expect(events.some((e) => e.type === 'message' || e.type === 'usage')).toBe(true)

      mgr.stop(info.sessionId)
    },
    90_000
  )
})
