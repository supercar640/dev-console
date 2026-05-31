import { useState } from 'react'
import Dashboard from './views/Dashboard'
import Workspace from './views/Workspace'
import type { Project } from '@shared/types'

export default function App(): React.JSX.Element {
  const [active, setActive] = useState<Project | null>(null)

  return (
    <div className="app">
      <header className="app__topbar">
        <span className="app__brand">개발 상황판</span>
        <span className="app__tag">DEV CONSOLE · M3</span>
      </header>
      <main className="app__main">
        {active ? (
          <Workspace project={active} onBack={() => setActive(null)} />
        ) : (
          <Dashboard onOpenTerminal={setActive} />
        )}
      </main>
    </div>
  )
}
