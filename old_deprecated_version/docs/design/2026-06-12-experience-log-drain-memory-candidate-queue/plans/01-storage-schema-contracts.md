# Chunk 01: Storage Schema Contracts

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** None
**Enables:** `02-experience-log-claim-finalize.md`, `03-ingest-job-runtime.md`, `04-memory-output-repositories.md`

## Goal

Add the SQLite schema and shared TypeScript contract layer for detached ingest jobs, trusted Session Memory, Memory Candidates, layer handoff instructions, and claim/finalize-capable Experience Log tombstones. This chunk owns storage shape only; it does not add CLI commands, provider spawning, or agent orchestration.

## Source Artifacts

- `../spec.md`: Data / State, Pull-To-Tombstone Lifecycle, Direct Session Memory Storage, Candidate Queue, Layer Handoff Model
- `../agenda.md`: Questions 10, 11, 15, 16, 18, 20, 21
- `../../../adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`
- `../../../../CONTEXT.md`: Session Memory, Experience Log Tombstone, Memory Candidate, Layer Handoff Instruction
- `src/memory/migrations.ts`
- `src/memory/db.ts`
- `src/memory/db.test.ts`
- `src/memory/experience.test.ts`

## Relationships

- **Depends on:** existing migrations 1 and 2.
- **Enables:** later chunks can assume the new tables and enum constants exist.
- **Shared contracts:** `IngestJobStatus`, `MemoryCandidateStatus`, `MemoryScope`, `HandoffScope`, `SessionMemoryKind`, `TombstoneState`.
- **Integration points:** `openMemoryDbAt` runs migrations automatically; tests should verify schema presence and idempotency.

## File Responsibility Map

**Create:**
- `src/memory/ingest-types.ts` - shared storage enums and row/input types for ingest-related memory tables.

**Modify:**
- `src/memory/migrations.ts` - add migration 3 with new tables, columns, checks, and indexes.
- `src/memory/db.test.ts` - assert migration 3 applies and key tables exist.
- `src/memory/experience.test.ts` - adjust schema expectations if tombstone columns change existing tests.

**Test:**
- `src/memory/db.test.ts` - migration presence, idempotency, table existence.
- `src/memory/experience.test.ts` - existing Experience Log tests still pass after schema change.

## Implementation Tasks

### Task 1: Define Shared Storage Types

**Files:**
- Create: `src/memory/ingest-types.ts`

- [ ] **Step 1: Add shared enums and table row/input types**

