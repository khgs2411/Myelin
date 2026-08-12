# Chunk 03: Retrieval Storage And Vector State

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Completed  
**Depends on:** `01-retrieval-contracts-and-run-status.md`, `02-markdown-section-manifest.md`  
**Enables:** `04-retrieval-maintenance-queue.md`, `05-indexer-and-status-command.md`, `06-lookup-and-packet-quality.md`, `09-project-learn-lifecycle-and-dogfood.md`

## Goal

Add Project Memory retrieval metadata and vector storage as rebuildable serving state in root `state/memory.db`. This chunk creates migrations, storage helpers, vector adapter functions, and tests, but does not run indexing or change packet lookup behavior.

## Source Artifacts

- `../spec.md`: Storage target shape and freshness rules
- `../agenda.md`: retrieval rows are rebuildable serving state
- `../pseudocode/ProjectMemoryRetrievalStorage.ts`
- `../pseudocode/ProjectMemoryRetrievalIndexerFlow.md`
- `../../../../docs/adr/0057-vendor-sqlite-runtime-for-vector-extensions.md`
- `../../../../docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`
- `../../../../src/memory/db.ts`
- `../../../../src/memory/migrations.ts`
- `../../../../src/memory/session-memory-embeddings.ts`
- `../../../../src/memory/sqlite-vec.ts`
- `../../../../tests/memory/session-memory-embeddings.test.ts`
- `../../../../tests/memory/sqlite-vec.test.ts`

## Relationships

- **Depends on:** canonical section refs and retrieval contract names from chunks 1 and 2.
- **Enables:** indexer can create pending rows and upsert vectors; lookup can search Project Memory vectors; maintenance queue can share migration versioning.
- **Shared contracts:** `project_memory_retrieval_embeddings`, `project_memory_section_vec`, `ProjectMemoryRetrievalStorage`, Project Memory vector input/search result types.
- **Integration points:** migrations, `openMemoryDb`, sqlite-vec adapter, embedding contract selection.

## File Responsibility Map

**Create:**

- `src/memory/project-memory-retrieval-storage.ts` - metadata row ids, pending/indexed/failed/stale/orphaned state transitions, counts, pending listing.
- `tests/memory/project-memory-retrieval-storage.test.ts` - storage row lifecycle and idempotency tests.

**Modify:**

- `src/memory/migrations.ts` - add migration for Project Memory retrieval embedding metadata table.
- `src/memory/sqlite-vec.ts` - add Project Memory vector table ensure/upsert/search helpers while preserving Session Memory helpers.
- `tests/memory/sqlite-vec.test.ts` - add Project Memory vector table tests with sqlite-vec availability guard.

**Test:**

- `tests/memory/project-memory-retrieval-storage.test.ts`
- `tests/memory/sqlite-vec.test.ts`
- `tests/memory/db.test.ts` if migration coverage is centralized there.

## Implementation Tasks

### Task 1: Add migration and storage tests

**Files:**

- Modify: `src/memory/migrations.ts`
- Create: `tests/memory/project-memory-retrieval-storage.test.ts`

- [ ] **Step 1: Write storage lifecycle tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  ensurePendingProjectMemoryRetrievalEmbedding,
  getProjectMemoryRetrievalEmbedding,
  listPendingProjectMemoryRetrievalEmbeddings,
  markProjectMemoryRetrievalEmbeddingFailed,
  markProjectMemoryRetrievalEmbeddingIndexed,
  projectMemoryRetrievalEmbeddingId,
} from "../../src/memory/project-memory-retrieval-storage.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
});

afterEach(() => {
  db.close();
});

test("creates deterministic pending Project Memory retrieval rows", () => {
  const row = ensurePendingProjectMemoryRetrievalEmbedding(db, {
    project_key: "demo",
    wiki_path: "wiki/architecture/ranking.md",
    section_id: "ranking/proposal-ranking",
    section_hash: "sha256:section",
    hint_hash: "sha256:hint",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-28T10:00:00.000Z",
  });

  expect(row.id).toBe(
    projectMemoryRetrievalEmbeddingId({
      project_key: "demo",
      wiki_path: "wiki/architecture/ranking.md",
      section_id: "ranking/proposal-ranking",
      section_hash: "sha256:section",
      hint_hash: "sha256:hint",
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    }),
  );
  expect(row.status).toBe("pending");
});

