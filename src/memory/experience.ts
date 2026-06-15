import type { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TombstoneState } from "./ingest-types.ts";

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

export type ClaimedExperienceTombstone = {
  id: string;
  original_event_id: string;
  project_key: string;
  ingest_job_id: string;
  provider: string | null;
  provider_session_id: string | null;
  claimed_at: string;
  state: TombstoneState;
  source_metadata_json: string;
  retained_evidence_json: string;
};

export type LeasedExperienceEvent = ClaimedExperienceTombstone & {
  prompt_evidence: {
    raw_text: string | null;
    raw_payload_json: string;
  };
};

export type ClaimExperienceEventsInput = {
  ingest_job_id: string;
  project_key: string;
  provider_session_id?: string | null;
  limit: number;
  max_prompt_chars?: number;
  prompt_chars_for_tombstone?: (tombstone: ClaimedExperienceTombstone) => number;
  claimed_at: string;
  tombstone_id_for: (event: ExperienceEventRow) => string;
};

export type LeaseExperienceEventsInput = {
  ingest_job_id: string;
  project_key: string;
  provider_session_id?: string | null;
  limit: number;
  max_prompt_chars?: number;
  prompt_chars_for_lease?: (lease: LeasedExperienceEvent) => number;
  claimed_at: string;
  tombstone_id_for: (event: ExperienceEventRow) => string;
};

export type FinalizeClaimedExperienceEventsInput = {
  ingest_job_id: string;
  tombstone_ids: string[];
  finalized_at: string;
  state: Exclude<TombstoneState, "claimed">;
  terminal_decision: string;
  output_references: string[];
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

export function countExperienceEvents(db: Database, projectKey: string): number {
  const row = db
    .query("SELECT count(*) AS count FROM experience_events WHERE project_key = ?")
    .get(projectKey) as { count: number };
  return row.count;
}

export function countLeasedExperienceEvents(db: Database, projectKey: string): number {
  const row = db
    .query(
      `SELECT count(*) AS count
       FROM experience_event_tombstones t
       JOIN experience_events e ON e.id = t.original_event_id AND e.project_key = t.project_key
       WHERE t.project_key = ? AND t.state = 'claimed'`,
    )
    .get(projectKey) as { count: number };
  return row.count;
}

export function countUnleasedExperienceEvents(db: Database, projectKey: string): number {
  const row = db
    .query(
      `SELECT count(*) AS count
       FROM experience_events e
       WHERE e.project_key = ?
         AND NOT EXISTS (
           SELECT 1
           FROM experience_event_tombstones t
           WHERE t.project_key = e.project_key
             AND t.state = 'claimed'
             AND (
               t.original_event_id = e.id
               OR (e.dedupe_key IS NOT NULL AND t.dedupe_key = e.dedupe_key)
             )
         )`,
    )
    .get(projectKey) as { count: number };
  return row.count;
}

export function claimExperienceEvents(db: Database, input: ClaimExperienceEventsInput): ClaimedExperienceTombstone[] {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new Error("Claim limit must be a positive integer");
  }

  const claim = db.transaction(() => {
    const rows = db
      .query("SELECT * FROM experience_events WHERE project_key = ? ORDER BY occurred_at, id LIMIT ?")
      .all(input.project_key, input.limit) as ExperienceEventRow[];
    const claimed: ClaimedExperienceTombstone[] = [];
    let claimedPromptChars = 0;

    for (const row of rows) {
      const tombstone = buildClaimedTombstone(row, {
        id: input.tombstone_id_for(row),
        ingest_job_id: input.ingest_job_id,
        provider_session_id: input.provider_session_id,
        claimed_at: input.claimed_at,
      });
      const tombstonePromptChars = input.prompt_chars_for_tombstone?.(tombstone) ?? JSON.stringify(tombstone, null, 2).length;
      if (
        input.max_prompt_chars !== undefined &&
        claimed.length > 0 &&
        claimedPromptChars + tombstonePromptChars > input.max_prompt_chars
      ) {
        break;
      }
      insertClaimedTombstone(db, tombstone, row.dedupe_key);
      db.query("DELETE FROM experience_events WHERE id = ? AND project_key = ?").run(row.id, row.project_key);
      claimed.push(tombstone);
      claimedPromptChars += tombstonePromptChars;
    }

    return claimed;
  });

  return claim();
}