```ts
export const INGEST_JOB_STATUSES = ["starting", "running", "needs_followup", "completed", "failed"] as const;
export type IngestJobStatus = (typeof INGEST_JOB_STATUSES)[number];

export const MEMORY_SCOPES = ["session", "project", "practice", "personal"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const HANDOFF_SCOPES = ["project", "practice", "personal"] as const;
export type HandoffScope = (typeof HANDOFF_SCOPES)[number];

export const MEMORY_CANDIDATE_STATUSES = ["pending", "needs_review", "processed", "rejected"] as const;
export type MemoryCandidateStatus = (typeof MEMORY_CANDIDATE_STATUSES)[number];

export const SESSION_MEMORY_KINDS = ["continuity", "decision", "blocker", "next_action", "verification"] as const;
export type SessionMemoryKind = (typeof SESSION_MEMORY_KINDS)[number];

export const TOMBSTONE_STATES = ["claimed", "output", "no_output", "failed", "unfinished"] as const;
export type TombstoneState = (typeof TOMBSTONE_STATES)[number];

export type IngestJobRow = {
  id: string;
  project_key: string;
  status: IngestJobStatus;
  provider: string;
  provider_session_id: string | null;
  requested_by: string | null;
  input_json: string;
  output_counts_json: string;
  terminal_summary: string | null;
  error_json: string | null;
  followup_state_json: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SessionMemoryRow = {
  id: string;
  project_key: string;
  provider: string | null;
  provider_session_id: string | null;
  ingest_job_id: string | null;
  source_event_refs_json: string;
  memory_kind: SessionMemoryKind;
  title: string | null;
  summary: string;
  payload_json: string;
  confidence: string;
  risk: string;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: passes, because the new file is standalone and exported types are valid.

### Task 2: Add Migration 3

**Files:**
- Modify: `src/memory/migrations.ts`
- Test: `src/memory/db.test.ts`

- [ ] **Step 1: Add migration 3 after migration 2**

Add this migration object to `MIGRATIONS`:

```ts
{
  version: 3,
  sql: `
    CREATE TABLE ingest_jobs (
      id                 TEXT PRIMARY KEY,
      project_key        TEXT NOT NULL,
      status             TEXT NOT NULL CHECK (status IN ('starting', 'running', 'needs_followup', 'completed', 'failed')),
      provider           TEXT NOT NULL,
      provider_session_id TEXT,
      requested_by       TEXT,
      input_json         TEXT NOT NULL,
      output_counts_json TEXT NOT NULL,
      terminal_summary   TEXT,
      error_json         TEXT,
      followup_state_json TEXT,
      started_at         TEXT,
      finished_at        TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
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
      created_at             TEXT NOT NULL,
      updated_at             TEXT NOT NULL
    );
    CREATE INDEX session_memories_project_created ON session_memories(project_key, created_at);
    CREATE INDEX session_memories_project_kind_created ON session_memories(project_key, memory_kind, created_at);

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
```

- [ ] **Step 2: Expand the existing tombstone schema**

In migration 2, replace the `experience_event_tombstones` table with columns that support claim and finalization:

```sql
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
```

Keep the existing unique indexes on `original_event_id` and `dedupe_key`, and update the project-time index to use `claimed_at`:

```sql
CREATE INDEX experience_event_tombstones_project_time ON experience_event_tombstones(project_key, claimed_at);
```

This repository is still pre-release for this schema, so no historical migration from the old tombstone shape is required inside migration 3. The schema change is made inside migration 2 before users have durable v2 production data.

### Task 3: Add Schema Tests

**Files:**
- Modify: `src/memory/db.test.ts`

- [ ] **Step 1: Add a table-existence test**

```ts
test("opening creates ingest, session memory, candidate, handoff, and tombstone schema", () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toContain("ingest_jobs");
    expect(tables.map((row) => row.name)).toContain("session_memories");
    expect(tables.map((row) => row.name)).toContain("memory_candidates");
    expect(tables.map((row) => row.name)).toContain("project_handoff_instructions");
    expect(tables.map((row) => row.name)).toContain("practice_handoff_instructions");
    expect(tables.map((row) => row.name)).toContain("personal_handoff_instructions");

    const tombstoneColumns = db
      .query("PRAGMA table_info(experience_event_tombstones)")
      .all() as Array<{ name: string }>;
    expect(tombstoneColumns.map((column) => column.name)).toEqual([
      "id",
      "original_event_id",
      "dedupe_key",
      "project_key",
      "ingest_job_id",
      "provider",
      "provider_session_id",
      "claimed_at",
      "finalized_at",
      "state",
      "terminal_decision",
      "source_metadata_json",
      "retained_evidence_json",
      "output_references_json",
    ]);
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Run focused schema tests**

Run: `bun test src/memory/db.test.ts`

Expected: passes and confirms migrations are idempotent.

### Task 4: Preserve Existing Tombstone Helper Compatibility

**Files:**
- Modify: `src/memory/experience.ts`
- Test: `src/memory/experience.test.ts`

- [ ] **Step 1: Update the existing terminal helper insert to write the expanded tombstone columns**

In `tombstoneExperienceEvent`, keep the current public behavior but update the insert statement so existing tests keep passing after the schema expansion:

```ts
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
```

Chunk 02 replaces this compatibility insert with scoped claim/finalize helpers. Chunk 01 must only keep the old terminal behavior working against the expanded schema.

## Verification

- Run: `bun test src/memory/db.test.ts`
  - Expected: all migration tests pass.
- Run: `bun test src/memory/experience.test.ts`
  - Expected: existing Experience Log tests pass. Chunk 01 must preserve `tombstoneExperienceEvent` compatibility with the expanded tombstone schema until Chunk 02 replaces it with claim/finalize helpers.
- Run: `bun run typecheck`
  - Expected: passes.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- New SQLite homes exist for ingest jobs, Session Memory, Memory Candidates, and handoff instructions.
- Memory Candidates have first-class `source_event_refs_json` separate from bounded `evidence_json`.
- Tombstone table supports claim/finalize lifecycle.
- Existing manual session tables remain untouched.
- Stored candidate statuses use underscore enum values.

## Risks And Rollback

- Risk: changing migration 2 tombstone shape breaks existing tests. Rollback is to revert this chunk before any later chunk depends on the new tombstone fields.
- Risk: table names drift from spec. Use `src/memory/ingest-types.ts` constants in later chunks instead of duplicating literals.
- Rollback: remove migration 3 and `src/memory/ingest-types.ts`, then restore the prior tombstone schema.

## Non-Goals

- No CLI command registration.
- No provider spawning.
- No row claiming helper.
- No Session Memory or candidate repository behavior beyond schema/type contracts.
- No status/current-briefing integration.

## Type And Name Consistency

Before finalizing this chunk, verify table names, enum values, and type names match `../spec.md`, `../plan.md`, and all later chunk references.
