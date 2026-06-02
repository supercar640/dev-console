import { useSessionStore, useTerminalProject } from '@/stores/session'
import XtermPane from '@/components/XtermPane'
import type { Project } from '@shared/types'

export default function Terminal({ project }: { project: Project }): React.JSX.Element {
  const { sessionId, status, command } = useTerminalProject(project.id)
  const setCommand = useSessionStore((s) => s.setCommand)
  const start = useSessionStore((s) => s.start)
  const stop = useSessionStore((s) => s.stop)

  return (
    <section className="terminal">
      <div className="terminal__bar">
        <input
          className="input terminal__cmd"
          value={command}
          onChange={(e) => setCommand(project.id, e.target.value)}
          placeholder="실행할 명령 (예: powershell, claude)"
        />
        <button
          className="btn btn--primary"
          onClick={() => void start(project.id, project.workspacePath)}
        >
          {sessionId ? '재시작' : '시작'}
        </button>
        <button className="btn btn--ghost-danger" onClick={() => void stop(project.id)} disabled={!sessionId}>
          종료
        </button>
        <span className="terminal__status">{statusLabel(status)}</span>
      </div>
      {sessionId ? (
        <XtermPane key={sessionId} sessionId={sessionId} />
      ) : (
        <div className="empty">“시작”을 눌러 {project.name}에서 터미널을 여세요.</div>
      )}
    </section>
  )
}

function statusLabel(s: 'running' | 'exited' | null): string {
  if (s === 'running') return '● 실행 중'
  if (s === 'exited') return '○ 종료됨'
  return '대기'
}