export function leaseExperienceEvents(db: Database, input: LeaseExperienceEventsInput): LeasedExperienceEvent[] {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new Error("Lease limit must be a positive integer");
  }

  const lease = db.transaction(() => {
    const leased: LeasedExperienceEvent[] = [];
    let promptChars = 0;

    const canAddLease = (leasedEvent: LeasedExperienceEvent): boolean => {
      const leasePromptChars =
        input.prompt_chars_for_lease?.(leasedEvent) ?? JSON.stringify(leasedEvent, null, 2).length;
      return !(
        input.max_prompt_chars !== undefined &&
        leased.length > 0 &&
        promptChars + leasePromptChars > input.max_prompt_chars
      );
    };
    const addLease = (leasedEvent: LeasedExperienceEvent): void => {
      const leasePromptChars =
        input.prompt_chars_for_lease?.(leasedEvent) ?? JSON.stringify(leasedEvent, null, 2).length;
      leased.push(leasedEvent);
      promptChars += leasePromptChars;
    };

    const recoverable = selectRecoverableTombstoneLeases(db, input.project_key, input.limit);
    for (const row of recoverable) {
      const recovered = buildRecoveredTombstoneLease(row, {
        next_ingest_job_id: input.ingest_job_id,
        provider_session_id: input.provider_session_id,
        recovered_at: input.claimed_at,
      });
      if (!canAddLease(recovered)) break;
      updateRecoveredTombstoneLease(db, recovered);
      addLease(recovered);
    }

    if (leased.length >= input.limit) return leased;

    const rows = selectUnleasedExperienceEvents(db, input.project_key, input.limit - leased.length);
    for (const row of rows) {
      const leasedEvent = buildLeasedExperienceEvent(row, {
        id: input.tombstone_id_for(row),
        ingest_job_id: input.ingest_job_id,
        provider_session_id: input.provider_session_id,
        claimed_at: input.claimed_at,
      });
      if (!canAddLease(leasedEvent)) break;
      if (!insertTombstoneLeaseStub(db, leasedEvent, row.dedupe_key)) continue;
      addLease(leasedEvent);
    }

    return leased;
  });

  return lease();
}

export function finalizeClaimedExperienceEventsInOpenTransaction(
  db: Database,
  input: FinalizeClaimedExperienceEventsInput,
): void {
  if (input.tombstone_ids.length === 0) return;
  if (input.state === "output" && input.output_references.length === 0) {
    throw new Error("Output tombstones require at least one output reference");
  }

  for (const id of input.tombstone_ids) {
    const result = db
      .query(
        `UPDATE experience_event_tombstones
         SET finalized_at = ?, state = ?, terminal_decision = ?, output_references_json = ?
         WHERE id = ? AND ingest_job_id = ? AND state = 'claimed'`,
      )
      .run(
        input.finalized_at,
        input.state,
        input.terminal_decision,
        JSON.stringify(input.output_references),
        id,
        input.ingest_job_id,
      );
    if (result.changes !== 1) throw new Error(`Unable to finalize claimed tombstone: ${id}`);
  }
}

export function finalizeClaimedExperienceEvents(db: Database, input: FinalizeClaimedExperienceEventsInput): void {
  const finalize = db.transaction(() => {
    finalizeClaimedExperienceEventsInOpenTransaction(db, input);
  });
  finalize();
}

export function finalizeLeasedExperienceEventsInOpenTransaction(
  db: Database,
  input: FinalizeClaimedExperienceEventsInput & { state: "output" | "no_output" },
): void {
  if (input.tombstone_ids.length === 0) return;
  if (input.state === "output" && input.output_references.length === 0) {
    throw new Error("Output tombstones require at least one output reference");
  }

  for (const id of input.tombstone_ids) {
    const tombstone = db
      .query("SELECT * FROM experience_event_tombstones WHERE id = ? AND ingest_job_id = ? AND state = 'claimed'")
      .get(id, input.ingest_job_id) as ClaimedExperienceTombstone | null;
    if (!tombstone) throw new Error(`Unable to finalize claimed tombstone: ${id}`);

    const source = db
      .query("SELECT * FROM experience_events WHERE id = ? AND project_key = ?")
      .get(tombstone.original_event_id, tombstone.project_key) as ExperienceEventRow | null;
    if (!source) throw new Error(`Unable to finalize tombstone without source row: ${id}`);

    db.query(
      `UPDATE experience_event_tombstones
       SET finalized_at = ?, state = ?, terminal_decision = ?, retained_evidence_json = ?, output_references_json = ?
       WHERE id = ? AND ingest_job_id = ? AND state = 'claimed'`,
    ).run(
      input.finalized_at,
      input.state,
      input.terminal_decision,
      JSON.stringify({ raw_text: source.raw_text, raw_payload_json: source.raw_payload_json }),
      JSON.stringify(input.output_references),
      id,
      input.ingest_job_id,
    );
    db.query("DELETE FROM experience_events WHERE id = ? AND project_key = ?").run(source.id, source.project_key);
  }
}

