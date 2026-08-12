# Chunk 07: Session Memory Query Facade

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `02-sqlite-vec-adapter-and-availability.md`, `03-embedding-provider-and-normalizer.md`, `04-embedding-storage-schema.md`, `06-indexer-backfill-command.md`
**Enables:** `08-docs-validation-and-source-set.md`, later MCP/query design

## Goal

Implement internal retrieval-only `query_session_memory(project_key, question, limit, filters)` over indexed Session Memory. The facade returns ranked matches and degraded states only; it does not synthesize, expose MCP tools, or table-dump fallback content.

## Source Artifacts

- `../spec.md`: Query Facade, Error Handling, Out Of Scope
- `../agenda.md`: Questions 4 and 6
- Code paths: `src/query/engine.ts`, `src/memory/sqlite-vec.ts`, `src/memory/session-memory-embeddings.ts`

## Relationships

- **Depends on:** vector search adapter, query embedding provider, metadata schema, indexed rows.
- **Enables:** later MCP/query and Current Briefing design.
- **Shared contracts:** `querySessionMemory`, `SessionMemoryQueryResponse`, degraded state enum, active document/query contract derivation.
- **Integration points:** internal query modules only; no CLI/MCP surface required in this chunk.

## File Responsibility Map

**Create:**
- `src/memory/session-memory-query.ts` - internal query facade.
- `src/memory/session-memory-query.test.ts` - ranked match and degraded-state tests.

**Modify:**
- None required outside exports unless the repo has a central barrel file at implementation time.

## Implementation Tasks

### Task 1: Define Facade Contract

**Files:**
- Create: `src/memory/session-memory-query.ts`
- Test: `src/memory/session-memory-query.test.ts`

- [ ] **Step 1: Add response types**

Implement:

```ts
export type SessionMemoryQueryFilters = {
  memory_kind?: string;
  since?: string;
  confidence?: string;
  risk?: string;
};

export type SessionMemoryQueryMatch = {
  id: string;
  project_key: string;
  memory_kind: string;
  title: string | null;
  summary: string;
  source_event_refs: string[];
  confidence: string;
  risk: string;
  distance: number;
};

export type SessionMemoryQueryResponse = {
  project_key: string;
  question: string;
  matches: SessionMemoryQueryMatch[];
  degraded: boolean;
  degraded_reasons: string[];
};
```

- [ ] **Step 2: Add degraded-state tests**

Separate tests for:

- missing credentials/provider failure
- sqlite-vec unavailable
- no indexed vectors
- pending vectors exist but none indexed
- active-contract mismatch

Each test should assert `degraded: true` and a specific reason string.

### Task 2: Implement Retrieval

- [ ] **Step 1: Implement function signature**

```ts
export async function querySessionMemory(input: {
  db: Database;
  projectKey: string;
  question: string;
  limit: number;
  filters?: SessionMemoryQueryFilters;
  contract: ActiveEmbeddingContract;
  provider: EmbeddingProviderClient;
  vectorAdapter?: SqliteVecAdapter;
}): Promise<SessionMemoryQueryResponse>;
```

- [ ] **Step 2: Derive query and document contracts**

The facade receives the active query contract with purpose `retrieval_query`. It must derive the matching document contract by copying provider/model/dimensions/formatVersion and changing purpose to `retrieval_document`. Search uses the document contract metadata. Query embedding uses the query contract.

Add a local helper:

```ts
function documentContractForQuery(contract: ActiveEmbeddingContract): ActiveEmbeddingContract {
  return {
    provider: contract.provider,
    model: contract.model,
    dimensions: contract.dimensions,
    formatVersion: contract.formatVersion,
    purpose: "retrieval_document",
  };
}
```

- [ ] **Step 3: Embed query and search vectors**

Use `contract` with purpose `retrieval_query` for the query embedding. Search vector rows using document active-contract metadata. Join matching ids back to `session_memories` and `session_memory_embeddings`.

- [ ] **Step 4: Enforce project scope and filters**

All vector matches must be restricted by `project_key`. Apply filters in SQL after obtaining candidate memory ids; never return rows from another project.

- [ ] **Step 5: Return ranked matches only**

No answer text. No LLM synthesis. No direct fallback to latest rows when vectors are missing. Missing vectors produce degraded state with empty matches unless partial indexed matches exist for the active contract.

Tests must assert cross-project leakage is impossible and active-contract mismatch returns a degraded response before any positive-match test is accepted.

## Verification

- Run: `rtk bun test src/memory/session-memory-query.test.ts`
  - Expected: ranked match and degraded-state tests pass.
- Run: `rtk bun run typecheck`
  - Expected: exits 0.
- Run: `rtk git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- `query_session_memory` retrieves project-scoped Session Memory by semantic similarity.
- Retrieval exposes degraded states instead of table dumps.
- Facade is retrieval-only and internal.

## Risks And Rollback

- Risk: sqlite-vec KNN query syntax differs locally. Mitigation: keep syntax in adapter and test through adapter fakes if local extension is unavailable.
- Risk: callers misuse this as a synthesized answer. Mitigation: response type has `matches`, not `answer`.
- Rollback: remove facade file if no later code imports it.

## Non-Goals

- No MCP tool.
- No Current Briefing wiring.
- No broader `memory query` routing.
- No answer synthesis.

## Type And Name Consistency

Use exact exported function name `querySessionMemory`. The user-facing concept remains `query_session_memory`.
