import { useEffect, useRef, useState } from 'react'
import type { Project, SessionStatus } from '@shared/types'
import { useAgentStore, useAgentProject } from '@/stores/agent'
import AgentEventItem from '@/components/AgentEventItem'
import PermissionCard from '@/components/PermissionCard'

export default function AgentView({ project }: { project: Project }): React.JSX.Element {
  const { sessionId, status, log, pending } = useAgentProject(project.id)
  const focusTick = useAgentStore((s) => s.focusTick)
  const start = useAgentStore((s) => s.start)
  const send = useAgentStore((s) => s.send)
  const approve = useAgentStore((s) => s.approve)
  const deny = useAgentStore((s) => s.deny)
  const interrupt = useAgentStore((s) => s.interrupt)
  const stop = useAgentStore((s) => s.stop)
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  // 새 로그/포커스 시 맨 아래로 스크롤.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log.length, focusTick])

  const submit = (): void => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    if (!sessionId) void start(project.id, project.workspacePath, text)
    else void send(project.id, text)
  }

  return (
    <div className="agent">
      <div className="agent__bar">
        <span className={`badge badge--${status ?? 'none'}`}>{statusLabel(status)}</span>
        <span className="agent__spacer" />
        <button className="btn" onClick={() => void interrupt(project.id)} disabled={status !== 'running'}>중단</button>
        <button className="btn btn--ghost-danger" onClick={() => void stop(project.id)} disabled={!sessionId}>정지</button>
      </div>

      <div className="agent__log" ref={logRef}>
        {log.length === 0 && <div className="empty">아래에 지시를 입력해 에이전트를 시작하세요.</div>}
        {log.map((item) => <AgentEventItem key={item.id} item={item} />)}
        {pending.map((req) => (
          <PermissionCard key={req.requestId} req={req}
            onApprove={() => void approve(project.id, req.requestId)}
            onDeny={() => void deny(project.id, req.requestId, '사용자가 거부함')} />
        ))}
      </div>

      <div className="agent__input">
        <input className="input" value={draft} placeholder="에이전트에게 지시…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        <button className="btn btn--primary" onClick={submit}>{sessionId ? '전송' : '시작'}</button>
      </div>
    </div>
  )
}

function statusLabel(s: SessionStatus | null): string {
  switch (s) {
    case 'running': return '● 실행 중'
    case 'waiting_user': return '⏸ 사람 대기'
    case 'idle': return '○ 유휴'
    case 'crashed': return '✕ 비정상 종료'
    case 'done': return '✓ 완료'
    default: return '대기'
  }
}