export function finalizeRemainingLeasedExperienceEvents(
  db: Database,
  input: {
    ingest_job_id: string;
    finalized_at: string;
    state: "no_output";
    terminal_decision: string;
  },
): number {
  const rows = db
    .query("SELECT id FROM experience_event_tombstones WHERE ingest_job_id = ? AND state = 'claimed' ORDER BY claimed_at, id")
    .all(input.ingest_job_id) as Array<{ id: string }>;

  for (const row of rows) {
    finalizeLeasedExperienceEventsInOpenTransaction(db, {
      ingest_job_id: input.ingest_job_id,
      tombstone_ids: [row.id],
      finalized_at: input.finalized_at,
      state: input.state,
      terminal_decision: input.terminal_decision,
      output_references: [],
    });
  }

  return rows.length;
}

export function finalizeRemainingClaimedExperienceEvents(
  db: Database,
  input: {
    ingest_job_id: string;
    finalized_at: string;
    state: "no_output" | "failed" | "unfinished";
    terminal_decision: string;
  },
): number {
  const result = db
    .query(
      `UPDATE experience_event_tombstones
       SET finalized_at = ?, state = ?, terminal_decision = ?, output_references_json = ?
       WHERE ingest_job_id = ? AND state = 'claimed'`,
    )
    .run(input.finalized_at, input.state, input.terminal_decision, JSON.stringify([]), input.ingest_job_id);
  return result.changes;
}

export function recoverStaleTombstoneLease(
  db: Database,
  input: {
    tombstone_id: string;
    next_ingest_job_id: string;
    recovered_at: string;
    reason: string;
  },
): ClaimedExperienceTombstone {
  const recover = db.transaction(() => {
    const existing = db
      .query("SELECT * FROM experience_event_tombstones WHERE id = ? AND state = 'claimed'")
      .get(input.tombstone_id) as ClaimedExperienceTombstone | null;
    if (!existing) throw new Error(`Unknown claimed tombstone lease: ${input.tombstone_id}`);

    const source = db
      .query("SELECT id FROM experience_events WHERE id = ? AND project_key = ?")
      .get(existing.original_event_id, existing.project_key);
    if (!source) throw new Error(`Cannot recover tombstone lease without source row: ${input.tombstone_id}`);

    const metadata = JSON.parse(existing.source_metadata_json) as Record<string, unknown>;
    const attempts = Array.isArray(metadata.attempts) ? metadata.attempts : [];
    metadata.attempts = [
      ...attempts,
      { ingest_job_id: existing.ingest_job_id, ended_at: input.recovered_at, reason: input.reason },
    ];

    db.query(
      `UPDATE experience_event_tombstones
       SET ingest_job_id = ?, claimed_at = ?, source_metadata_json = ?
       WHERE id = ? AND state = 'claimed'`,
    ).run(input.next_ingest_job_id, input.recovered_at, JSON.stringify(metadata), input.tombstone_id);

    return db
      .query("SELECT * FROM experience_event_tombstones WHERE id = ?")
      .get(input.tombstone_id) as ClaimedExperienceTombstone;
  });

  return recover();
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
  if (input.output_references.length === 0) throw new Error("Tombstone requires at least one output reference");

  const apply = db.transaction(() => {
    claimSingleExperienceEvent(db, {
      id: input.id,
      original_event_id: input.original_event_id,
      project_key: input.project_key,
      ingest_job_id: "legacy-terminal",
      claimed_at: input.processed_at,
    });
    finalizeClaimedExperienceEventsInOpenTransaction(db, {
      ingest_job_id: "legacy-terminal",
      tombstone_ids: [input.id],
      finalized_at: input.processed_at,
      state: "output",
      terminal_decision: input.terminal_decision,
      output_references: input.output_references,
    });
  });
  apply();
}

