# Chunk 06: Indexer Backfill Command

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `02-sqlite-vec-adapter-and-availability.md`, `03-embedding-provider-and-normalizer.md`, `04-embedding-storage-schema.md`, `05-session-memory-pending-integration.md`
**Enables:** `07-session-memory-query-facade.md`, `08-docs-validation-and-source-set.md`

## Goal

Implement explicit operator-driven indexing/backfill for pending or failed Session Memory embeddings. The command shape is `myelin memory index session <project-key> [--limit N] [--retry-failed] [--json]`.

## Source Artifacts

- `../spec.md`: Error Handling, Data / State, Acceptance Criteria
- Roadmap audit note: exact command shape must be defined before implementation
- Code paths: `src/commands/memory.ts`, `src/commands/memory.test.ts`, `src/memory/session-memory-embeddings.ts`

## Relationships

- **Depends on:** config contract, adapter, provider/normalizer, storage, pending integration.
- **Enables:** query facade has indexed vectors to retrieve.
- **Shared contracts:** `indexSessionMemoryEmbeddings`, command JSON output.
- **Integration points:** memory CLI command registry, DB repository helpers.

## File Responsibility Map

**Create:**
- `src/memory/session-memory-indexer.ts` - index/backfill workflow.
- `src/memory/session-memory-indexer.test.ts` - success, failure, retry, sqlite-vec unavailable behavior.

**Modify:**
- `src/commands/memory.ts` - add `memory index session`.
- `src/commands/memory.test.ts` - command parsing and JSON output tests.

## Implementation Tasks

### Task 1: Add Indexer Workflow

**Files:**
- Create: `src/memory/session-memory-indexer.ts`
- Test: `src/memory/session-memory-indexer.test.ts`

- [ ] **Step 1: Add workflow tests**

Cover:

- indexes one pending row with stub embedding and marks it indexed
- failed provider marks row failed and increments retry count
- sqlite-vec unavailable leaves row failed or pending with an explicit failure reason
- `include_failed` controls failed-row retry selection
- active-contract rows are ensured before indexing when missing

- [ ] **Step 2: Implement workflow signature**

Export:

```ts
export type IndexSessionMemoryEmbeddingsInput = {
  db: Database;
  projectKey: string;
  contract: ActiveEmbeddingContract;
  provider: EmbeddingProviderClient;
  limit: number;
  includeFailed: boolean;
  now: string;
  vectorAdapter?: SqliteVecAdapter;
};

export type IndexSessionMemoryEmbeddingsResult = {
  project_key: string;
  selected: number;
  indexed: number;
  failed: number;
  degraded: boolean;
  degraded_reasons: string[];
};

export async function indexSessionMemoryEmbeddings(
  input: IndexSessionMemoryEmbeddingsInput,
): Promise<IndexSessionMemoryEmbeddingsResult>;
```

- [ ] **Step 3: Implement indexing loop**

For each selected row:

1. Load the `session_memories` row.
2. Normalize searchable text with `normalizeSessionMemoryForEmbedding`.
3. Hash normalized text.
4. Skip and mark indexed only when existing hash/vector state already matches.
5. Call provider.
6. Ensure vector table for the active contract.
7. Upsert vector row.
8. Mark metadata indexed with hash and `indexed_at`.
9. On provider/vector error, mark failed with reason and continue.

The function must never throw for a per-row provider failure; it should reserve throws for programmer/config errors such as invalid input.

When a failed row is retried, `retry_count` increments only if the new attempt fails. On success, `markSessionMemoryEmbeddingIndexed` clears `failure_reason` and updates `indexed_at`.

### Task 2: Add CLI Command

**Files:**
- Modify: `src/commands/memory.ts`
- Test: `src/commands/memory.test.ts`

- [ ] **Step 1: Register command**

Add:

```ts
cli.command(["memory", "index", "session"], async (args) => indexSession(args));
```

- [ ] **Step 2: Parse args**

Usage text:

```text
Usage: myelin memory index session <project-key> [--limit N] [--retry-failed] [--json]
```

Defaults:

- `limit`: 50
- `retryFailed`: false
- `json`: false

- [ ] **Step 3: Resolve config and provider**

Use `loadConfig(repoRoot().root)`, `selectActiveEmbeddingContract(config, "retrieval_document")`, and either `createStubEmbeddingProvider(config.embedding.stubResponsesDir)` or `createGeminiEmbeddingProvider({ apiKey: process.env.GEMINI_API_KEY })`.

Missing `GEMINI_API_KEY` should return a degraded failure result, not crash the CLI.

- [ ] **Step 4: Return stable output**

JSON output shape:

```json
{
  "project_key": "class-kit",
  "selected": 2,
  "indexed": 2,
  "failed": 0,
  "degraded": false,
  "degraded_reasons": []
}
```

Text output:

```text
Indexed 2 session memory embeddings for class-kit. failed=0 degraded=false
```

## Verification

- Run: `rtk bun test src/memory/session-memory-indexer.test.ts src/commands/memory.test.ts`
  - Expected: indexer and command tests pass without network.
- Run: `rtk bun run typecheck`
  - Expected: exits 0.
- Run: `rtk git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Dedicated indexer/backfill owns Gemini/sqlite-vec writes.
- Missing credentials and sqlite-vec unavailable are explicit degraded states.
- Existing and new pending rows can be indexed through an operator command.

## Risks And Rollback

- Risk: command naming conflicts with future all-memory indexing. Mitigation: command includes `session` scope.
- Risk: vector writes fail after provider succeeds. Mitigation: mark the row failed with a retryable reason and keep Session Memory durable.
- Rollback: unregister command and remove indexer if query facade has not landed.

## Non-Goals

- No MCP exposure.
- No Current Briefing integration.
- No synthesized answers.
- No automatic indexing during query or migration.

## Type And Name Consistency

Use exact command `myelin memory index session`. Use exact export `indexSessionMemoryEmbeddings`.
