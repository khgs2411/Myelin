import type { Database } from "bun:sqlite";

type Migration = { version: number; sql: string };

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE sessions (
        id          TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        title       TEXT,
        status      TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        ended_at    TEXT,
        summary     TEXT
      );
      CREATE INDEX sessions_project_started ON sessions(project_key, started_at);
      CREATE TABLE session_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        ts         TEXT NOT NULL,
        kind       TEXT NOT NULL,
        message    TEXT NOT NULL
      );
      CREATE INDEX session_events_session_ts ON session_events(session_id, ts);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE experience_events (
        id                  TEXT PRIMARY KEY,
        project_key         TEXT NOT NULL,
        occurred_at         TEXT NOT NULL,
        hook_event_name     TEXT,
        event_kind          TEXT,
        cwd                 TEXT,
        provider            TEXT NOT NULL,
        provider_session_id TEXT,
        turn_id             TEXT,
        raw_text            TEXT,
        raw_payload_json    TEXT NOT NULL,
        source              TEXT NOT NULL,
        status              TEXT NOT NULL CHECK (status IN ('valid', 'invalid')),
        dedupe_key          TEXT,
        inserted_at         TEXT NOT NULL
      );
      CREATE INDEX experience_events_project_time ON experience_events(project_key, occurred_at);
      CREATE INDEX experience_events_project_kind_time ON experience_events(project_key, event_kind, occurred_at);
      CREATE INDEX experience_events_provider_turn ON experience_events(provider, provider_session_id, turn_id);
      CREATE UNIQUE INDEX experience_events_dedupe_key ON experience_events(dedupe_key) WHERE dedupe_key IS NOT NULL;

      CREATE TABLE hook_errors (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at      TEXT NOT NULL,
        provider         TEXT,
        source           TEXT NOT NULL,
        project_key      TEXT,
        cwd              TEXT,
        hook_event_name  TEXT,
        error_message    TEXT NOT NULL,
        raw_payload_json TEXT
      );
      CREATE INDEX hook_errors_time ON hook_errors(occurred_at);
      CREATE INDEX hook_errors_project_time ON hook_errors(project_key, occurred_at);

      CREATE TABLE experience_event_tombstones (
        id                    TEXT PRIMARY KEY,
        original_event_id      TEXT NOT NULL,
        dedupe_key             TEXT,
        project_key            TEXT NOT NULL,
        processed_at           TEXT NOT NULL,
        terminal_decision      TEXT NOT NULL,
        output_references_json TEXT NOT NULL
      );
      CREATE INDEX experience_event_tombstones_project_time ON experience_event_tombstones(project_key, processed_at);
      CREATE UNIQUE INDEX experience_event_tombstones_original_event ON experience_event_tombstones(original_event_id);
      CREATE UNIQUE INDEX experience_event_tombstones_dedupe_key ON experience_event_tombstones(dedupe_key) WHERE dedupe_key IS NOT NULL;
    `,
  },
];

export function runMigrations(db: Database, now: Date = new Date()): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);");
  const row = db.query("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  const current = row?.v ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        now.toISOString(),
      );
    });
    apply(); // throws on failure → transaction rolls back, version stays unrecorded → re-open resumes
  }
}
