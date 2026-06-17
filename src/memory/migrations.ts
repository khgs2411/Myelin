import type { Database } from "bun:sqlite";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../runtime/config.ts";
import { sessionMemoryEmbeddingId } from "./session-memory-embeddings.ts";

type Migration = { version: number; sql?: string; apply?: (db: Database, now: Date) => void };

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
        repo_path           TEXT,
        git_branch          TEXT,
        git_commit          TEXT,
        git_worktree_id     TEXT,
        dedupe_key          TEXT,
        inserted_at         TEXT NOT NULL
      );
      CREATE INDEX experience_events_project_time ON experience_events(project_key, occurred_at);
      CREATE INDEX experience_events_project_kind_time ON experience_events(project_key, event_kind, occurred_at);
      CREATE INDEX experience_events_project_branch_time ON experience_events(project_key, git_branch, occurred_at);
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
        ingest_job_id          TEXT,
        provider               TEXT,
        provider_session_id    TEXT,
        claimed_at             TEXT NOT NULL,
        finalized_at           TEXT,
        state                  TEXT NOT NULL CHECK (state IN ('claimed', 'output', 'no_output', 'failed', 'unfinished')),
        terminal_decision      TEXT,
        source_metadata_json   TEXT NOT NULL,
        retained_evidence_json TEXT NOT NULL,
        output_references_json TEXT NOT NULL
      );
      CREATE INDEX experience_event_tombstones_project_time ON experience_event_tombstones(project_key, claimed_at);
      CREATE UNIQUE INDEX experience_event_tombstones_original_event ON experience_event_tombstones(original_event_id);
      CREATE UNIQUE INDEX experience_event_tombstones_dedupe_key ON experience_event_tombstones(dedupe_key) WHERE dedupe_key IS NOT NULL;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE ingest_jobs (
        id                  TEXT PRIMARY KEY,
        project_key         TEXT NOT NULL,
        status              TEXT NOT NULL CHECK (status IN ('starting', 'running', 'needs_followup', 'completed', 'failed')),
        provider            TEXT NOT NULL,
        provider_session_id TEXT,
        requested_by        TEXT,
        input_json          TEXT NOT NULL,
        output_counts_json  TEXT NOT NULL,
        terminal_summary    TEXT,
        error_json          TEXT,
        followup_state_json TEXT,
        started_at          TEXT,
        finished_at         TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX ingest_jobs_project_created ON ingest_jobs(project_key, created_at);
      CREATE INDEX ingest_jobs_project_status_created ON ingest_jobs(project_key, status, created_at);

      CREATE TABLE session_memories (
        id                    TEXT PRIMARY KEY,
        project_key            TEXT NOT NULL,
        provider               TEXT,
        provider_session_id    TEXT,
        ingest_job_id          TEXT REFERENCES ingest_jobs(id),
        source_event_refs_json TEXT NOT NULL,
        memory_kind            TEXT NOT NULL CHECK (memory_kind IN ('continuity', 'decision', 'blocker', 'next_action', 'verification')),
        title                  TEXT,
        summary                TEXT NOT NULL,
        payload_json           TEXT NOT NULL,
        confidence             TEXT NOT NULL,
        risk                   TEXT NOT NULL,
        status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'retracted')),
        superseded_by          TEXT,
        lifecycle_reason       TEXT,
        superseded_at          TEXT,
        retracted_at           TEXT,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL
      );
      CREATE INDEX session_memories_project_created ON session_memories(project_key, created_at);
      CREATE INDEX session_memories_project_kind_created ON session_memories(project_key, memory_kind, created_at);
      CREATE INDEX session_memories_project_status_created ON session_memories(project_key, status, created_at);

      CREATE TABLE memory_candidates (
        id                    TEXT PRIMARY KEY,
        project_key            TEXT NOT NULL,
        scope                  TEXT NOT NULL CHECK (scope IN ('session', 'project', 'practice', 'personal')),
        status                 TEXT NOT NULL CHECK (status IN ('pending', 'needs_review', 'processed', 'rejected')),
        candidate_type         TEXT NOT NULL,
        title                  TEXT,
        summary                TEXT NOT NULL,
        source_event_refs_json TEXT NOT NULL,
        evidence_json          TEXT NOT NULL,
        proposed_payload_json  TEXT NOT NULL,
        confidence             TEXT NOT NULL,
        risk                   TEXT NOT NULL,
        reason                 TEXT NOT NULL,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL,
        processed_at           TEXT
      );
      CREATE INDEX memory_candidates_project_status ON memory_candidates(project_key, status, created_at);
      CREATE INDEX memory_candidates_project_scope_status ON memory_candidates(project_key, scope, status, created_at);

      CREATE TABLE project_handoff_instructions (
        id                             TEXT PRIMARY KEY,
        project_key                    TEXT NOT NULL,
        status                         TEXT NOT NULL CHECK (status IN ('pending', 'needs_review', 'processed', 'rejected')),
        objective                      TEXT NOT NULL,
        prompt_text                    TEXT NOT NULL,
        source_session_memory_ids_json TEXT NOT NULL,
        source_event_refs_json         TEXT NOT NULL,
        suggested_actions_json         TEXT NOT NULL,
        reason                         TEXT NOT NULL,
        confidence                     TEXT NOT NULL,
        risk                           TEXT NOT NULL,
        created_at                     TEXT NOT NULL,
        updated_at                     TEXT NOT NULL,
        processed_at                   TEXT
      );
      CREATE INDEX project_handoff_instructions_project_status ON project_handoff_instructions(project_key, status, created_at);

      CREATE TABLE practice_handoff_instructions (
        id                             TEXT PRIMARY KEY,
        project_key                    TEXT NOT NULL,
        status                         TEXT NOT NULL CHECK (status IN ('pending', 'needs_review', 'processed', 'rejected')),
        objective                      TEXT NOT NULL,
        prompt_text                    TEXT NOT NULL,
        source_session_memory_ids_json TEXT NOT NULL,
        source_event_refs_json         TEXT NOT NULL,
        suggested_actions_json         TEXT NOT NULL,
        reason                         TEXT NOT NULL,
        confidence                     TEXT NOT NULL,
        risk                           TEXT NOT NULL,
        created_at                     TEXT NOT NULL,
        updated_at                     TEXT NOT NULL,
        processed_at                   TEXT
      );
      CREATE INDEX practice_handoff_instructions_project_status ON practice_handoff_instructions(project_key, status, created_at);

      CREATE TABLE personal_handoff_instructions (
        id                             TEXT PRIMARY KEY,
        project_key                    TEXT NOT NULL,
        status                         TEXT NOT NULL CHECK (status IN ('pending', 'needs_review', 'processed', 'rejected')),
        objective                      TEXT NOT NULL,
        prompt_text                    TEXT NOT NULL,
        source_session_memory_ids_json TEXT NOT NULL,
        source_event_refs_json         TEXT NOT NULL,
        suggested_actions_json         TEXT NOT NULL,
        reason                         TEXT NOT NULL,
        confidence                     TEXT NOT NULL,
        risk                           TEXT NOT NULL,
        created_at                     TEXT NOT NULL,
        updated_at                     TEXT NOT NULL,
        processed_at                   TEXT
      );
      CREATE INDEX personal_handoff_instructions_project_status ON personal_handoff_instructions(project_key, status, created_at);
    `,
  },
  {
    version: 4,
    apply: migrateExperienceEventTombstonesToClaimFinalizeSchema,
  },
  {
    version: 5,
    apply: migrateSessionMemoryEmbeddings,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE query_embedding_cache (
        id                    TEXT PRIMARY KEY,
        project_key           TEXT NOT NULL,
        original_question     TEXT NOT NULL,
        normalized_question   TEXT NOT NULL,
        embedding_provider    TEXT NOT NULL,
        embedding_model       TEXT NOT NULL,
        embedding_dimensions  INTEGER NOT NULL,
        embedding_purpose     TEXT NOT NULL CHECK (embedding_purpose IN ('retrieval_document', 'retrieval_query')),
        format_version        INTEGER NOT NULL,
        embedding_json        TEXT NOT NULL,
        hit_count             INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        last_used_at          TEXT NOT NULL,
        UNIQUE (
          project_key,
          normalized_question,
          embedding_provider,
          embedding_model,
          embedding_dimensions,
          embedding_purpose,
          format_version
        )
      );
      CREATE INDEX query_embedding_cache_project_updated
        ON query_embedding_cache(project_key, updated_at);
    `,
  },
  {
    version: 7,
    apply: migrateBranchAwareSessionMemoryContext,
  },
  {
    version: 8,
    apply: migrateSessionMemoryLifecycle,
  },
];

