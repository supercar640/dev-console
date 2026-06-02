import { useState } from 'react'
import type { Project } from '@shared/types'
import AgentView from './AgentView'
import Terminal from './Terminal'
import { useAgentStore } from '@/stores/agent'
import { useSessionStore } from '@/stores/session'

type Channel = 'agent' | 'terminal'

export default function Workspace({ project }: { project: Project }): React.JSX.Element {
  const [channel, setChannel] = useState<Channel>('agent')
  const agentRunning = useAgentStore((s) => {
    const ps = s.byProject[project.id]
    return !!ps?.sessionId && ps.status !== 'done' && ps.status !== 'crashed'
  })
  const terminalRunning = useSessionStore((s) => !!s.byProject[project.id]?.sessionId)

  // 듀얼채널: 보기 전환은 자유. 다른 채널이 실행 중이면 경고(차단 아님 — 확인 시 전환).
  const switchTo = (next: Channel): void => {
    if (next === channel) return
    const otherRunning = next === 'agent' ? terminalRunning : agentRunning
    if (otherRunning) {
      const other = next === 'agent' ? '터미널' : '에이전트'
      const ok = window.confirm(
        `${other} 채널이 실행 중입니다. 같은 폴더라 파일 충돌이 날 수 있습니다.\n` +
        `그래도 ${next === 'agent' ? '에이전트' : '터미널'} 채널로 전환할까요? (두 채널이 동시에 실행됩니다)`
      )
      if (!ok) return
    }
    setChannel(next)
  }

  return (
    <section className="workspace">
      <div className="workspace__bar">
        <span className="workspace__name">{project.name}</span>
        <div className="tabs">
          <button className={`tab ${channel === 'agent' ? 'tab--on' : ''}`} onClick={() => switchTo('agent')}>🤖 에이전트</button>
          <button className={`tab ${channel === 'terminal' ? 'tab--on' : ''}`} onClick={() => switchTo('terminal')}>⌨️ 터미널</button>
        </div>
      </div>
      <div className="workspace__body">
        {channel === 'agent' ? <AgentView project={project} /> : <Terminal project={project} />}
      </div>
    </section>
  )
}
