import { useEffect, useState } from 'react'
import type { CreateProjectInput, Project } from '@shared/types'
import { useProjectsStore } from '@/stores/projects'

export default function Dashboard({
  onOpenTerminal
}: {
  onOpenTerminal: (p: Project) => void
}): React.JSX.Element {
  const { projects, loading, error, load, add, remove } = useProjectsStore()
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="dashboard">
      <div className="dashboard__head">
        <h1 className="dashboard__title">프로젝트</h1>
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
        <ul className="cards">
          {projects.map((p) => (
            <li key={p.id} className="card">
              <div className="card__body">
                <div className="card__name">{p.name}</div>
                <div className="card__path">{p.workspacePath}</div>
              </div>
              <div className="card__actions">
                <button className="btn" onClick={() => onOpenTerminal(p)}>
                  터미널 열기
                </button>
                <button className="btn btn--ghost-danger" onClick={() => void remove(p.id)}>
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

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) void onSubmit({ name: name.trim(), workspacePath: path.trim() })
      }}
    >
      <input
        className="input"
        placeholder="프로젝트 이름"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="input"
        placeholder="워크스페이스 경로 (예: C:\repo\my-app)"
        value={path}
        onChange={(e) => setPath(e.target.value)}
      />
      <button className="btn btn--primary" type="submit" disabled={!canSubmit}>
        등록
      </button>
    </form>
  )
}
