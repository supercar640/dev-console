import { useSessionStore, useTerminalProject } from '@/stores/session'
import XtermPane from '@/components/XtermPane'
import { CLI_REGISTRY, CUSTOM_CLI_ID } from '@shared/cli-registry'
import type { Project } from '@shared/types'

export default function Terminal({ project }: { project: Project }): React.JSX.Element {
  const { sessionId, status, cliId, customCommand } = useTerminalProject(project.id)
  const selectCli = useSessionStore((s) => s.selectCli)
  const setCustomCommand = useSessionStore((s) => s.setCustomCommand)
  const start = useSessionStore((s) => s.start)
  const stop = useSessionStore((s) => s.stop)

  return (
    <section className="terminal">
      <div className="terminal__bar">
        <select
          className="input terminal__cli"
          value={cliId}
          onChange={(e) => selectCli(project.id, e.target.value)}
        >
          {CLI_REGISTRY.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
          <option value={CUSTOM_CLI_ID}>직접 입력…</option>
        </select>
        {cliId === CUSTOM_CLI_ID && (
          <input
            className="input terminal__cmd"
            value={customCommand}
            onChange={(e) => setCustomCommand(project.id, e.target.value)}
            placeholder="실행할 명령 (예: bash, node)"
          />
        )}
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
        <div className="empty">"시작"을 눌러 {project.name}에서 터미널을 여세요.</div>
      )}
    </section>
  )
}

function statusLabel(s: 'running' | 'exited' | null): string {
  if (s === 'running') return '● 실행 중'
  if (s === 'exited') return '○ 종료됨'
  return '대기'
}
