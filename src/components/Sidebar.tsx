import type { Project } from '@shared/types'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useAgentStore } from '@/stores/agent'
import { useSessionStore } from '@/stores/session'
import { aggregateProjectStatus } from '@/stores/project-status'
import StatusDot from './StatusDot'

export default function Sidebar(): React.JSX.Element {
  const openProjects = useWorkspacesStore((s) => s.openProjects)
  const activeProjectId = useWorkspacesStore((s) => s.activeProjectId)
  const setActive = useWorkspacesStore((s) => s.setActive)

  return (
    <nav className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__brand-name">개발 상황판</span>
        <span className="sidebar__brand-tag">DEV CONSOLE · M4a</span>
      </div>
      <button
        className={`sidebar__home ${activeProjectId === null ? 'is-active' : ''}`}
        onClick={() => setActive(null)}
      >🏠 대시보드</button>
      <div className="sidebar__divider" />
      <div className="sidebar__label">열린 프로젝트</div>
      <ul className="sidebar__list">
        {openProjects.length === 0 && <li className="sidebar__empty">대시보드에서 프로젝트를 여세요.</li>}
        {openProjects.map((p) => (
          <SidebarItem key={p.id} project={p} active={p.id === activeProjectId} onClick={() => setActive(p.id)} />
        ))}
      </ul>
      <button className="sidebar__add" onClick={() => setActive(null)}>+ 프로젝트</button>
    </nav>
  )
}

function SidebarItem({
  project, active, onClick
}: {
  project: Project
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  // 셀렉터는 원시값(string|null) — 안정 비교로 리렌더 최소화.
  const agentStatus = useAgentStore((s) => s.byProject[project.id]?.status ?? null)
  const terminalStatus = useSessionStore((s) => s.byProject[project.id]?.status ?? null)
  const status = aggregateProjectStatus(agentStatus, terminalStatus)
  return (
    <li className={`sidebar__item ${active ? 'is-active' : ''}`} onClick={onClick}>
      <StatusDot status={status} />
      <span className="sidebar__item-name">{project.name}</span>
    </li>
  )
}
