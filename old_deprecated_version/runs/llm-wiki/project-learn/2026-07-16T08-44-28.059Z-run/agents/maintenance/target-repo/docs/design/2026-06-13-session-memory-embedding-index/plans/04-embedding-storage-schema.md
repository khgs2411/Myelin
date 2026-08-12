# Chunk 04: Embedding Storage Schema

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-embedding-config-contract.md`, `02-sqlite-vec-adapter-and-availability.md`
**Enables:** `05-session-memory-pending-integration.md`, `06-indexer-backfill-command.md`, `07-session-memory-query-facade.md`

## Goal

Add durable embedding metadata storage and repository helpers. Metadata tables must exist even when sqlite-vec is unavailable, and existing `session_memories` rows must become pending for the default active contract without provider calls.

## Source Artifacts

- `../spec.md`: Data / State, Error Handling, Acceptance Criteria
- `../agenda.md`: Question 5
- Code paths: `src/memory/migrations.ts`, `src/memory/db.ts`, `src/memory/db.test.ts`

## Relationships

- **Depends on:** Chunk 01 active contract; Chunk 02 vector adapter.
- **Enables:** pending write integration, indexer/backfill, query facade.
- **Shared contracts:** `session_memory_embeddings` table, deterministic embedding row id, `SessionMemoryEmbeddingRow`, repository helpers.
- **Integration points:** existing migrations and in-memory DB tests.

## File Responsibility Map

**Create:**
- `src/memory/session-memory-embeddings.ts` - repository helpers for metadata rows and vector-table ensure calls.
- `src/memory/session-memory-embeddings.test.ts` - metadata repository tests.

**Modify:**
- `src/memory/migrations.ts` - add migration version 5 for `session_memory_embeddings` and pending rows for existing memories.
- `src/memory/db.test.ts` - verify schema and pending-only upgrade behavior.

## Implementation Tasks

### Task 1: Add Metadata Migration

**Files:**
- Modify: `src/memory/migrations.ts`
- Test: `src/memory/db.test.ts`

- [ ] **Step 1: Add migration tests**

Add expectations that `schema_migrations` contains version 5, `session_memory_embeddings` exists, and opening an old v4 database with existing `session_memories` creates pending metadata rows without provider calls.

Expected row fields:

```ts
expect(row).toMatchObject({
  session_memory_id: "mem_old",
  project_key: "class-kit",
  embedding_provider: "gemini",
  embedding_model: "gemini-embedding-2",
  embedding_dimensions: 1536,
  embedding_purpose: "retrieval_document",
  format_version: 1,
  status: "pending",
});
```

- [ ] **Step 2: Add migration version 5**

Add a migration that creates:

```sql
CREATE TABLE session_memory_embeddings (
  id                       TEXT PRIMARY KEY,
  session_memory_id        TEXT NOT NULL REFERENCES session_memories(id),
  project_key              TEXT NOT NULL,
  embedding_provider       TEXT NOT NULL,
  embedding_model          TEXT NOT NULL,
  embedding_dimensions     INTEGER NOT NULL,
  embedding_purpose        TEXT NOT NULL CHECK (embedding_purpose IN ('retrieval_document', 'retrieval_query')),
  format_version           INTEGER NOT NULL,
  normalized_text_hash     TEXT,
  status                   TEXT NOT NULL CHECK (status IN ('pending', 'indexed', 'failed')),
  failure_reason           TEXT,
  retry_count              INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  indexed_at               TEXT,
  UNIQUE(session_memory_id, embedding_provider, embedding_model, embedding_dimensions, embedding_purpose, format_version)
);
CREATE INDEX session_memory_embeddings_project_status
  ON session_memory_embeddings(project_key, status, updated_at);
CREATE INDEX session_memory_embeddings_memory
  ON session_memory_embeddings(session_memory_id);