export function runMigrations(db: Database, now: Date = new Date()): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);");
  const row = db.query("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  const current = row?.v ?? 0;

  for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
    const apply = db.transaction(() => {
      if (migration.sql) db.exec(migration.sql);
      if (migration.apply) migration.apply(db, now);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        now.toISOString(),
      );
    });
    apply(); // throws on failure → transaction rolls back, version stays unrecorded → re-open resumes
  }
}

type TableColumn = { name: string };

type LegacyExperienceEventTombstone = {
  id: string;
  original_event_id: string;
  dedupe_key: string | null;
  project_key: string;
  processed_at: string;
  terminal_decision: string | null;
  output_references_json: string | null;
};

function migrateExperienceEventTombstonesToClaimFinalizeSchema(db: Database): void {
  const columns = db.query("PRAGMA table_info(experience_event_tombstones)").all() as TableColumn[];
  const columnNames = new Set(columns.map((column) => column.name));

  if (columnNames.has("ingest_job_id")) return;
  if (!columnNames.has("processed_at")) return;

  const legacyRows = db.query("SELECT * FROM experience_event_tombstones ORDER BY processed_at, id").all() as
    LegacyExperienceEventTombstone[];

  db.exec(`
    CREATE TABLE experience_event_tombstones_new (
      id                    TEXT PRIMARY KEY,
      original_event_id      TEXT NOT NULL,
      dedupe_key             TEXT,
      project_key            TEXT NOT NULL,
      ingest_job_id          TEXT,
      provider               TEXT,
      provider_session_id    TEXT,
      claimed_at             TEXT NOT NULL,
      finalized_at           TEXT,
      state                  TEXT NOT NULL CHECK (state IN ('claimed', 'output', 'no_output', 'failed', 'unfinished')),
      terminal_decision      TEXT,
      source_metadata_json   TEXT NOT NULL,
      retained_evidence_json TEXT NOT NULL,
      output_references_json TEXT NOT NULL
    );
  `);

  const insert = db.query(
    `INSERT INTO experience_event_tombstones_new
      (id, original_event_id, dedupe_key, project_key, ingest_job_id, provider, provider_session_id,
       claimed_at, finalized_at, state, terminal_decision, source_metadata_json, retained_evidence_json,
       output_references_json)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'output', ?, ?, ?, ?)`,
  );

  for (const row of legacyRows) {
    insert.run(
      row.id,
      row.original_event_id,
      row.dedupe_key,
      row.project_key,
      "legacy-terminal",
      row.processed_at,
      row.processed_at,
      row.terminal_decision,
      JSON.stringify({
        original_event_id: row.original_event_id,
        project_key: row.project_key,
        migrated_from: "terminal_tombstone",
      }),
      JSON.stringify({}),
      row.output_references_json ?? JSON.stringify([]),
    );
  }

  db.exec(`
    DROP TABLE experience_event_tombstones;
    ALTER TABLE experience_event_tombstones_new RENAME TO experience_event_tombstones;
    CREATE INDEX experience_event_tombstones_project_time ON experience_event_tombstones(project_key, claimed_at);
    CREATE UNIQUE INDEX experience_event_tombstones_original_event ON experience_event_tombstones(original_event_id);
    CREATE UNIQUE INDEX experience_event_tombstones_dedupe_key ON experience_event_tombstones(dedupe_key) WHERE dedupe_key IS NOT NULL;
  `);
}

