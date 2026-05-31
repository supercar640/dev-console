import type { LogItem } from '@/stores/agent-reducer'

export default function AgentEventItem({ item }: { item: LogItem }): React.JSX.Element | null {
  if (item.kind === 'user') {
    return <div className="ev ev--user">{item.text}</div>
  }
  const e = item.event
  switch (e.type) {
    case 'message':
      return <div className="ev ev--assistant">{e.text}</div>
    case 'tool_use':
      return <div className="ev ev--tool"><span className="ev__arrow">▸</span> {e.name} <code>{short(e.input)}</code></div>
    case 'tool_result':
      return <div className="ev ev--tool-result">◂ {e.name}</div>
    case 'usage':
      return <div className="ev ev--usage">↑{e.tokens.input} ↓{e.tokens.output} tokens</div>
    case 'error':
      return <div className="ev ev--error">⚠ {e.message}</div>
    case 'session_end':
      return <div className="ev ev--system">— 세션 종료 ({e.reason}) —</div>
    default:
      return null
  }
}

function short(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 120 ? s.slice(0, 120) + '…' : s
}
