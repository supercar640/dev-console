// 프로젝트 에이전트 상태 → 진척도/현재 활동 산출(순수). node vitest.
// 진척도 출처: 가장 최근 TodoWrite tool_use 의 todos(완료/전체). 없으면 막대 생략
// (가짜 % 금지 — AGENTS.md 원칙 #4). current: in_progress todo 우선, 없으면 마지막 활동.
import type { AgentState, LogItem } from './agent-reducer'

export interface ProjectProgress {
  /** 할 일 목록 완료율(0–100). 목록 없으면 null(막대 생략 신호). */
  percent: number | null
  /** "지금 하는 중" 한 줄. in_progress todo 우선, 없으면 마지막 활동. 없으면 null. */
  current: string | null
  /** 막대 라벨용. 목록 없으면 null. */
  todoCounts: { done: number; total: number } | null
}

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export function computeProjectProgress(s: AgentState): ProjectProgress {
  const todos = latestTodos(s.log)
  if (todos) {
    const total = todos.length
    const done = todos.filter((t) => t.status === 'completed').length
    const active = todos.find((t) => t.status === 'in_progress')
    return {
      percent: Math.round((done / total) * 100),
      current: active ? (active.activeForm ?? active.content) : lastActivity(s.log),
      todoCounts: { done, total }
    }
  }
  return { percent: null, current: lastActivity(s.log), todoCounts: null }
}

/** log 를 뒤에서 앞으로 훑어 가장 최근 TodoWrite 의 유효 todos(비어있지 않음)를 반환(없으면 null). */
function latestTodos(log: LogItem[]): TodoItem[] | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const item = log[i]
    if (item.kind !== 'event' || item.event.type !== 'tool_use' || item.event.name !== 'TodoWrite') continue
    const raw = (item.event.input as { todos?: unknown } | null)?.todos
    if (!Array.isArray(raw)) return null
    const todos = raw.filter(isTodoItem)
    return todos.length > 0 ? todos : null
  }
  return null
}

function isTodoItem(v: unknown): v is TodoItem {
  const t = v as { content?: unknown; status?: unknown }
  return typeof t?.content === 'string' &&
    (t.status === 'pending' || t.status === 'in_progress' || t.status === 'completed')
}

/** 마지막 의미있는 활동 한 줄: 최신 assistant 메시지 > 최신 tool_use 이름(TodoWrite 제외). 없으면 null. */
function lastActivity(log: LogItem[]): string | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const item = log[i]
    if (item.kind !== 'event') continue
    if (item.event.type === 'message') return oneLine(item.event.text)
    if (item.event.type === 'tool_use' && item.event.name !== 'TodoWrite') return `${item.event.name} 실행 중`
  }
  return null
}

function oneLine(text: string): string {
  const line = text.trim().split('\n')[0]
  return line.length > 80 ? line.slice(0, 79) + '…' : line
}
