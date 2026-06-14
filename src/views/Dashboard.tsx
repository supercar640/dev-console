import { useEffect, useState } from 'react'
import type { CreateProjectInput, SessionStatus } from '@shared/types'
import { useProjectsStore } from '@/stores/projects'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useAgentStore } from '@/stores/agent'
import { useSessionStore } from '@/stores/session'
import { initialAgentState } from '@/stores/agent-reducer'
import { aggregateProjectStatus } from '@/stores/project-status'
import { computeProjectProgress } from '@/stores/project-progress'
import StatusDot from '@/components/StatusDot'
import ProgressBar from '@/components/ProgressBar'
import { dialogApi } from '@/ipc-client'

// 지휘자 정렬 우선순위(급한 순). 미실행(null)은 맨 끝. (AGENTS.md UI 사양)
const RANK: Record<SessionStatus, number> = {
  waiting_user: 0, running: 1, idle: 2, done: 3, crashed: 4
}
const rankOf = (status: SessionStatus | null): number => (status === null ? 5 : RANK[status])

export default function Dashboard(): React.JSX.Element {
  const { projects, loading, error, load, add, remove } = useProjectsStore()
  const open = useWorkspacesStore((s) => s.open)
  const agentByProject = useAgentStore((s) => s.byProject)
  const termByProject = useSessionStore((s) => s.byProject)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  // 각 프로젝트의 실시간 현황을 산출하고 급한 순으로 정렬.
  const rows = projects
    .map((p) => {
      const agent = agentByProject[p.id] ?? initialAgentState()
      const term = termByProject[p.id]
      return {
        project: p,
        status: aggregateProjectStatus(agent.status, term?.status ?? null),
        progress: computeProjectProgress(agent),
        waiting: agent.status === 'waiting_user' || agent.pending.length > 0,
        pendingTool: agent.pending[0]?.toolName ?? null
      }
    })
    .sort((a, b) => rankOf(a.status) - rankOf(b.status))

  return (
    <section className="dashboard">
      <div className="dashboard__head">
        <h1 className="dashboard__title">관제 보드</h1>
        <button className="btn btn--primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? '닫기' : '+ 프로젝트 추가'}
        </button>
      </div>

      {showForm && (
        <AddProjectForm
          onSubmit={async (input) => {
            await add(input)
            setShowForm(false)
          }}
        />
      )}

      {error && <div className="alert alert--error">불러오기 실패: {error}</div>}

      {loading && projects.length === 0 ? (
        <div className="empty">불러오는 중…</div>
      ) : projects.length === 0 ? (
        <div className="empty">
          등록된 프로젝트가 없습니다.
          <span className="empty__hint">오른쪽 위 “+ 프로젝트 추가”로 워크스페이스를 등록하세요.</span>
        </div>
      ) : (
        <ul className="board">
          {rows.map(({ project, status, progress, waiting, pendingTool }) => (
            <li
              key={project.id}
              className={`board__row${waiting ? ' board__row--waiting' : ''}`}
              onClick={() => open(project)}
            >
              <StatusDot status={status} />
              <span className="board__name">{project.name}</span>

              <div className="board__mid">
                {waiting ? (
                  <span className="board__waiting">⚠ 승인 대기{pendingTool ? ` — ${pendingTool}` : ''}</span>
                ) : progress.todoCounts ? (
                  <ProgressBar
                    percent={progress.percent ?? 0}
                    label={`${progress.todoCounts.done}/${progress.todoCounts.total} · ${progress.percent}%`}
                  />
                ) : status === null ? (
                  <span className="board__idle">— 대기 중(아직 실행 안 함)</span>
                ) : (
                  <span className="board__idle">—</span>
                )}
                {!waiting && progress.current && (
                  <span className="board__current">지금: {progress.current}</span>
                )}
              </div>

              <div className="board__actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn--ghost-danger" onClick={() => void remove(project.id)}>
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AddProjectForm({
  onSubmit
}: {
  onSubmit: (input: CreateProjectInput) => void | Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const canSubmit = name.trim() !== '' && path.trim() !== ''

  const pickFolder = async (): Promise<void> => {
    const picked = await dialogApi.openDirectory()
    if (!picked) return
    setPath(picked)
    if (name.trim() === '') {
      const base = picked.split(/[\\/]/).filter(Boolean).pop() ?? ''
      setName(base)
    }
  }

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) void onSubmit({ name: name.trim(), workspacePath: path.trim() })
      }}
    >
      <input className="input" placeholder="프로젝트 이름" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        className="input"
        placeholder="워크스페이스 경로 (예: C:\repo\my-app)"
        value={path}
        onChange={(e) => setPath(e.target.value)}
      />
      <button type="button" className="btn" onClick={() => void pickFolder()}>폴더 찾기</button>
      <button className="btn btn--primary" type="submit" disabled={!canSubmit}>등록</button>
    </form>
  )
}
