import { useState } from 'react'
import type { Project } from '@shared/types'
import AgentView from './AgentView'
import Terminal from './Terminal'

type Channel = 'agent' | 'terminal'

export default function Workspace({ project }: { project: Project }): React.JSX.Element {
  // 듀얼채널: 보기 전환은 자유(경고 없음). 채널을 닫아도 작업은 Main에서 계속 산다(절대원칙 #2).
  const [channel, setChannel] = useState<Channel>('agent')

  return (
    <section className="workspace">
      <div className="workspace__bar">
        <span className="workspace__name">{project.name}</span>
        <div className="tabs">
          <button className={`tab ${channel === 'agent' ? 'tab--on' : ''}`} onClick={() => setChannel('agent')}>🤖 에이전트</button>
          <button className={`tab ${channel === 'terminal' ? 'tab--on' : ''}`} onClick={() => setChannel('terminal')}>⌨️ 터미널</button>
        </div>
      </div>
      <div className="workspace__body">
        {channel === 'agent' ? <AgentView project={project} /> : <Terminal project={project} />}
      </div>
    </section>
  )
}