function migrateSessionMemoryEmbeddings(db: Database, now: Date): void {
  db.exec(`
    CREATE TABLE session_memory_embeddings (
      id                    TEXT PRIMARY KEY,
      session_memory_id     TEXT NOT NULL REFERENCES session_memories(id),
      project_key           TEXT NOT NULL,
      embedding_provider    TEXT NOT NULL,
      embedding_model       TEXT NOT NULL,
      embedding_dimensions  INTEGER NOT NULL,
      embedding_purpose     TEXT NOT NULL CHECK (embedding_purpose IN ('retrieval_document', 'retrieval_query')),
      format_version        INTEGER NOT NULL,
      normalized_text_hash  TEXT,
      status                TEXT NOT NULL CHECK (status IN ('pending', 'indexed', 'failed')),
      failure_reason        TEXT,
      retry_count           INTEGER NOT NULL DEFAULT 0,
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL,
      indexed_at            TEXT,
      UNIQUE (
        session_memory_id,
        embedding_provider,
        embedding_model,
        embedding_dimensions,
        embedding_purpose,
        format_version
      )
    );
    CREATE INDEX session_memory_embeddings_project_status
      ON session_memory_embeddings(project_key, status, updated_at);
    CREATE INDEX session_memory_embeddings_memory
      ON session_memory_embeddings(session_memory_id);
  `);

  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_memories'")
    .all() as Array<{ name: string }>;
  if (tables.length === 0) return;

  const contract = DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT;
  const timestamp = now.toISOString();
  const rows = db.query("SELECT id, project_key FROM session_memories ORDER BY created_at, id").all() as Array<{
    id: string;
    project_key: string;
  }>;
  const insert = db.query(
    `INSERT OR IGNORE INTO session_memory_embeddings
      (id, session_memory_id, project_key, embedding_provider, embedding_model, embedding_dimensions,
       embedding_purpose, format_version, status, retry_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
  );

  for (const row of rows) {
    insert.run(
      sessionMemoryEmbeddingId({
        session_memory_id: row.id,
        contract,
      }),
      row.id,
      row.project_key,
      contract.provider,
      contract.model,
      contract.dimensions,
      contract.purpose,
      contract.formatVersion,
      timestamp,
      timestamp,
    );
  }
}

function migrateBranchAwareSessionMemoryContext(db: Database): void {
  if (tableExists(db, "experience_events")) {
    const experienceColumns = tableColumns(db, "experience_events");
    if (!experienceColumns.has("repo_path")) db.exec("ALTER TABLE experience_events ADD COLUMN repo_path TEXT;");
    if (!experienceColumns.has("git_branch")) db.exec("ALTER TABLE experience_events ADD COLUMN git_branch TEXT;");
    if (!experienceColumns.has("git_commit")) db.exec("ALTER TABLE experience_events ADD COLUMN git_commit TEXT;");
    if (!experienceColumns.has("git_worktree_id")) db.exec("ALTER TABLE experience_events ADD COLUMN git_worktree_id TEXT;");
    db.exec(`
      CREATE INDEX IF NOT EXISTS experience_events_project_branch_time
        ON experience_events(project_key, git_branch, occurred_at);
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_memory_contexts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_memory_id TEXT NOT NULL REFERENCES session_memories(id),
      project_key       TEXT NOT NULL,
      repo_path         TEXT,
      git_branch        TEXT,
      git_commit        TEXT,
      git_worktree_id   TEXT,
      source_event_ref  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_memory_contexts_project_branch
      ON session_memory_contexts(project_key, git_branch, session_memory_id);
    CREATE INDEX IF NOT EXISTS session_memory_contexts_memory
      ON session_memory_contexts(session_memory_id);
  `);
}

function migrateSessionMemoryLifecycle(db: Database): void {
  if (tableExists(db, "session_memories")) {
    const columns = tableColumns(db, "session_memories");
    if (!columns.has("status")) {
      db.exec("ALTER TABLE session_memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active';");
    }
    if (!columns.has("superseded_by")) db.exec("ALTER TABLE session_memories ADD COLUMN superseded_by TEXT;");
    if (!columns.has("lifecycle_reason")) db.exec("ALTER TABLE session_memories ADD COLUMN lifecycle_reason TEXT;");
    if (!columns.has("superseded_at")) db.exec("ALTER TABLE session_memories ADD COLUMN superseded_at TEXT;");
    if (!columns.has("retracted_at")) db.exec("ALTER TABLE session_memories ADD COLUMN retracted_at TEXT;");
    db.exec(`
      CREATE INDEX IF NOT EXISTS session_memories_project_status_created
        ON session_memories(project_key, status, created_at);
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_memory_links (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      source_memory_id       TEXT NOT NULL REFERENCES session_memories(id),
      target_memory_id       TEXT NOT NULL REFERENCES session_memories(id),
      project_key            TEXT NOT NULL,
      relationship           TEXT NOT NULL CHECK (relationship IN ('supersedes', 'refines', 'contradicts', 'duplicates')),
      reason                 TEXT NOT NULL,
      source_event_refs_json TEXT NOT NULL,
      created_at             TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_memory_links_project_source
      ON session_memory_links(project_key, source_memory_id, relationship);
    CREATE INDEX IF NOT EXISTS session_memory_links_project_target
      ON session_memory_links(project_key, target_memory_id, relationship);
  `);
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function tableColumns(db: Database, table: string): Set<string> {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as TableColumn[];
  return new Set(columns.map((column) => column.name));
}
