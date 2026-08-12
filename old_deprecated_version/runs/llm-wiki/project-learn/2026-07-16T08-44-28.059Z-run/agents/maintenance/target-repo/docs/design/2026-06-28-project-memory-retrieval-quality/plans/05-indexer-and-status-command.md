# Chunk 05: Indexer And Status Command

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Completed  
**Depends on:** `02-markdown-section-manifest.md`, `03-retrieval-storage-and-vector-state.md`, `04-retrieval-maintenance-queue.md`  
**Enables:** `06-lookup-and-packet-quality.md`, `08-hint-generation-flow.md`, `09-project-learn-lifecycle-and-dogfood.md`

## Goal

Build the deterministic Project Memory retrieval indexer and an operator-facing status/index command. The indexer reads canonical markdown sections plus valid hints, writes generated state, creates pending SQLite rows, embeds normalized retrieval text, upserts Project Memory vectors, marks stale/orphaned rows, and reports degraded serving-state status without changing canonical memory.

## Source Artifacts

- `../spec.md`: Post-write indexing, freshness, testing strategy
- `../agenda.md`: Question 4 freshness and rebuild ownership
- `../pseudocode/ProjectMemoryRetrievalIndexerFlow.md`
- `../pseudocode/ProjectMemoryRetrievalStateFiles.md`
- `../pseudocode/ProjectMemoryRetrievalStorage.ts`
- `../../../../src/memory/session-memory-indexer.ts`
- `../../../../src/memory/session-memory-index-service.ts`
- `../../../../src/memory/embedding-provider-factory.ts`
- `../../../../src/commands/memory.ts`
- `../../../../src/runtime/config.ts`

## Relationships

- **Depends on:** section extraction, retrieval storage/vector helpers, maintenance queue.
- **Enables:** packet lookup can prefer indexed section retrieval; lifecycle integration can run post-apply indexing.
- **Shared contracts:** `ProjectMemoryRetrievalIndexResult`, normalized embedding text order, Project Memory index command result JSON.
- **Integration points:** `memory` CLI command registry, embedding provider factory, active embedding contract, generated `sections.json`, hint files.

## File Responsibility Map

**Create:**

- `src/memory/project-memory-retrieval-indexer.ts` - indexer flow and result shape.
- `src/memory/project-memory-retrieval-text.ts` - normalized embedding text for markdown sections plus valid hints.
- `src/memory/project-memory-retrieval-index-service.ts` - root/config/provider wrapper for CLI/service use.
- `tests/memory/project-memory-retrieval-indexer.test.ts` - indexer behavior with stub provider/vector store.
- `tests/memory/project-memory-retrieval-text.test.ts` - normalized text ordering and hint exclusion.

**Modify:**

- `src/commands/memory.ts` - add command for Project Memory retrieval indexing/status.
- `tests/commands/memory.test.ts` - command JSON/status output.

**Test:**

- New memory tests plus targeted command tests.

## Implementation Tasks

### Task 1: Add normalized Project Memory retrieval text

**Files:**

- Create: `src/memory/project-memory-retrieval-text.ts`
- Create: `tests/memory/project-memory-retrieval-text.test.ts`

- [ ] **Step 1: Write normalized text tests**

```ts
import { expect, test } from "bun:test";
import { normalizeProjectMemorySectionForEmbedding } from "../../src/memory/project-memory-retrieval-text.ts";

test("normalizes Project Memory section text with valid hints after structural text", () => {
  const text = normalizeProjectMemorySectionForEmbedding({
    page_title: "Ranking",
    category: "architecture",
    heading_path: ["Ranking", "Proposal Ranking"],
    body_text: "Ranking body.",
    hints: {
      keywords: ["ranking", "proposal generation"],
      aliases: ["proposal stage"],
      topics: ["project memory pipeline"],
      query_phrases: ["how does Myelin decide what to write"],
    },
  });

  expect(text).toContain("title: Ranking");
  expect(text).toContain("category: architecture");
  expect(text).toContain("heading_path: Ranking > Proposal Ranking");
  expect(text).toContain("section_text: Ranking body.");
  expect(text).toContain("keywords: ranking; proposal generation");
  expect(text.indexOf("section_text")).toBeLessThan(text.indexOf("keywords"));
});
```

- [ ] **Step 2: Implement text normalizer**

