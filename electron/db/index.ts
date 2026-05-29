import { app } from 'electron'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

// better-sqlite3 — synchronous API, single file, owned by Main (spec §1-1).
let db: Database.Database | null = null

export function initDatabase(): Database.Database {
  if (db) return db
  const dbPath = join(app.getPath('userData'), 'dev-console.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDatabase() in Main first.')
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