test("keeps indexed row when section, hint, and embedding contract are unchanged", () => {
  const row = ensurePendingProjectMemoryRetrievalEmbedding(db, {
    project_key: "demo",
    wiki_path: "wiki/index.md",
    section_id: "demo",
    section_hash: "sha256:section",
    hint_hash: null,
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-28T10:00:00.000Z",
  });
  markProjectMemoryRetrievalEmbeddingIndexed(db, {
    id: row.id,
    normalized_text_hash: "sha256:text",
    now: "2026-06-28T10:01:00.000Z",
  });

  const again = ensurePendingProjectMemoryRetrievalEmbedding(db, {
    project_key: "demo",
    wiki_path: "wiki/index.md",
    section_id: "demo",
    section_hash: "sha256:section",
    hint_hash: null,
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-28T10:02:00.000Z",
  });

  expect(again.status).toBe("indexed");
  expect(again.normalized_text_hash).toBe("sha256:text");
});

test("lists failed rows only when retry is requested", () => {
  const row = ensurePendingProjectMemoryRetrievalEmbedding(db, {
    project_key: "demo",
    wiki_path: "wiki/index.md",
    section_id: "demo",
    section_hash: "sha256:section",
    hint_hash: null,
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    now: "2026-06-28T10:00:00.000Z",
  });
  markProjectMemoryRetrievalEmbeddingFailed(db, {
    id: row.id,
    failure_reason: "sqlite-vec unavailable",
    now: "2026-06-28T10:01:00.000Z",
  });

  expect(
    listPendingProjectMemoryRetrievalEmbeddings(db, {
      project_key: "demo",
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      limit: 10,
    }),
  ).toEqual([]);
  expect(
    listPendingProjectMemoryRetrievalEmbeddings(db, {
      project_key: "demo",
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      limit: 10,
      include_failed: true,
    }).map((item) => item.id),
  ).toEqual([row.id]);
  expect(getProjectMemoryRetrievalEmbedding(db, row.id).retry_count).toBe(1);
});
```

- [ ] **Step 2: Run focused storage test**

Run: `rtk bun test tests/memory/project-memory-retrieval-storage.test.ts`  
Expected: fails because storage module and migration do not exist yet.

### Task 2: Add migration and storage module

**Files:**

- Modify: `src/memory/migrations.ts`
- Create: `src/memory/project-memory-retrieval-storage.ts`

- [ ] **Step 1: Add migration version after the current latest migration**

Use the next integer migration version. The SQL must keep Project Memory rows independent from Session Memory rows.

```ts
{
  version: 9,
  sql: `
    CREATE TABLE project_memory_retrieval_embeddings (
      id                    TEXT PRIMARY KEY,
      project_key           TEXT NOT NULL,
      wiki_path             TEXT NOT NULL,
      section_id            TEXT NOT NULL,
      section_hash          TEXT NOT NULL,
      hint_hash             TEXT,
      embedding_provider    TEXT NOT NULL,
      embedding_model       TEXT NOT NULL,
      embedding_dimensions  INTEGER NOT NULL,
      embedding_purpose     TEXT NOT NULL CHECK (embedding_purpose IN ('retrieval_document')),
      format_version        INTEGER NOT NULL,
      normalized_text_hash  TEXT,
      status                TEXT NOT NULL CHECK (status IN ('pending', 'indexed', 'failed', 'stale', 'orphaned')),
      failure_reason        TEXT,
      retry_count           INTEGER NOT NULL DEFAULT 0,
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL,
      indexed_at            TEXT,
      UNIQUE (
        project_key,
        wiki_path,
        section_id,
        section_hash,
        COALESCE(hint_hash, ''),
        embedding_provider,
        embedding_model,
        embedding_dimensions,
        embedding_purpose,
        format_version
      )
    );
    CREATE INDEX project_memory_retrieval_embeddings_project_status
      ON project_memory_retrieval_embeddings(project_key, status, updated_at);
    CREATE INDEX project_memory_retrieval_embeddings_project_section
      ON project_memory_retrieval_embeddings(project_key, wiki_path, section_id);
  `,
}
```

If SQLite rejects `COALESCE` in a `UNIQUE` constraint for the local runtime, use a separate `hint_hash_key TEXT NOT NULL` column populated with `hint_hash ?? ""`. Record that concrete choice in the chunk execution notes.

- [ ] **Step 2: Implement storage module**

Use this exported surface.

```ts
import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";

