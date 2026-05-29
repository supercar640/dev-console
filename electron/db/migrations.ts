import type Database from 'better-sqlite3'

// Versioned migrations keyed on SQLite's PRAGMA user_version. Each migration
// runs once, in order, inside a transaction. Append new versions; never edit
// a shipped one. (spec §3 data model)

interface Migration {
  version: number
  up: (db: Database.Database) => void
}

const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE projects (
          id             TEXT PRIMARY KEY,
          name           TEXT NOT NULL,
          workspace_path TEXT NOT NULL,
          created_at     TEXT NOT NULL,
          default_model  TEXT,
          default_effort TEXT
        );

        CREATE TABLE cli_agents (
          id                     TEXT PRIMARY KEY,
          project_id             TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          cli_type               TEXT NOT NULL,
          role_label             TEXT,
          model                  TEXT,
          effort                 TEXT,
          system_prompt_override TEXT
        );

        CREATE TABLE sessions (
          id         TEXT PRIMARY KEY,
          agent_id   TEXT NOT NULL REFERENCES cli_agents(id) ON DELETE CASCADE,
          status     TEXT NOT NULL,
          started_at TEXT,
          ended_at   TEXT,
          pty_pid    INTEGER
        );

        CREATE TABLE events (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          type         TEXT NOT NULL,
          payload_json TEXT,
          timestamp    TEXT NOT NULL
        );

        CREATE TABLE checklists (
          id                TEXT PRIMARY KEY,
          project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          source_file_path  TEXT,
          content_md        TEXT,
          parsed_tasks_json TEXT
        );

        CREATE TABLE schedules (
          id          TEXT PRIMARY KEY,
          project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          cron_expr   TEXT NOT NULL,
          task_ref    TEXT,
          enabled     INTEGER NOT NULL DEFAULT 1,
          last_run_at TEXT
        );

        CREATE INDEX idx_cli_agents_project ON cli_agents(project_id);
        CREATE INDEX idx_sessions_agent     ON sessions(agent_id);
        CREATE INDEX idx_events_session     ON events(session_id);
      `)
    }
  }
]

export function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version)

  if (pending.length === 0) return

  const apply = db.transaction(() => {
    for (const m of pending) {
      m.up(db)
      // user_version is part of the db header and is transactional in SQLite.
      db.pragma(`user_version = ${m.version}`)
    }
  })
  apply()
}
