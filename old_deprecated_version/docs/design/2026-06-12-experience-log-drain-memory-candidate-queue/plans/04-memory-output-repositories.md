# Chunk 04: Memory Output Repositories

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-storage-schema-contracts.md`
**Enables:** `05-ingest-agent-orchestration.md`, `06-operator-cli-surfaces.md`

## Goal

Implement typed repository helpers for trusted Session Memory, Memory Candidates, and Project/Practice/Personal handoff instructions. These helpers are the only write surface later chunks should use for agent outputs; they normalize candidate status aliases and keep handoff queues separate from Memory Candidates.

## Source Artifacts

- `../spec.md`: Candidate Queue, Direct Session Memory Storage, Layer Handoff Model, Retention Boundary For Derived Inputs, Session Memory Trust Boundary
- `../agenda.md`: Questions 10, 11, 14, 15, 16, 17
- `src/memory/ingest-types.ts` from Chunk 01
- `src/memory/db.ts`

## Relationships

- **Depends on:** Chunk 01 tables and enum constants.
- **Enables:** Chunk 05 agent orchestration can write outputs without knowing table details; Chunk 06 can list/show candidates.
- **Shared contracts:** `createSessionMemory`, `createMemoryCandidate`, `normalizeCandidateStatus`, `listMemoryCandidates`, `getMemoryCandidate`, `createHandoffInstruction`.
- **Integration points:** no direct integration with `sessions` / `session_events`.

## File Responsibility Map

**Create:**
- `src/memory/session-memories.ts` - trusted Session Memory write/list helpers.
- `src/memory/candidates.ts` - candidate status normalization, create/list/get helpers.
- `src/memory/handoffs.ts` - layer-specific handoff creation helpers backed by shared insert logic.
- `src/memory/session-memories.test.ts`
- `src/memory/candidates.test.ts`
- `src/memory/handoffs.test.ts`

**Modify:**
- None unless imports require formatting in existing tests.

**Test:**
- New test files verify repository behavior and status normalization.

## Implementation Tasks

### Task 1: Implement Session Memory Repository

**Files:**
- Create: `src/memory/session-memories.ts`
- Test: `src/memory/session-memories.test.ts`

- [ ] **Step 1: Add `createSessionMemory` and list helper**

```ts
import type { Database } from "bun:sqlite";
import type { SessionMemoryKind, SessionMemoryRow } from "./ingest-types.ts";

export type CreateSessionMemoryInput = {
  id: string;
  project_key: string;
  provider?: string | null;
  provider_session_id?: string | null;
  ingest_job_id?: string | null;
  source_event_refs: string[];
  memory_kind: SessionMemoryKind;
  title?: string | null;
  summary: string;
  payload: Record<string, unknown>;
  confidence: string;
  risk: string;
  now: string;
};

