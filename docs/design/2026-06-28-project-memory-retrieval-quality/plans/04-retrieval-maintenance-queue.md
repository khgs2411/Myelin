# Chunk 04: Retrieval Maintenance Queue

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `03-retrieval-storage-and-vector-state.md`  
**Enables:** `05-indexer-and-status-command.md`, `08-hint-generation-flow.md`, `09-project-learn-lifecycle-and-dogfood.md`

## Goal

Add a dedicated retrieval-maintenance queue for Project Memory serving-state work such as hint refresh, index repair, poor retrieval feedback, and missing expected hits. This queue must stay separate from canonical Project Memory candidates.

## Source Artifacts

- `../spec.md`: Usage-driven semantic usefulness and retrieval-maintenance queue
- `../agenda.md`: Question 7 retrieval hint refresh signal ownership
- `../pseudocode/RetrievalMaintenanceQueue.ts`
- `../pseudocode/ProjectMemoryHintGenerationFlow.md`
- `../../../../CONTEXT.md`: Retrieval Maintenance Queue
- `../../../../docs/adr/0061-use-layer-shaped-runtime-inbox-with-implemented-consumers.md`
- `../../../../docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`
- `../../../../src/memory/migrations.ts`
- `../../../../src/memory/candidates.ts`
- `../../../../tests/memory/candidates.test.ts`

## Relationships

- **Depends on:** migration discipline from chunk 3.
- **Enables:** hint generation and index repair processors can consume queue rows without creating Project Memory candidates.
- **Shared contracts:** `retrieval_maintenance_queue` table, `RetrievalMaintenanceQueueRow`, queue status/kind vocabularies.
- **Integration points:** future query feedback producers, hint generation, indexer repair status.

## File Responsibility Map

**Create:**

- `src/memory/retrieval-maintenance-queue.ts` - queue row type and create/list/mark service functions.
- `tests/memory/retrieval-maintenance-queue.test.ts` - verifies dedupe, status transitions, and separation from `memory_candidates`.

**Modify:**

- `src/memory/migrations.ts` - add retrieval maintenance queue table and indexes.

**Test:**

- `tests/memory/retrieval-maintenance-queue.test.ts`

## Implementation Tasks

### Task 1: Add queue migration and tests

**Files:**

- Modify: `src/memory/migrations.ts`
- Create: `tests/memory/retrieval-maintenance-queue.test.ts`

- [ ] **Step 1: Write queue tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { listMemoryCandidates } from "../../src/memory/candidates.ts";
import {
  createRetrievalMaintenanceFeedbackItem,
  createRetrievalMaintenanceStructuralRepairItem,
  listPendingRetrievalMaintenanceItems,
  markRetrievalMaintenanceFailed,
  markRetrievalMaintenanceProcessed,
} from "../../src/memory/retrieval-maintenance-queue.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
});

afterEach(() => {
  db.close();
});

test("creates deduped poor retrieval feedback without memory candidates", () => {
  const first = createRetrievalMaintenanceFeedbackItem(db, {
    project_key: "demo",
    kind: "poor_retrieval_feedback",
    query_context: { question: "How does ranking work?", selected_hits: [] },
    feedback: { rating: "missed", expected_ref: "wiki/architecture/ranking.md#ranking" },
    wiki_refs: ["wiki/architecture/ranking.md#ranking"],
    reason: "Expected ranking memory was missing from retrieval hits.",
    created_by: "cli_query",
    now: "2026-06-28T10:00:00.000Z",
  });
  const second = createRetrievalMaintenanceFeedbackItem(db, {
    project_key: "demo",
    kind: "poor_retrieval_feedback",
    query_context: { question: "How does ranking work?", selected_hits: [] },
    feedback: { rating: "missed", expected_ref: "wiki/architecture/ranking.md#ranking" },
    wiki_refs: ["wiki/architecture/ranking.md#ranking"],
    reason: "Expected ranking memory was missing from retrieval hits.",
    created_by: "cli_query",
    now: "2026-06-28T10:01:00.000Z",
  });

  expect(second.id).toBe(first.id);
  expect(listPendingRetrievalMaintenanceItems(db, { project_key: "demo", limit: 10 })).toHaveLength(1);
  expect(listMemoryCandidates(db, { project_key: "demo", scope: "project", status: "pending" })).toEqual([]);
});

