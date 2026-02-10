// packages/agent-state/src/schema.ts
import Database from 'better-sqlite3';

export const SCHEMA_VERSION = 1;

export function initializeSchema(db: Database.Database): void {
	db.exec(`
    -- Schema version tracking
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );

    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      title         TEXT,
      model         TEXT NOT NULL,
      region        TEXT NOT NULL,
      status        TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'error')),
      config        TEXT
    );

    -- Turns table
    CREATE TABLE IF NOT EXISTS turns (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      turn_number     INTEGER NOT NULL,
      created_at      INTEGER NOT NULL,
      user_message    TEXT NOT NULL,
      assistant_response TEXT,
      tool_calls      TEXT,
      tokens_used     INTEGER,
      cost_usd        REAL,
      error           TEXT,
      UNIQUE(session_id, turn_number)
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, turn_number);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  `);

	// Insert or update schema version
	const existing = db.prepare('SELECT version FROM schema_version').get();
	if (!existing) {
		db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
	}
}

export function getSchemaVersion(db: Database.Database): number {
	const row = db.prepare('SELECT version FROM schema_version').get() as
		| { version: number }
		| undefined;
	return row?.version ?? 0;
}