export function createSessionMemory(db: Database, input: CreateSessionMemoryInput): SessionMemoryRow {
  db.query(
    `INSERT INTO session_memories
      (id, project_key, provider, provider_session_id, ingest_job_id, source_event_refs_json,
       memory_kind, title, summary, payload_json, confidence, risk, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.project_key,
    input.provider ?? null,
    input.provider_session_id ?? null,
    input.ingest_job_id ?? null,
    JSON.stringify(input.source_event_refs),
    input.memory_kind,
    input.title ?? null,
    input.summary,
    JSON.stringify(input.payload),
    input.confidence,
    input.risk,
    input.now,
    input.now,
  );
  return db.query("SELECT * FROM session_memories WHERE id = ?").get(input.id) as SessionMemoryRow;
}

export function listSessionMemories(db: Database, projectKey: string, limit = 20): SessionMemoryRow[] {
  return db
    .query("SELECT * FROM session_memories WHERE project_key = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(projectKey, limit) as SessionMemoryRow[];
}
```

- [ ] **Step 2: Add repository test**

```ts
test("creates trusted session memory separate from manual session tables", () => {
  const row = createSessionMemory(db, {
    id: "mem_1",
    project_key: "class-kit",
    ingest_job_id: "job_1",
    source_event_refs: ["tomb_1"],
    memory_kind: "decision",
    summary: "Decided to keep auth open for local demo.",
    payload: { source: "ingest" },
    confidence: "high",
    risk: "low",
    now: "2026-06-13T10:00:00.000Z",
  });

  expect(row.id).toBe("mem_1");
  expect(listSessionMemories(db, "class-kit").map((item) => item.id)).toEqual(["mem_1"]);
});
```

### Task 2: Implement Candidate Repository

**Files:**
- Create: `src/memory/candidates.ts`
- Test: `src/memory/candidates.test.ts`

- [ ] **Step 1: Add status normalization and candidate helpers**

```ts
import type { Database } from "bun:sqlite";
import type { MemoryCandidateStatus, MemoryScope } from "./ingest-types.ts";

export type MemoryCandidateRow = {
  id: string;
  project_key: string;
  scope: MemoryScope;
  status: MemoryCandidateStatus;
  candidate_type: string;
  title: string | null;
  summary: string;
  source_event_refs_json: string;
  evidence_json: string;
  proposed_payload_json: string;
  confidence: string;
  risk: string;
  reason: string;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
};

export function normalizeCandidateStatus(input: string): MemoryCandidateStatus {
  const normalized = input.replace(/-/g, "_");
  if (normalized === "pending" || normalized === "needs_review" || normalized === "processed" || normalized === "rejected") {
    return normalized;
  }
  throw new Error(`Unknown candidate status: ${input}`);
}

export function createMemoryCandidate(
  db: Database,
  input: {
    id: string;
    project_key: string;
    scope: MemoryScope;
    status: MemoryCandidateStatus;
    candidate_type: string;
    title?: string | null;
    summary: string;
    source_event_refs: string[];
    evidence: Record<string, unknown>;
    proposed_payload: Record<string, unknown>;
    confidence: string;
    risk: string;
    reason: string;
    now: string;
  },
): MemoryCandidateRow {
  db.query(
    `INSERT INTO memory_candidates
      (id, project_key, scope, status, candidate_type, title, summary, source_event_refs_json,
       evidence_json, proposed_payload_json, confidence, risk, reason, created_at, updated_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    input.id,
    input.project_key,
    input.scope,
    input.status,
    input.candidate_type,
    input.title ?? null,
    input.summary,
    JSON.stringify(input.source_event_refs),
    JSON.stringify(input.evidence),
    JSON.stringify(input.proposed_payload),
    input.confidence,
    input.risk,
    input.reason,
    input.now,
    input.now,
  );
  return getMemoryCandidate(db, input.id) as MemoryCandidateRow;
}

export function getMemoryCandidate(db: Database, id: string): MemoryCandidateRow | null {
  return (db.query("SELECT * FROM memory_candidates WHERE id = ?").get(id) as MemoryCandidateRow | null) ?? null;
}

export function listMemoryCandidates(
  db: Database,
  input: { project_key: string; status?: string; scope?: MemoryScope },
): MemoryCandidateRow[] {
  const status = input.status ? normalizeCandidateStatus(input.status) : null;
  if (status && input.scope) {
    return db
      .query("SELECT * FROM memory_candidates WHERE project_key = ? AND status = ? AND scope = ? ORDER BY created_at DESC, id DESC")
      .all(input.project_key, status, input.scope) as MemoryCandidateRow[];
  }
  if (status) {
    return db
      .query("SELECT * FROM memory_candidates WHERE project_key = ? AND status = ? ORDER BY created_at DESC, id DESC")
      .all(input.project_key, status) as MemoryCandidateRow[];
  }
  return db
    .query("SELECT * FROM memory_candidates WHERE project_key = ? ORDER BY created_at DESC, id DESC")
    .all(input.project_key) as MemoryCandidateRow[];
}
```

- [ ] **Step 2: Add candidate tests**

```ts
test("normalizes hyphenated candidate status aliases", () => {
  expect(normalizeCandidateStatus("needs-review")).toBe("needs_review");
  expect(normalizeCandidateStatus("needs_review")).toBe("needs_review");
});

test("creates and lists memory candidates by stored status", () => {
  createMemoryCandidate(db, {
    id: "cand_1",
    project_key: "class-kit",
    scope: "session",
    status: "needs_review",
    candidate_type: "session.continuity",
    summary: "Possible risky session summary.",
    source_event_refs: ["tomb_1"],
    evidence: { tombstones: ["tomb_1"] },
    proposed_payload: { summary: "Possible risky session summary." },
    confidence: "medium",
    risk: "medium",
    reason: "Conflicting evidence",
    now: "2026-06-13T10:00:00.000Z",
  });

  expect(listMemoryCandidates(db, { project_key: "class-kit", status: "needs-review" }).map((row) => row.status)).toEqual([
    "needs_review",
  ]);
  expect(JSON.parse(getMemoryCandidate(db, "cand_1")?.source_event_refs_json ?? "[]")).toEqual(["tomb_1"]);
});
```

### Task 3: Implement Handoff Repository

**Files:**
- Create: `src/memory/handoffs.ts`
- Test: `src/memory/handoffs.test.ts`

- [ ] **Step 1: Add layer-specific handoff creation**

```ts
import type { Database } from "bun:sqlite";
import type { HandoffScope, MemoryCandidateStatus } from "./ingest-types.ts";

const HANDOFF_TABLES: Record<HandoffScope, string> = {
  project: "project_handoff_instructions",
  practice: "practice_handoff_instructions",
  personal: "personal_handoff_instructions",
};

export function createHandoffInstruction(
  db: Database,
  input: {
    id: string;
    target_scope: HandoffScope;
    project_key: string;
    status: MemoryCandidateStatus;
    objective: string;
    prompt_text: string;
    source_session_memory_ids: string[];
    source_event_refs: string[];
    suggested_actions: string[];
    reason: string;
    confidence: string;
    risk: string;
    now: string;
  },
): void {
  const table = HANDOFF_TABLES[input.target_scope];
  db.query(
    `INSERT INTO ${table}
      (id, project_key, status, objective, prompt_text, source_session_memory_ids_json,
       source_event_refs_json, suggested_actions_json, reason, confidence, risk, created_at, updated_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    input.id,
    input.project_key,
    input.status,
    input.objective,
    input.prompt_text,
    JSON.stringify(input.source_session_memory_ids),
    JSON.stringify(input.source_event_refs),
    JSON.stringify(input.suggested_actions),
    input.reason,
    input.confidence,
    input.risk,
    input.now,
    input.now,
  );
}
```

This string interpolation is safe because `table` is selected from the closed `HANDOFF_TABLES` map, not user input.

- [ ] **Step 2: Add handoff test**

```ts
test("writes layer handoff instructions to separate layer tables", () => {
  createHandoffInstruction(db, {
    id: "handoff_1",
    target_scope: "project",
    project_key: "class-kit",
    status: "pending",
    objective: "Verify auth decision",
    prompt_text: "Read session memory mem_1 and verify whether project memory needs an auth note.",
    source_session_memory_ids: ["mem_1"],
    source_event_refs: ["tomb_1"],
    suggested_actions: ["query project memory", "read auth files"],
    reason: "Session memory found durable project signal",
    confidence: "medium",
    risk: "low",
    now: "2026-06-13T10:00:00.000Z",
  });

  const rows = db.query("SELECT id, objective FROM project_handoff_instructions").all() as Array<{
    id: string;
    objective: string;
  }>;
  expect(rows).toEqual([{ id: "handoff_1", objective: "Verify auth decision" }]);
});
```

## Verification

- Run: `bun test src/memory/session-memories.test.ts src/memory/candidates.test.ts src/memory/handoffs.test.ts`
  - Expected: repository tests pass.
- Run: `bun test src/memory/db.test.ts src/memory/experience.test.ts`
  - Expected: storage and tombstone tests still pass.
- Run: `bun run typecheck`
  - Expected: passes.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Trusted Session Memory is stored in `session_memories`.
- Memory Candidates use one target scope and normalized statuses.
- Project/Practice/Personal handoff instructions use separate tables.
- Later layers do not need to know physical table names.

## Risks And Rollback

- Risk: Chunk 04 can grow large if repository logic becomes more complex. If the file set exceeds this map, split Session Memory, candidates, and handoffs into separate chunk plans before coding.
- Risk: SQL table interpolation for handoffs must only use closed map values.
- Rollback: remove new repository modules and tests; schema from Chunk 01 can remain unused until reintroduced.

## Non-Goals

- No CLI candidate commands.
- No agent orchestration.
- No status/current-briefing integration.
- No vector retrieval or embeddings.
- No Project/Practice/Personal promotion.

## Type And Name Consistency

Verify helper names and row types match later imports in Chunks 05 and 06 before finalizing implementation.
