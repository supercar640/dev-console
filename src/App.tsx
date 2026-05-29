import Dashboard from './views/Dashboard'

export default function App(): React.JSX.Element {
  return (
    <div className="app">
      <header className="app__topbar">
        <span className="app__brand">개발 상황판</span>
        <span className="app__tag">DEV CONSOLE · M1</span>
      </header>
      <main className="app__main">
        <Dashboard />
      </main>
    </div>
  )
}