```

Use the migration timestamp parameter as `created_at`/`updated_at` when inserting pending rows for existing `session_memories`.

The `id` value is deterministic:

```text
emb_<sha256(session_memory_id|provider|model|dimensions|purpose|formatVersion).slice(0, 24)>
```

Add and use an exported helper:

```ts
export function sessionMemoryEmbeddingId(input: {
  session_memory_id: string;
  contract: ActiveEmbeddingContract;
}): string;
```

Migration version 5 should use `DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT` from Chunk 01 because migrations cannot safely load `myelin.config`.

### Task 2: Add Repository Helpers

**Files:**
- Create: `src/memory/session-memory-embeddings.ts`
- Test: `src/memory/session-memory-embeddings.test.ts`

- [ ] **Step 1: Define row and status types**

Export:

```ts
export type SessionMemoryEmbeddingStatus = "pending" | "indexed" | "failed";

export type SessionMemoryEmbeddingRow = {
  id: string;
  session_memory_id: string;
  project_key: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_purpose: string;
  format_version: number;
  normalized_text_hash: string | null;
  status: SessionMemoryEmbeddingStatus;
  failure_reason: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  indexed_at: string | null;
};
```

- [ ] **Step 2: Implement helper functions**

Implement:

```ts
export function ensurePendingSessionMemoryEmbedding(
  db: Database,
  input: { session_memory_id: string; project_key: string; contract: ActiveEmbeddingContract; now: string },
): SessionMemoryEmbeddingRow;

export function listPendingSessionMemoryEmbeddings(
  db: Database,
  input: { project_key: string; contract: ActiveEmbeddingContract; limit: number; include_failed: boolean },
): SessionMemoryEmbeddingRow[];

export function markSessionMemoryEmbeddingIndexed(
  db: Database,
  input: {
    id: string;
    normalized_text_hash: string;
    now: string;
  },
): SessionMemoryEmbeddingRow;

export function markSessionMemoryEmbeddingFailed(
  db: Database,
  input: {
    id: string;
    failure_reason: string;
    now: string;
  },
): SessionMemoryEmbeddingRow;
```

`ensurePendingSessionMemoryEmbedding` must use `sessionMemoryEmbeddingId` and insert by deterministic id. If the row already exists as `indexed`, it must leave it unchanged unless a later caller explicitly marks it pending because the normalized text hash changed.

`markSessionMemoryEmbeddingIndexed` clears `failure_reason`, preserves `retry_count`, sets `status='indexed'`, stores `normalized_text_hash`, and sets `updated_at` plus `indexed_at`.

`markSessionMemoryEmbeddingFailed` sets `status='failed'`, stores `failure_reason`, increments `retry_count` by 1, updates `updated_at`, and leaves `indexed_at` unchanged.

`listPendingSessionMemoryEmbeddings` selects `pending` rows and, when `include_failed` is true, also `failed` rows. Retry count increments only on a new failed indexing attempt, not when selected for retry.

### Task 3: Connect Vector Table Ensure Helper

- [ ] **Step 1: Add a storage helper that delegates to the sqlite-vec adapter**

Expose a function such as:

```ts
export function ensureSessionMemoryVectorStorage(
  db: Database,
  input: { contract: ActiveEmbeddingContract; adapter?: SqliteVecAdapter },
) {
  return ensureSessionMemoryVectorTable(db, { dimensions: input.contract.dimensions, adapter: input.adapter });
}
```

This keeps metadata creation independent from vector availability.

## Verification

- Run: `rtk bun test src/memory/db.test.ts src/memory/session-memory-embeddings.test.ts`
  - Expected: migration and repository tests pass.
- Run: `rtk bun run typecheck`
  - Expected: exits 0.
- Run: `rtk git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Embedding metadata table exists.
- Existing rows become pending without provider calls.
- Metadata remains available if sqlite-vec cannot load.
- Embedding metadata ids are deterministic and helper signatures are complete.

## Risks And Rollback

- Risk: migration rows use default contract while env overrides may later choose a different active contract. Mitigation: indexer in Chunk 06 must ensure active-contract pending rows before indexing.
- Rollback: schema migrations are forward-only; rollback means restoring DB from backup in real data. Tests should prove idempotence before merge.

## Non-Goals

- No Gemini calls.
- No Session Memory write-path integration.
- No indexer/backfill command.
- No query facade.

## Type And Name Consistency

Use exact table name `session_memory_embeddings` and vector table name `session_memory_vec`.