```ts
export type ProjectMemoryRetrievalHintsForText = {
  keywords?: string[];
  aliases?: string[];
  topics?: string[];
  query_phrases?: string[];
};

export function normalizeProjectMemorySectionForEmbedding(input: {
  page_title: string;
  category: string | null;
  heading_path: string[];
  body_text: string;
  hints?: ProjectMemoryRetrievalHintsForText | null;
}): string {
  const lines = [
    `title: ${input.page_title}`,
    `category: ${input.category ?? "none"}`,
    `heading_path: ${input.heading_path.join(" > ")}`,
    `section_text: ${input.body_text.trim()}`,
  ];
  appendList(lines, "keywords", input.hints?.keywords);
  appendList(lines, "aliases", input.hints?.aliases);
  appendList(lines, "topics", input.hints?.topics);
  appendList(lines, "query_phrases", input.hints?.query_phrases);
  return lines.filter((line) => line.trim().length > 0).join("\n");
}

function appendList(lines: string[], label: string, values?: string[]): void {
  const cleaned = (values ?? []).map((value) => value.trim()).filter(Boolean);
  if (cleaned.length > 0) lines.push(`${label}: ${cleaned.join("; ")}`);
}
```

- [ ] **Step 3: Run text tests**

Run: `rtk bun test tests/memory/project-memory-retrieval-text.test.ts`  
Expected: passes.

### Task 2: Implement indexer core with injectable provider/vector store

**Files:**

- Create: `src/memory/project-memory-retrieval-indexer.ts`
- Test: `tests/memory/project-memory-retrieval-indexer.test.ts`

- [ ] **Step 1: Write indexer tests**

Use an in-memory DB, a temp project wiki, a stub embedding provider, and an injectable vector store.

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDb, type MemoryDb } from "../../src/memory/db.ts";
import { indexProjectMemoryRetrieval } from "../../src/memory/project-memory-retrieval-indexer.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";

let root: string;
let db: MemoryDb;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-pm-indexer-"));
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "index.md"), "# Demo\n\nProject memory body.\n", "utf8");
  db = openMemoryDb(root);
});

afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});

test("indexes markdown sections into Project Memory retrieval rows", async () => {
  const vectors: string[] = [];
  const result = await indexProjectMemoryRetrieval(db, {
    root,
    project_key: "demo",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: {
      async embed() {
        return { embedding: [0.1, 0.2, 0.3], model: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.model, dimensions: 3 };
      },
    },
    limit: 10,
    vector_store: {
      ensure: () => ({ available: true }),
      upsert: (_db, input) => vectors.push(input.retrieval_row_id),
    },
    now: () => "2026-06-28T10:00:00.000Z",
  });

  expect(result.indexed).toBeGreaterThan(0);
  expect(result.degraded).toBe(false);
  expect(vectors.length).toBe(result.indexed);
});

test("marks selected rows failed when vector store is unavailable", async () => {
  const result = await indexProjectMemoryRetrieval(db, {
    root,
    project_key: "demo",
    contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: {
      async embed() {
        throw new Error("provider should not be called");
      },
    },
    limit: 10,
    vector_store: {
      ensure: () => ({ available: false, reason: "sqlite-vec unavailable" }),
      upsert: () => undefined,
    },
    now: () => "2026-06-28T10:00:00.000Z",
  });

  expect(result.degraded).toBe(true);
  expect(result.failed).toBeGreaterThan(0);
  expect(result.degraded_reason).toContain("sqlite-vec unavailable");
});
```

- [ ] **Step 2: Implement result and vector store types**

```ts
export type ProjectMemoryRetrievalIndexFailure = {
  retrieval_row_id: string;
  wiki_path: string;
  section_id: string;
  reason: string;
};

