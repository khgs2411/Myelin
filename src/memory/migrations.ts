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
