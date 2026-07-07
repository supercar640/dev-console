// Agent 이벤트/세션 영속화 어댑터(Main 소유). better-sqlite3 동기 API.
// 단위 테스트 없음(Electron ABI 전용) — 위험 로직은 event-codec(순수)로 분리, SQL은 수동 스모크.
import type Database from 'better-sqlite3'
import type { AgentEvent, RestoredSession, SessionStatus } from '@shared/types'
import { encodeEvent, decodeEvent, resolveRestoredStatus } from '../agent/event-codec'

interface SessionRow {
  sessionId: string
  projectId: string
  status: SessionStatus
  endedAt: string | null
}

export class AgentStore {
  constructor(private readonly db: Database.Database) {}

  /** 세션 시작 1행. cli_agents는 프로젝트당 기본 에이전트 1행을 결정적 id로 lazy upsert. */
  recordSessionStart(sessionId: string, projectId: string, startedAt: string): void {
    const agentId = `default-${projectId}`
    this.db
      .prepare(`INSERT OR IGNORE INTO cli_agents (id, project_id, cli_type) VALUES (?, ?, 'claude')`)
      .run(agentId, projectId)
    this.db
      .prepare(`INSERT INTO sessions (id, agent_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(sessionId, agentId, startedAt)
  }

  /** 이벤트 1행. type = 필터/인덱스용, payload_json = 원형 보존, id ASC = 발생 순서. */
  recordEvent(sessionId: string, event: AgentEvent, timestamp: string): void {
    this.db
      .prepare(`INSERT INTO events (session_id, type, payload_json, timestamp) VALUES (?, ?, ?, ?)`)
      .run(sessionId, event.type, encodeEvent(event), timestamp)
  }

  /** 세션 종료: 상태 + ended_at 갱신. */
  recordSessionEnd(sessionId: string, status: SessionStatus, endedAt: string): void {
    this.db
      .prepare(`UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?`)
      .run(status, endedAt, sessionId)
  }

  /** 프로젝트별 가장 최근 세션 1건 + 그 이벤트를 복원용으로 조회. */
  loadHistory(): RestoredSession[] {
    const rows = this.db
      .prepare(
        `SELECT s.id AS sessionId, a.project_id AS projectId, s.status AS status, s.ended_at AS endedAt
         FROM sessions s
         JOIN cli_agents a ON s.agent_id = a.id
         ORDER BY a.project_id ASC, s.started_at DESC, s.rowid DESC`
      )
      .all() as SessionRow[]

    const seen = new Set<string>()
    const result: RestoredSession[] = []
    for (const row of rows) {
      if (seen.has(row.projectId)) continue // 프로젝트별 최근 1건만(정렬상 첫 행)
      seen.add(row.projectId)
      const eventRows = this.db
        .prepare(`SELECT payload_json AS payloadJson FROM events WHERE session_id = ? ORDER BY id ASC`)
        .all(row.sessionId) as Array<{ payloadJson: string | null }>
      const events = eventRows
        .map((e) => decodeEvent(e.payloadJson))
        .filter((e): e is AgentEvent => e !== null)
      result.push({
        projectId: row.projectId,
        sessionId: row.sessionId,
        status: resolveRestoredStatus(row.status, row.endedAt),
        events
      })
    }
    return result
  }
}