export type ProjectMemoryRetrievalIndexResult = {
  project_key: string;
  structural_sections_seen: number;
  hints_valid: number;
  hints_stale: number;
  hints_orphaned: number;
  selected: number;
  indexed: number;
  failed: number;
  pending_remaining: number;
  degraded: boolean;
  batch_size: number;
  degraded_reason?: string;
  failures: ProjectMemoryRetrievalIndexFailure[];
};
```

Use an injectable vector store:

```ts
export type ProjectMemoryRetrievalVectorStore = {
  ensure: (db: Database, input: { contract: ActiveEmbeddingContract }) => { available: boolean; reason?: string };
  upsert: (db: Database, input: ProjectMemoryRetrievalVectorInput) => void;
};
```

- [ ] **Step 3: Implement index flow**

The flow must:

1. call `extractProjectMemorySections`;
2. write `sections.json`;
3. load and validate existing hints if present;
4. ensure pending rows for current sections and active contract;
5. mark missing old rows stale/orphaned;
6. ensure vector availability before provider calls;
7. embed normalized text in batches;
8. upsert vectors and mark rows indexed transactionally;
9. mark failures and return counts.

- [ ] **Step 4: Run indexer tests**

Run: `rtk bun test tests/memory/project-memory-retrieval-indexer.test.ts tests/memory/project-memory-retrieval-text.test.ts`  
Expected: passes.

### Task 3: Add operator command

**Files:**

- Create: `src/memory/project-memory-retrieval-index-service.ts`
- Modify: `src/commands/memory.ts`
- Test: `tests/commands/memory.test.ts`

- [ ] **Step 1: Add command tests**

Use command name `memory index project <project-key>` because it fits the existing `memory index session <project-key>` family while naming the memory layer explicitly.

```ts
test("memory index project reports Project Memory retrieval indexing as JSON", async () => {
  const result = await runCli([
    "memory",
    "index",
    "project",
    "demo",
    "--limit",
    "10",
    "--json",
  ]);
  const response = JSON.parse(result.message);
  expect(response.project_key).toBe("demo");
  expect(response).toHaveProperty("structural_sections_seen");
  expect(response).toHaveProperty("indexed");
  expect(response).toHaveProperty("degraded");
});
```

Adjust the fixture setup to seed `projects/demo/wiki/index.md` and stub embedding provider consistently with existing command tests.

- [ ] **Step 2: Implement service wrapper**

```ts
export class ProjectMemoryRetrievalIndexService {
  constructor(private readonly root: string) {}

  async indexProject(input: {
    projectKey: string;
    limit: number;
    batchSize?: number;
    retryFailed?: boolean;
    now?: () => string;
  }): Promise<ProjectMemoryRetrievalIndexResult> {
    const config = loadConfig(this.root);
    const contract = selectActiveEmbeddingContract(config, "retrieval_document");
    const provider = EmbeddingProviderFactory.fromConfig(config);
    const db = openMemoryDb(this.root);
    try {
      return await indexProjectMemoryRetrieval(db, {
        root: this.root,
        project_key: input.projectKey,
        contract,
        provider,
        limit: input.limit,
        batch_size: input.batchSize,
        retry_failed: input.retryFailed,
        now: input.now,
      });
    } finally {
      db.close();
    }
  }
}
```

Use the actual existing factory method names from `src/memory/embedding-provider-factory.ts`; keep the shape equivalent if names differ.

- [ ] **Step 3: Register command**

In `registerMemoryCommands`, add:

```ts
cli.command(["memory", "index", "project"], (args) => indexProjectMemory(args));
```

Parse flags using the same style as `indexSession`: `<project-key> [--limit N] [--batch-size N] [--retry-failed] [--json]`.

Human output should include:

```ts
`Project Memory retrieval index for ${projectKey}: selected ${selected}, indexed ${indexed}, failed ${failed}, pending ${pending_remaining}.`
```

If `degraded` is true, JSON mode should still return `ok(stableJson(result))`; non-JSON mode may return `fail(messageWithReason)` following the Session Memory index command pattern.

- [ ] **Step 4: Run command tests**

Run: `rtk bun test tests/commands/memory.test.ts`  
Expected: passes, including the new `memory index project` test.

## Verification

- `rtk bun test tests/memory/project-memory-retrieval-text.test.ts tests/memory/project-memory-retrieval-indexer.test.ts`  
  Expected: passes.
- `rtk bun test tests/commands/memory.test.ts`  
  Expected: passes.
- `rtk bun run typecheck`  
  Expected: passes.

## Acceptance Criteria Covered

- Deterministic markdown sections become pending/indexed Project Memory retrieval rows.
- Valid hints are included in normalized text; invalid/stale/orphaned hints are excluded.
- Indexing failures degrade retrieval serving state but not canonical markdown.
- Operator has a repo-native command to build/status Project Memory retrieval indexing.

## Risks And Rollback

- Risk: command naming may feel too close to Session Memory indexing. Mitigation: use `memory index project`, not `project ingest` or V1 names.
- Risk: embedding provider calls require credentials in non-test use. Mitigation: tests use stub providers; command reports degraded failures clearly.
- Rollback: leave storage rows pending and stop invoking the command; canonical wiki remains unaffected.

## Non-Goals

- No automatic post-apply indexing inside `project learn`.
- No packet lookup through the index.
- No model-backed hint generation.
- No query/MCP exposure.

## Type And Name Consistency

Verify these names are exact:

- `indexProjectMemoryRetrieval`
- `ProjectMemoryRetrievalIndexResult`
- `normalizeProjectMemorySectionForEmbedding`
- `ProjectMemoryRetrievalIndexService`
- `memory index project`
- `Project Memory retrieval index for <project>`