export type ProjectMemoryRetrievalRowStatus = "pending" | "indexed" | "failed" | "stale" | "orphaned";

export type ProjectMemoryRetrievalEmbeddingRow = {
  id: string;
  project_key: string;
  wiki_path: string;
  section_id: string;
  section_hash: string;
  hint_hash: string | null;
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_purpose: "retrieval_document";
  format_version: number;
  normalized_text_hash: string | null;
  status: ProjectMemoryRetrievalRowStatus;
  failure_reason: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  indexed_at: string | null;
};

export function projectMemoryRetrievalEmbeddingId(input: {
  project_key: string;
  wiki_path: string;
  section_id: string;
  section_hash: string;
  hint_hash: string | null;
  contract: ActiveEmbeddingContract;
}): string {
  const hash = createHash("sha256")
    .update([
      input.project_key,
      input.wiki_path,
      input.section_id,
      input.section_hash,
      input.hint_hash ?? "",
      input.contract.provider,
      input.contract.model,
      input.contract.dimensions,
      "retrieval_document",
      input.contract.formatVersion,
    ].join("|"))
    .digest("hex")
    .slice(0, 24);
  return `pmr_${hash}`;
}
```

Implement these functions with the same behavior as Session Memory storage, adapted to markdown refs:

```ts
export function ensurePendingProjectMemoryRetrievalEmbedding(db: Database, input: {
  project_key: string;
  wiki_path: string;
  section_id: string;
  section_hash: string;
  hint_hash: string | null;
  contract: ActiveEmbeddingContract;
  now: string;
}): ProjectMemoryRetrievalEmbeddingRow;

export function listPendingProjectMemoryRetrievalEmbeddings(db: Database, input: {
  project_key: string;
  contract: ActiveEmbeddingContract;
  limit: number;
  include_failed?: boolean;
}): ProjectMemoryRetrievalEmbeddingRow[];

export function markProjectMemoryRetrievalEmbeddingIndexed(db: Database, input: {
  id: string;
  normalized_text_hash: string;
  now: string;
}): ProjectMemoryRetrievalEmbeddingRow;

export function markProjectMemoryRetrievalEmbeddingFailed(db: Database, input: {
  id: string;
  failure_reason: string;
  now: string;
}): ProjectMemoryRetrievalEmbeddingRow;

export function markProjectMemoryRetrievalEmbeddingStaleOrOrphaned(db: Database, input: {
  id: string;
  status: "stale" | "orphaned";
  failure_reason: string;
  now: string;
}): ProjectMemoryRetrievalEmbeddingRow;
```

- [ ] **Step 3: Run storage tests**

Run: `rtk bun test tests/memory/project-memory-retrieval-storage.test.ts`  
Expected: passes.

### Task 3: Add Project Memory vector helpers

**Files:**

- Modify: `src/memory/sqlite-vec.ts`
- Test: `tests/memory/sqlite-vec.test.ts`

- [ ] **Step 1: Add vector helper tests**

Add a test guarded like the existing live vector operation assertion.

```ts
import {
  ensureProjectMemoryRetrievalVectorTable,
  searchProjectMemoryRetrievalVectors,
  upsertProjectMemoryRetrievalVector,
} from "../../src/memory/sqlite-vec.ts";

