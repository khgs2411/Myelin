# Chunk 06: Project Memory Markdown Query

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `03-section-targeting-foundation.md`
**Enables:** `07-dogfood-reset-and-validation.md`

## Goal

Add a Project Memory query layer that searches derived Project Memory retrieval vectors, resolves hits back to canonical markdown sections, and returns inline section content under a configured limit or canonical references when content is too large or stale. Session Memory row retrieval remains distinct.

## Source Artifacts

- `../spec.md`: `Retrieval And Query Shape`.
- `../agenda.md`: Question 5 and roadmap audit query recommendation.
- `../pseudocode/ProjectMemoryMarkdownQueryBoundary.md`.
- `../plans/03-section-targeting-foundation.md`.
- ADRs: `docs/adr/0048-core-owns-query-mcp-consumes-via-contract.md`, `docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`.
- Current code: `src/query/memory-query-service.ts`, `src/query/engine.ts`, `src/commands/memory.ts`, `src/memory/sqlite-vec.ts`, `src/memory/project-memory-retrieval-storage.ts`, `src/project/project-memory-markdown-sections.ts`, `src/memory/query-embedding-cache.ts`.
- Tests: `tests/query/memory-query-service.test.ts`, `tests/memory/sqlite-vec.test.ts`, `tests/memory/project-memory-retrieval-storage.test.ts`, `tests/project/project-memory-markdown-sections.test.ts`.

## Relationships

- **Depends on:** Packet/section identity from chunk 03 and existing Project Memory retrieval index rows.
- **Enables:** Dogfood query checks in chunk 07.
- **Shared contracts:** Query input `layers`, `project_memory_return.max_inline_chars`, `ProjectMemoryQueryMatch`, `QueryLayerDiagnostic` union.
- **Integration points:** `memory query` command, deterministic query response service, SQLite vector search, canonical markdown reads.

## Resolved Decisions For Execution

- Preserve the existing `QueryResponse.matches` field as Session Memory matches only for backward compatibility.
- Add `project_memory_matches?: ProjectMemoryQueryMatch[]` for Project Memory layer results.
- Add `layers?: QueryLayerDiagnostic[]` entries where `layer` can be `"session_memory"` or `"project_memory"`.
- Add `--layer project` and `--max-inline-chars 4000`; default/auto keeps current Session Memory behavior in this slice.
- Project Memory query uses the retrieval query embedding contract, searches `project_memory_section_vec`, hydrates retrieval rows, re-extracts current markdown sections, verifies `section_hash`, and only then returns inline content.

## File Responsibility Map

**Create:**
- `src/query/project-memory-query-service.ts` - Project Memory markdown-backed retrieval service.
- `tests/query/project-memory-query-service.test.ts` - inline/ref/stale/degraded query behavior.

**Modify:**
- `src/query/memory-query-service.ts` - composes Session Memory and Project Memory layers without blurring truth sources.
- `src/query/engine.ts` - passes root and Project Memory return options to the query service.
- `src/commands/memory.ts` - parses `--layer` and `--max-inline-chars`.
- `src/memory/project-memory-retrieval-storage.ts` - adds hydration helper for indexed retrieval rows if missing.

**Test:**
- `tests/query/memory-query-service.test.ts` - facade route includes project layer.
- `tests/query/project-memory-query-service.test.ts` - project layer behavior.

## Implementation Tasks

### Task 1: Add Project Memory query service

**Files:**
- Create: `src/query/project-memory-query-service.ts`
- Test: `tests/query/project-memory-query-service.test.ts`

- [ ] **Step 1: Add service tests**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openMemoryDb } from "../../src/memory/db.ts";
import type { ActiveEmbeddingContract } from "../../src/runtime/config.ts";
import type { EmbeddingProviderClient } from "../../src/memory/embedding-provider.ts";
import { ProjectMemoryMarkdownQueryService } from "../../src/query/project-memory-query-service.ts";

describe("Project Memory markdown query", () => {
  test("returns inline content when resolved section is under max_inline_chars", async () => {
    const testRoot = await mkdtemp(join(tmpdir(), "pm-query-"));
    await mkdir(join(testRoot, "projects", "demo", "wiki"), { recursive: true });
    await writeFile(join(testRoot, "projects", "demo", "wiki", "runtime.md"), "# Runtime\n\n## Commands\n\nRun `bun test`.\n", "utf8");
    const db = openMemoryDb(testRoot);
    const contract = testRetrievalContract();
    const service = new ProjectMemoryMarkdownQueryService({
      root: testRoot,
      db,
      documentContract: contract,
      embeddingProvider: fixedEmbeddingProvider([0.1, 0.2, 0.3]),
      vectorStore: fixedProjectMemoryVectorStore([{ retrieval_row_id: "pmr_runtime", distance: 0.12 }]),
    });
    const result = await service.query({ projectKey: "demo", question: "runtime commands", limit: 1, maxInlineChars: 500 });
    expect(result.memory_scope).toBe("project_memory");
    expect(result.project_memory_matches[0].return_kind).toBe("inline_content");
    db.close();
  });
});

function testRetrievalContract(): ActiveEmbeddingContract {
  return {
    provider: "stub",
    model: "stub-retrieval",
    dimensions: 3,
    purpose: "retrieval_query",
    formatVersion: 1,
  };
}

