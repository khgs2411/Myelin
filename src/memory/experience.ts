import type { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type ExperienceStatus = "valid" | "invalid";

export type ExperienceEventInput = {
  id: string;
  project_key: string;
  occurred_at: string;
  hook_event_name?: string | null;
  event_kind?: string | null;
  cwd?: string | null;
  provider: string;
  provider_session_id?: string | null;
  turn_id?: string | null;
  raw_text?: string | null;
  raw_payload_json: string;
  source: string;
  status: ExperienceStatus;
};

export type ExperienceEventRow = Required<
  Omit<
    ExperienceEventInput,
    "hook_event_name" | "event_kind" | "cwd" | "provider_session_id" | "turn_id" | "raw_text"
  >
> & {
  hook_event_name: string | null;
  event_kind: string | null;
  cwd: string | null;
  provider_session_id: string | null;
  turn_id: string | null;
  raw_text: string | null;
  dedupe_key: string | null;
  inserted_at: string;
};

export type HookErrorInput = {
  occurred_at: string;
  provider?: string | null;
  source: string;
  project_key?: string | null;
  cwd?: string | null;
  hook_event_name?: string | null;
  error_message: string;
  raw_payload_json?: string | null;
};

export function recordExperienceEvent(
  db: Database,
  input: ExperienceEventInput,
  insertedAt = new Date(),
): ExperienceEventRow | null {
  const dedupeKey = providerDedupeKey(input);
  const tombstone = db
    .query(
      `SELECT 1 FROM experience_event_tombstones
       WHERE original_event_id = ? OR (dedupe_key IS NOT NULL AND dedupe_key = ?)
       LIMIT 1`,
    )
    .get(input.id, dedupeKey);
  if (tombstone) return null;

  const row: ExperienceEventRow = {
    ...input,
    hook_event_name: input.hook_event_name ?? null,
    event_kind: input.event_kind ?? null,
    cwd: input.cwd ?? null,
    provider_session_id: input.provider_session_id ?? null,
    turn_id: input.turn_id ?? null,
    raw_text: input.raw_text ?? null,
    dedupe_key: dedupeKey,
    inserted_at: insertedAt.toISOString(),
  };

  db.query(
    `INSERT OR IGNORE INTO experience_events
      (id, project_key, occurred_at, hook_event_name, event_kind, cwd, provider, provider_session_id, turn_id,
       raw_text, raw_payload_json, source, status, dedupe_key, inserted_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.project_key,
    row.occurred_at,
    row.hook_event_name,
    row.event_kind,
    row.cwd,
    row.provider,
    row.provider_session_id,
    row.turn_id,
    row.raw_text,
    row.raw_payload_json,
    row.source,
    row.status,
    row.dedupe_key,
    row.inserted_at,
  );

  return (db
    .query("SELECT * FROM experience_events WHERE id = ? OR dedupe_key = ? ORDER BY inserted_at LIMIT 1")
    .get(input.id, dedupeKey) ?? row) as ExperienceEventRow;
}

export function listExperienceEvents(db: Database, projectKey: string): ExperienceEventRow[] {
  return db
    .query("SELECT * FROM experience_events WHERE project_key = ? ORDER BY occurred_at, id")
    .all(projectKey) as ExperienceEventRow[];
}

export function recordHookError(db: Database | null, fallbackPath: string, input: HookErrorInput): void {
  if (db) {
    db.query(
      `INSERT INTO hook_errors
        (occurred_at, provider, source, project_key, cwd, hook_event_name, error_message, raw_payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.occurred_at,
      input.provider ?? null,
      input.source,
      input.project_key ?? null,
      input.cwd ?? null,
      input.hook_event_name ?? null,
      input.error_message,
      input.raw_payload_json ?? null,
    );
    return;
  }

  mkdirSync(dirname(fallbackPath), { recursive: true });
  appendFileSync(fallbackPath, `${JSON.stringify(input)}\n`, "utf8");
}

export function tombstoneExperienceEvent(
  db: Database,
  input: {
    id: string;
    original_event_id: string;
    project_key: string;
    processed_at: string;
    terminal_decision: string;
    output_references: string[];
  },
): void {
  const existing = db.query("SELECT dedupe_key FROM experience_events WHERE id = ?").get(input.original_event_id) as
    | { dedupe_key: string | null }
    | null;
  if (!existing) throw new Error(`Unknown experience event: ${input.original_event_id}`);
  if (input.output_references.length === 0) throw new Error("Tombstone requires at least one output reference");

  const apply = db.transaction(() => {
    db.query(
      `INSERT INTO experience_event_tombstones
        (id, original_event_id, dedupe_key, project_key, ingest_job_id, provider, provider_session_id,
         claimed_at, finalized_at, state, terminal_decision, source_metadata_json, retained_evidence_json,
         output_references_json)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'output', ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.original_event_id,
      existing.dedupe_key,
      input.project_key,
      null,
      null,
      input.processed_at,
      input.processed_at,
      input.terminal_decision,
      JSON.stringify({ original_event_id: input.original_event_id }),
      JSON.stringify({}),
      JSON.stringify(input.output_references),
    );
    db.query("DELETE FROM experience_events WHERE id = ?").run(input.original_event_id);
  });
  apply();
}

function providerDedupeKey(input: ExperienceEventInput): string | null {
  if (input.provider_session_id && input.turn_id && input.hook_event_name) {
    return [input.provider, input.provider_session_id, input.turn_id, input.hook_event_name].join(":");
  }
  return null;
}
