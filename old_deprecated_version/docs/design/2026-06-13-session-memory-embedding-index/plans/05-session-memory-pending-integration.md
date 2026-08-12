# Chunk 05: Session Memory Pending Integration

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `04-embedding-storage-schema.md`
**Enables:** `06-indexer-backfill-command.md`, `07-session-memory-query-facade.md`

## Goal

Integrate trusted Session Memory creation with pending embedding metadata creation while keeping ingest provider-agnostic. This chunk must not call Gemini or sqlite-vec.

## Source Artifacts

- `../spec.md`: User-Facing Behavior, Integrations
- `../agenda.md`: Questions 1 and 2
- Code paths: `src/memory/session-memories.ts`, `src/memory/session-memories.test.ts`, `src/ingest/worker.ts`

## Relationships

- **Depends on:** metadata helper `ensurePendingSessionMemoryEmbedding`.
- **Enables:** indexer/backfill can find newly created memories.
- **Shared contracts:** `createSessionMemory` continues to return `SessionMemoryRow`; pending metadata is a side effect in the same DB transaction.
- **Integration points:** ingest worker already calls `createSessionMemory`.

## File Responsibility Map

**Modify:**
- `src/memory/session-memories.ts` - create pending embedding metadata after inserting a memory.
- `src/memory/session-memories.test.ts` - verify pending metadata side effect.
- `src/ingest/worker.test.ts` - verify worker-created memories also become pending, if existing tests need updates.

## Implementation Tasks

### Task 1: Extend Create Input With Optional Contract

**Files:**
- Modify: `src/memory/session-memories.ts`
- Test: `src/memory/session-memories.test.ts`

- [ ] **Step 1: Add failing test**

Add:

```ts
test("creates pending embedding metadata for trusted session memory", () => {
  const row = createSessionMemory(db, {
    id: "mem_embed",
    project_key: "class-kit",
    source_event_refs: ["tomb_1"],
    memory_kind: "continuity",
    summary: "Reviewer is standing by.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-13T10:00:00.000Z",
    embedding_contract: {
      provider: "gemini",
      model: "gemini-embedding-2",
      dimensions: 1536,
      purpose: "retrieval_document",
      formatVersion: 1,
    },
  });
  const embedding = db
    .query("SELECT session_memory_id, status FROM session_memory_embeddings WHERE session_memory_id = ?")
    .get(row.id);
  expect(embedding).toEqual({ session_memory_id: "mem_embed", status: "pending" });
});
```

- [ ] **Step 2: Update `CreateSessionMemoryInput`**

Add optional:

```ts
embedding_contract?: ActiveEmbeddingContract | null;
```

- [ ] **Step 3: Call metadata helper in the insert transaction**

Wrap insert plus pending metadata in a `db.transaction`. If `embedding_contract` is `null`, skip metadata. If it is omitted, use a default retrieval document contract from Chunk 01 constants so existing direct tests still get pending metadata.

Use:

```ts
ensurePendingSessionMemoryEmbedding(db, {
  session_memory_id: input.id,
  project_key: input.project_key,
  contract: input.embedding_contract ?? DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
  now: input.now,
});
```

`DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT` is owned by Chunk 01. Do not add or rename this shared export in this chunk; if it is missing, stop and fix Chunk 01 before continuing.

### Task 2: Preserve Ingest Worker Boundary

**Files:**
- Review: `src/ingest/worker.ts`
- Test: `src/ingest/worker.test.ts`

- [ ] **Step 1: Verify no provider logic is added to worker**

The worker should continue calling `createSessionMemory` with the same memory fields. It may omit `embedding_contract` and rely on the default contract. Do not add Gemini config or sqlite-vec imports to `src/ingest/worker.ts`.

- [ ] **Step 2: Update worker tests if count assertions change**

If worker tests inspect table lists or transactions, add assertions for pending metadata after a worker output writes a Session Memory row.

## Verification

- Run: `rtk bun test src/memory/session-memories.test.ts src/ingest/worker.test.ts`
  - Expected: session memory creation and worker output tests pass.
- Run: `rtk bun run typecheck`
  - Expected: exits 0.
- Run: `rtk git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- New trusted Session Memory writes create durable pending embedding metadata.
- Ingest remains provider-agnostic and does not call Gemini/sqlite-vec.

## Risks And Rollback

- Risk: adding a side effect to `createSessionMemory` changes tests that expected only one table write. Mitigation: keep the side effect transactional and explicit in tests.
- Rollback: restore previous `createSessionMemory` implementation if no downstream chunks landed.

## Non-Goals

- No text normalization.
- No provider calls.
- No vector writes.
- No update API unless implementation finds an existing local pattern requiring it.

## Type And Name Consistency

Keep the public function name `createSessionMemory`. Do not introduce a parallel creation API unless the implementation proves it reduces ambiguity.
