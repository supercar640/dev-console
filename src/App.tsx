import { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Dashboard from './views/Dashboard'
import Workspace from './views/Workspace'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useAgentStore } from '@/stores/agent'

export default function App(): React.JSX.Element {
  const openProjects = useWorkspacesStore((s) => s.openProjects)
  const activeProjectId = useWorkspacesStore((s) => s.activeProjectId)
  const activeProject = openProjects.find((p) => p.id === activeProjectId) ?? null

  // 앱 시작 1회: 프로젝트별 마지막 세션을 읽기 전용으로 복원.
  useEffect(() => {
    void useAgentStore.getState().loadHistory()
  }, [])

  return (
    <div className="app">
      <div className="app__shell">
        <Sidebar />
        <main className="app__main">
          {activeProject ? (
            // key=프로젝트 → 전환 시 Workspace 재마운트 = 터미널 재attach + 링버퍼 replay(M2).
            <Workspace key={activeProject.id} project={activeProject} />
          ) : (
            <Dashboard />
          )}
        </main>
      </div>
    </div>
  )
}
