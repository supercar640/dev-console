import { useState } from 'react'
import Dashboard from './views/Dashboard'
import Terminal from './views/Terminal'
import type { Project } from '@shared/types'

export default function App(): React.JSX.Element {
  const [active, setActive] = useState<Project | null>(null)

  return (
    <div className="app">
      <header className="app__topbar">
        <span className="app__brand">개발 상황판</span>
        <span className="app__tag">DEV CONSOLE · M2</span>
      </header>
      <main className="app__main">
        {active ? (
          <Terminal project={active} onBack={() => setActive(null)} />
        ) : (
          <Dashboard onOpenTerminal={setActive} />
        )}
      </main>
    </div>
  )
}