test("creates structural repair rows and marks terminal states", () => {
  const row = createRetrievalMaintenanceStructuralRepairItem(db, {
    project_key: "demo",
    kind: "index_repair",
    wiki_refs: ["wiki/index.md#demo"],
    reason: "section hash changed",
    created_by: "project_learn",
    now: "2026-06-28T10:00:00.000Z",
  });

  expect(row.status).toBe("pending");
  expect(markRetrievalMaintenanceFailed(db, {
    id: row.id,
    failure_reason: "provider unavailable",
    now: "2026-06-28T10:01:00.000Z",
  }).status).toBe("failed");
  expect(markRetrievalMaintenanceProcessed(db, {
    id: row.id,
    now: "2026-06-28T10:02:00.000Z",
  }).status).toBe("processed");
});
```

- [ ] **Step 2: Run the focused queue test**

Run: `rtk bun test tests/memory/retrieval-maintenance-queue.test.ts`  
Expected: fails because the queue module and migration do not exist yet.

### Task 2: Add migration and queue service

**Files:**

- Modify: `src/memory/migrations.ts`
- Create: `src/memory/retrieval-maintenance-queue.ts`

- [ ] **Step 1: Add queue migration**

Use the next migration version after chunk 3.

```ts
{
  version: 10,
  sql: `
    CREATE TABLE retrieval_maintenance_queue (
      id                  TEXT PRIMARY KEY,
      project_key         TEXT NOT NULL,
      status              TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'processed', 'rejected', 'failed')),
      kind                TEXT NOT NULL CHECK (kind IN ('hint_refresh', 'index_repair', 'poor_retrieval_feedback', 'missing_expected_hit')),
      target_layer        TEXT NOT NULL CHECK (target_layer = 'project'),
      wiki_refs_json      TEXT NOT NULL,
      query_context_json  TEXT NOT NULL,
      feedback_json       TEXT NOT NULL,
      reason              TEXT NOT NULL,
      dedupe_key          TEXT NOT NULL,
      created_by          TEXT NOT NULL CHECK (created_by IN ('mcp_query', 'cli_query', 'project_learn', 'operator')),
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL,
      processed_at        TEXT,
      failure_reason      TEXT
    );
    CREATE UNIQUE INDEX retrieval_maintenance_queue_pending_dedupe
      ON retrieval_maintenance_queue(project_key, dedupe_key)
      WHERE status IN ('pending', 'claimed', 'failed');
    CREATE INDEX retrieval_maintenance_queue_project_status
      ON retrieval_maintenance_queue(project_key, status, created_at);
    CREATE INDEX retrieval_maintenance_queue_project_kind_status
      ON retrieval_maintenance_queue(project_key, kind, status, created_at);
  `,
}
```

- [ ] **Step 2: Implement queue service**

```ts
import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";

export type RetrievalMaintenanceQueueStatus = "pending" | "claimed" | "processed" | "rejected" | "failed";
export type RetrievalMaintenanceKind = "hint_refresh" | "index_repair" | "poor_retrieval_feedback" | "missing_expected_hit";
export type RetrievalMaintenanceCreatedBy = "mcp_query" | "cli_query" | "project_learn" | "operator";

export type RetrievalMaintenanceQueueRow = {
  id: string;
  project_key: string;
  status: RetrievalMaintenanceQueueStatus;
  kind: RetrievalMaintenanceKind;
  target_layer: "project";
  wiki_refs_json: string;
  query_context_json: string;
  feedback_json: string;
  reason: string;
  dedupe_key: string;
  created_by: RetrievalMaintenanceCreatedBy;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
  failure_reason: string | null;
};
```

Implement:

```ts
export function createRetrievalMaintenanceFeedbackItem(db: Database, input: {
  project_key: string;
  kind: "poor_retrieval_feedback" | "missing_expected_hit";
  wiki_refs: string[];
  query_context: Record<string, unknown>;
  feedback: Record<string, unknown>;
  reason: string;
  created_by: RetrievalMaintenanceCreatedBy;
  now: string;
}): RetrievalMaintenanceQueueRow;

export function createRetrievalMaintenanceStructuralRepairItem(db: Database, input: {
  project_key: string;
  kind: "hint_refresh" | "index_repair";
  wiki_refs: string[];
  reason: string;
  created_by: "project_learn" | "operator";
  now: string;
}): RetrievalMaintenanceQueueRow;

export function listPendingRetrievalMaintenanceItems(db: Database, input: {
  project_key: string;
  kind?: RetrievalMaintenanceKind;
  limit: number;
}): RetrievalMaintenanceQueueRow[];
```

Use a stable id and dedupe key:

```ts
function queueId(input: { project_key: string; dedupe_key: string }): string {
  return `rmq_${sha256(`${input.project_key}|${input.dedupe_key}`).slice(0, 24)}`;
}

function dedupeKey(input: {
  kind: RetrievalMaintenanceKind;
  wiki_refs: string[];
  query_context?: Record<string, unknown>;
  feedback?: Record<string, unknown>;
}): string {
  return sha256(JSON.stringify({
    kind: input.kind,
    wiki_refs: [...input.wiki_refs].sort(),
    query_context: input.query_context ?? {},
    feedback: input.feedback ?? {},
  }));
}
```

- [ ] **Step 3: Run queue tests**

Run: `rtk bun test tests/memory/retrieval-maintenance-queue.test.ts`  
Expected: passes.

## Verification

- `rtk bun test tests/memory/retrieval-maintenance-queue.test.ts`  
  Expected: passes.
- `rtk bun run typecheck`  
  Expected: passes.

## Acceptance Criteria Covered

- Poor retrieval feedback and index/hint repair have a dedicated queue.
- Queue rows are not Project Memory candidates.
- Queue rows preserve query context, wiki refs, feedback, reason, and creator.
- Pending duplicates collapse while preserving terminal rows for diagnostics.

## Risks And Rollback

- Risk: dedupe key may collapse distinct feedback too aggressively. Mitigation: include kind, sorted refs, query context, and feedback payload.
- Risk: queue processing scope expands into hint generation. Mitigation: this chunk only creates queue state and service functions.
- Rollback: stop using the queue service and leave derived rows inert; no canonical memory is affected.

## Non-Goals

- No query/MCP feedback integration.
- No hint-generation processor.
- No index repair processor.
- No Project Memory candidate changes.

## Type And Name Consistency

Verify these names are exact:

- `retrieval_maintenance_queue`
- `RetrievalMaintenanceQueueRow`
- `createRetrievalMaintenanceFeedbackItem`
- `createRetrievalMaintenanceStructuralRepairItem`
- `listPendingRetrievalMaintenanceItems`
- `markRetrievalMaintenanceProcessed`
- `markRetrievalMaintenanceFailed`