function claimSingleExperienceEvent(
  db: Database,
  input: {
    id: string;
    original_event_id: string;
    project_key: string;
    ingest_job_id: string;
    provider_session_id?: string | null;
    claimed_at: string;
  },
): ClaimedExperienceTombstone {
  const row = db
    .query("SELECT * FROM experience_events WHERE id = ? AND project_key = ?")
    .get(input.original_event_id, input.project_key) as ExperienceEventRow | null;
  if (!row) throw new Error(`Unknown experience event: ${input.original_event_id}`);

  const tombstone = buildClaimedTombstone(row, input);
  insertClaimedTombstone(db, tombstone, row.dedupe_key);
  db.query("DELETE FROM experience_events WHERE id = ? AND project_key = ?").run(row.id, row.project_key);
  return tombstone;
}

function selectUnleasedExperienceEvents(db: Database, projectKey: string, limit: number): ExperienceEventRow[] {
  return db
    .query(
      `SELECT e.*
       FROM experience_events e
       WHERE e.project_key = ?
         AND NOT EXISTS (
           SELECT 1
           FROM experience_event_tombstones t
           WHERE t.project_key = e.project_key
             AND t.state = 'claimed'
             AND (
               t.original_event_id = e.id
               OR (e.dedupe_key IS NOT NULL AND t.dedupe_key = e.dedupe_key)
             )
         )
       ORDER BY e.occurred_at, e.id
       LIMIT ?`,
    )
    .all(projectKey, limit) as ExperienceEventRow[];
}

type RecoverableTombstoneLeaseRow = ClaimedExperienceTombstone & {
  dedupe_key: string | null;
  error_json: string | null;
  raw_text: string | null;
  raw_payload_json: string;
};

function selectRecoverableTombstoneLeases(
  db: Database,
  projectKey: string,
  limit: number,
): RecoverableTombstoneLeaseRow[] {
  return db
    .query(
      `SELECT t.*, t.dedupe_key, j.error_json, e.raw_text, e.raw_payload_json
       FROM experience_event_tombstones t
       JOIN ingest_jobs j ON j.id = t.ingest_job_id
       JOIN experience_events e ON e.id = t.original_event_id AND e.project_key = t.project_key
       WHERE t.project_key = ?
         AND t.state = 'claimed'
         AND j.status = 'failed'
       ORDER BY t.claimed_at, t.id
       LIMIT ?`,
    )
    .all(projectKey, limit) as RecoverableTombstoneLeaseRow[];
}

function buildRecoveredTombstoneLease(
  row: RecoverableTombstoneLeaseRow,
  input: {
    next_ingest_job_id: string;
    provider_session_id?: string | null;
    recovered_at: string;
  },
): LeasedExperienceEvent {
  const metadata = JSON.parse(row.source_metadata_json) as Record<string, unknown>;
  const attempts = Array.isArray(metadata.attempts) ? metadata.attempts : [];
  metadata.attempts = [
    ...attempts,
    {
      ingest_job_id: row.ingest_job_id,
      ended_at: input.recovered_at,
      reason: retryReasonFromJobError(row.error_json),
    },
  ];

  const providerSessionId = input.provider_session_id ?? row.provider_session_id;
  return {
    id: row.id,
    original_event_id: row.original_event_id,
    project_key: row.project_key,
    ingest_job_id: input.next_ingest_job_id,
    provider: row.provider,
    provider_session_id: providerSessionId,
    claimed_at: input.recovered_at,
    state: "claimed",
    source_metadata_json: JSON.stringify(metadata),
    retained_evidence_json: row.retained_evidence_json,
    prompt_evidence: {
      raw_text: row.raw_text,
      raw_payload_json: row.raw_payload_json,
    },
  };
}

function updateRecoveredTombstoneLease(db: Database, lease: LeasedExperienceEvent): void {
  db.query(
    `UPDATE experience_event_tombstones
     SET ingest_job_id = ?, provider_session_id = ?, claimed_at = ?, source_metadata_json = ?
     WHERE id = ? AND state = 'claimed'`,
  ).run(lease.ingest_job_id, lease.provider_session_id, lease.claimed_at, lease.source_metadata_json, lease.id);
}