function fixedEmbeddingProvider(embedding: number[]): EmbeddingProviderClient {
  return {
    async embed() {
      return { embedding, dimensions: embedding.length };
    },
  };
}

function fixedProjectMemoryVectorStore(matches: { retrieval_row_id: string; distance: number }[]) {
  return {
    ensure: () => ({ available: true }),
    search: () => matches,
  };
}
```

- [ ] **Step 2: Implement service contracts**

```ts
export type ProjectMemoryQueryMatch = {
  wiki_path: string;
  section_id: string;
  heading_path: string[];
  return_kind: "inline_content" | "reference";
  content?: string;
  reference_reason?: "too_large" | "stale_hash" | "missing_markdown" | "degraded";
  score: number;
  citation: string;
};

export type ProjectMemoryQueryResult = {
  answer: string;
  memory_scope: "project_memory" | "none";
  degraded: boolean;
  degraded_reason: string | null;
  source_tools: string[];
  project_memory_matches: ProjectMemoryQueryMatch[];
  indexed_count: number;
  stale_count: number;
};
```

Use `getOrCreateQueryEmbedding`, `searchProjectMemoryRetrievalVectors`, retrieval row hydration, and `extractProjectMemorySections` to resolve vector rows back to current markdown. If the row `section_hash` does not match the current section, return a reference with `reference_reason: "stale_hash"`.

The composed facade response must be:

```ts
export type QueryResponse = FacadeResponse & {
  matches: SessionMemoryQueryMatch[];
  project_memory_matches?: ProjectMemoryQueryMatch[];
  layers?: QueryLayerDiagnostic[];
};
```

When `--layer project` is selected, `matches` must be `[]`, `project_memory_matches` must hold the markdown-backed results, `memory_scope` must be `"project_memory"` when non-degraded matches exist, and `source_tools` must include `"query-embedding-cache"` and `"project-memory-vector-index"`.

### Task 2: Add retrieval row hydration

**Files:**
- Modify: `src/memory/project-memory-retrieval-storage.ts`
- Test: `tests/memory/project-memory-retrieval-storage.test.ts`

- [ ] **Step 1: Add helper**

```ts
export function listProjectMemoryRetrievalEmbeddingsByIds(db: Database, ids: string[]): ProjectMemoryRetrievalEmbeddingRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  return db.query(`SELECT * FROM project_memory_retrieval_embeddings WHERE id IN (${placeholders})`).all(...ids) as ProjectMemoryRetrievalEmbeddingRow[];
}
```

Tests should assert empty input returns `[]` and ordered callers can map returned rows by `id`.

### Task 3: Compose query layers without blurring truth sources

**Files:**
- Modify: `src/query/memory-query-service.ts`
- Modify: `src/query/engine.ts`
- Modify: `src/commands/memory.ts`
- Test: `tests/query/memory-query-service.test.ts`

- [ ] **Step 1: Extend input and diagnostics**

Add:

```ts
layers?: "session" | "project" | "auto";
projectMemoryReturn?: { maxInlineChars: number };
```

Extend `QueryLayerDiagnostic` to include `layer: "project_memory"` and project-specific indexed/stale/match counts.

- [ ] **Step 2: Route layer selection**

For the first slice, implement:

- `--layer session`: existing Session Memory behavior.
- `--layer project`: Project Memory markdown query only.
- absent layer or `--layer auto`: keep existing Session Memory default to avoid changing current behavior silently.

This satisfies the spec's Project Memory path without breaking current callers.

- [ ] **Step 3: Add CLI parsing**

In `parseArgs`, accept:

```text
--layer session|project|auto
--max-inline-chars 4000
```

Default `max_inline_chars` should be `4000`.

## Verification

- Run: `bun test tests/query/project-memory-query-service.test.ts`
  Expected: inline, reference-only, stale hash, missing index, and degraded cases pass.
- Run: `bun test tests/query/memory-query-service.test.ts`
  Expected: existing Session Memory tests pass; project layer route is covered.
- Run: `bun test tests/memory/project-memory-retrieval-storage.test.ts`
  Expected: hydration helper tests pass.
- Run: `bun test tests/memory/sqlite-vec.test.ts`
  Expected: Project Memory vector search primitives still pass.
- Run: `bun run typecheck`
  Expected: no TypeScript errors.
- Run: `git diff --check`
  Expected: no whitespace errors.

## Acceptance Criteria Covered

- Project Memory query resolves derived hits back to canonical markdown.
- Inline content is returned only under the configured threshold.
- Too-large, stale, or missing markdown returns canonical refs/degraded reasons.
- Session Memory and Project Memory query truth sources remain separate.

## Risks And Rollback

- Risk: default query behavior changes unexpectedly. Mitigation: absent `--layer` remains Session Memory in this chunk.
- Risk: stale vector rows return stale content. Mitigation: hash check current markdown before inline content.
- Rollback: remove `--layer project` route and the new project query service; existing Session Memory query remains unchanged.

## Non-Goals

- Does not synthesize final LLM answers.
- Does not enqueue Project Memory curation from query gaps.
- Does not require mixed Session+Project results in the first slice.

## Type And Name Consistency

Before finalizing implementation, verify CLI flags, `QueryResponse` fields, `ProjectMemoryQueryMatch`, citations, and layer diagnostic names are consistent in service, engine, command parser, and tests.