test("Project Memory vector operations are project and section scoped when sqlite-vec is available", () => {
  const db = openMemoryDbAt(":memory:");
  try {
    const created = ensureProjectMemoryRetrievalVectorTable(db, { dimensions: 3 });
    if (!created.available) {
      console.warn(`sqlite-vec unavailable, skipping Project Memory vector assertion: ${created.reason}`);
      return;
    }
    upsertProjectMemoryRetrievalVector(db, {
      retrieval_row_id: "pmr_1",
      project_key: "demo",
      wiki_path: "wiki/index.md",
      section_id: "demo",
      embedding_model: "stub",
      embedding_dimensions: 3,
      embedding_purpose: "retrieval_document",
      format_version: 1,
      embedding: [0.1, 0.2, 0.3],
    });
    expect(searchProjectMemoryRetrievalVectors(db, {
      project_key: "demo",
      embedding_model: "stub",
      embedding_dimensions: 3,
      embedding_purpose: "retrieval_document",
      format_version: 1,
      embedding: [0.1, 0.2, 0.3],
      limit: 1,
    })[0]?.retrieval_row_id).toBe("pmr_1");
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Implement vector helpers**

Add Project Memory-specific types and helpers. Keep Session Memory functions unchanged.

```ts
export type ProjectMemoryRetrievalVectorInput = {
  retrieval_row_id: string;
  project_key: string;
  wiki_path: string;
  section_id: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_purpose: "retrieval_document";
  format_version: number;
  embedding: number[];
};

export type ProjectMemoryRetrievalVectorMatch = {
  retrieval_row_id: string;
  distance: number;
};
```

Create table:

```ts
export function ensureProjectMemoryRetrievalVectorTable(
  db: Database,
  input: { dimensions: number; adapter?: SqliteVecAdapter },
): { created: boolean; available: boolean; reason?: string } {
  const availability = getSqliteVecAvailability(db, input.adapter);
  if (!availability.available) return { created: false, available: false, reason: availability.reason };
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS project_memory_section_vec USING vec0(
      embedding float[${input.dimensions}],
      retrieval_row_id TEXT,
      project_key TEXT partition key,
      wiki_path TEXT,
      section_id TEXT,
      embedding_model TEXT,
      embedding_dimensions INTEGER,
      embedding_purpose TEXT,
      format_version INTEGER
    );`,
  );
  return { created: true, available: true };
}
```

Implement upsert/search using the same delete-then-insert pattern as Session Memory, keyed by `retrieval_row_id`, project, model, dimensions, purpose, and format version.

- [ ] **Step 3: Run vector tests**

Run: `rtk bun test tests/memory/sqlite-vec.test.ts`  
Expected: passes. If sqlite-vec is unavailable locally, the live vector assertion logs a skip message and the test still passes.

## Verification

- `rtk bun test tests/memory/project-memory-retrieval-storage.test.ts`  
  Expected: passes.
- `rtk bun test tests/memory/sqlite-vec.test.ts`  
  Expected: passes, with sqlite-vec live assertion skipped only when unavailable.
- `rtk bun run typecheck`  
  Expected: passes.

## Acceptance Criteria Covered

- Project Memory retrieval metadata rows live in SQLite as derived serving state.
- Project Memory vector rows are separate from Session Memory vector rows.
- Rows are keyed by project, wiki path, section id, section hash, hint hash, and embedding contract.
- Stale/orphaned/failed statuses are preserved for diagnostics instead of deleting canonical memory.

## Risks And Rollback

- Risk: migration syntax differs across SQLite builds. Mitigation: use a simple schema compatible with Bun SQLite; if expression indexes are needed, prefer explicit columns.
- Risk: vector table dimensions are global per table. Mitigation: mirror existing Session Memory helper behavior and ensure active contract dimensions are used consistently.
- Rollback: remove migration before it ships or add a later migration to stop using the tables. Since rows are derived, data loss in these tables does not delete canonical Project Memory.

## Non-Goals

- No indexer command.
- No embedding provider calls.
- No lookup integration.
- No hint-generation flow.
- No retrieval-maintenance queue behavior.

## Type And Name Consistency

Verify these names are exact:

- `project_memory_retrieval_embeddings`
- `project_memory_section_vec`
- `ProjectMemoryRetrievalEmbeddingRow`
- `ensurePendingProjectMemoryRetrievalEmbedding`
- `listPendingProjectMemoryRetrievalEmbeddings`
- `ensureProjectMemoryRetrievalVectorTable`
- `upsertProjectMemoryRetrievalVector`
- `searchProjectMemoryRetrievalVectors`

## Execution Notes

### 2026-06-28: Accepted Local Drift

- **Plan difference:** The draft migration showed a table-level `UNIQUE` constraint using `COALESCE(hint_hash, '')`.
- **Current code reality:** SQLite table constraints do not accept expressions in this position, so the migration uses an explicit `hint_hash_key TEXT NOT NULL` column populated from `hint_hash ?? ""`.
- **Reason accepted:** The plan named this compatibility mitigation, and the resulting uniqueness semantics are equivalent for nullable hint hashes.
- **Implementation impact:** `src/memory/migrations.ts` migration 9 and `src/memory/project-memory-retrieval-storage.ts` write/read `hint_hash_key`.
- **Verification evidence:** `rtk bun test tests/memory/project-memory-retrieval-storage.test.ts`, `rtk bun test tests/memory/sqlite-vec.test.ts`, `rtk bun test tests/memory/db.test.ts`, and `rtk bun run typecheck` passed.