function buildLeasedExperienceEvent(
  row: ExperienceEventRow,
  input: {
    id: string;
    ingest_job_id: string;
    provider_session_id?: string | null;
    claimed_at: string;
  },
): LeasedExperienceEvent {
  return {
    id: input.id,
    original_event_id: row.id,
    project_key: row.project_key,
    ingest_job_id: input.ingest_job_id,
    provider: row.provider,
    provider_session_id: input.provider_session_id ?? row.provider_session_id,
    claimed_at: input.claimed_at,
    state: "claimed",
    source_metadata_json: JSON.stringify({
      occurred_at: row.occurred_at,
      hook_event_name: row.hook_event_name,
      event_kind: row.event_kind,
      cwd: row.cwd,
      provider: row.provider,
      provider_session_id: row.provider_session_id,
      turn_id: row.turn_id,
      source: row.source,
      status: row.status,
      attempts: [],
    }),
    retained_evidence_json: JSON.stringify({}),
    prompt_evidence: {
      raw_text: row.raw_text,
      raw_payload_json: row.raw_payload_json,
    },
  };
}

function retryReasonFromJobError(value: string | null): string {
  if (!value) return "failed_ingest_job";
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.code === "string" && record.code.trim() !== "") return record.code;
      if (record.retryable === true) return "provider_failed";
    }
  } catch {
    return "failed_ingest_job";
  }
  return "failed_ingest_job";
}

function buildClaimedTombstone(
  row: ExperienceEventRow,
  input: {
    id: string;
    ingest_job_id: string;
    provider_session_id?: string | null;
    claimed_at: string;
  },
): ClaimedExperienceTombstone {
  return {
    id: input.id,
    original_event_id: row.id,
    project_key: row.project_key,
    ingest_job_id: input.ingest_job_id,
    provider: row.provider,
    provider_session_id: input.provider_session_id ?? row.provider_session_id,
    claimed_at: input.claimed_at,
    state: "claimed",
    source_metadata_json: JSON.stringify({
      occurred_at: row.occurred_at,
      hook_event_name: row.hook_event_name,
      event_kind: row.event_kind,
      cwd: row.cwd,
      provider: row.provider,
      provider_session_id: row.provider_session_id,
      turn_id: row.turn_id,
      source: row.source,
      status: row.status,
    }),
    retained_evidence_json: JSON.stringify({
      raw_text: row.raw_text,
      raw_payload_json: row.raw_payload_json,
    }),
  };
}

function insertTombstoneLeaseStub(db: Database, lease: LeasedExperienceEvent, dedupeKey: string | null): boolean {
  const result = db.query(
    `INSERT OR IGNORE INTO experience_event_tombstones
      (id, original_event_id, dedupe_key, project_key, ingest_job_id, provider, provider_session_id,
       claimed_at, finalized_at, state, terminal_decision, source_metadata_json, retained_evidence_json,
       output_references_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'claimed', NULL, ?, ?, ?)`,
  ).run(
    lease.id,
    lease.original_event_id,
    dedupeKey,
    lease.project_key,
    lease.ingest_job_id,
    lease.provider,
    lease.provider_session_id,
    lease.claimed_at,
    lease.source_metadata_json,
    JSON.stringify({}),
    JSON.stringify([]),
  );
  return result.changes === 1;
}

function insertClaimedTombstone(db: Database, tombstone: ClaimedExperienceTombstone, dedupeKey: string | null): void {
  db.query(
    `INSERT INTO experience_event_tombstones
      (id, original_event_id, dedupe_key, project_key, ingest_job_id, provider, provider_session_id,
       claimed_at, finalized_at, state, terminal_decision, source_metadata_json, retained_evidence_json,
       output_references_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'claimed', NULL, ?, ?, ?)`,
  ).run(
    tombstone.id,
    tombstone.original_event_id,
    dedupeKey,
    tombstone.project_key,
    tombstone.ingest_job_id,
    tombstone.provider,
    tombstone.provider_session_id,
    tombstone.claimed_at,
    tombstone.source_metadata_json,
    tombstone.retained_evidence_json,
    JSON.stringify([]),
  );
}

function providerDedupeKey(input: ExperienceEventInput): string | null {
  if (input.provider_session_id && input.turn_id && input.hook_event_name) {
    return [input.provider, input.provider_session_id, input.turn_id, input.hook_event_name].join(":");
  }
  return null;
}
