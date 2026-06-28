# Chunk 08: Hint Generation Flow

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `02-markdown-section-manifest.md`, `03-retrieval-storage-and-vector-state.md`, `04-retrieval-maintenance-queue.md`, `05-indexer-and-status-command.md`  
**Enables:** `09-project-learn-lifecycle-and-dogfood.md`

## Goal

Implement the separate model-backed hint-generation flow that reads completed canonical markdown plus deterministic structural metadata, writes validated category-scoped hint files under state, records provider output as run artifacts, updates SQLite job/status rows, and uses the retrieval-maintenance queue for failures or usage-driven refresh. The Project Memory curator must not author these hints.

## Source Artifacts

- `../spec.md`: retrieval hints, hint freshness, mandatory versus optional refresh
- `../agenda.md`: Question 2 retrieval unit and hint ownership
- `../pseudocode/ProjectMemoryHintGenerationFlow.md`
- `../pseudocode/ProjectMemoryRetrievalStateFiles.md`
- `../pseudocode/RetrievalMaintenanceQueue.ts`
- `../../../../docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`
- `../../../../src/runtime/project-run-infrastructure.ts`
- `../../../../src/runtime/llm-client.ts`
- `../../../../src/runtime/config.ts`
- `../../../../src/project/project-memory-curator-service.ts`

## Relationships

- **Depends on:** section manifests, retrieval storage, queue, and indexer result contracts.
- **Enables:** final `project learn` lifecycle can distinguish `completed` from `completed_with_pending_index`.
- **Shared contracts:** `hints/<category>.json`, `hint-status.json`, hint-generation run artifact shape, SQLite job/status rows.
- **Integration points:** provider abstraction, run artifacts, retrieval-maintenance queue, indexer normalized text.

## File Responsibility Map

**Create:**

- `src/project/project-memory-hints.ts` - hint file schemas, validation against section manifest, read/write helpers.
- `src/project/project-memory-hint-generator.ts` - provider-backed hint-generation orchestration and run artifact writing.
- `src/memory/project-memory-hint-jobs.ts` - SQLite job/status rows for retryable hint generation work.
- `tests/project/project-memory-hints.test.ts` - deterministic hint validation.
- `tests/project/project-memory-hint-generator.test.ts` - provider output validation and artifact writing with a stub runner.
- `tests/memory/project-memory-hint-jobs.test.ts` - job/status row lifecycle.

**Modify:**

- `src/memory/migrations.ts` - add hint job/status table.
- `src/memory/project-memory-retrieval-indexer.ts` - consume only valid hints and reflect missing required hints in result counts if not already covered by chunk 5.

**Test:**

- New project and memory tests.

## Implementation Tasks

### Task 1: Add hint file validation

**Files:**

- Create: `src/project/project-memory-hints.ts`
- Create: `tests/project/project-memory-hints.test.ts`

- [ ] **Step 1: Write hint validation tests**

```ts
import { expect, test } from "bun:test";
import {
  validateProjectMemoryHintFile,
  type ProjectMemoryHintFile,
} from "../../src/project/project-memory-hints.ts";
import type { ProjectMemorySectionManifest } from "../../src/project/project-memory-markdown-sections.ts";

test("validates hints against current section refs and hashes", () => {
  const manifest: ProjectMemorySectionManifest = {
    schema_version: 1,
    project_key: "demo",
    generated_at: "2026-06-28T10:00:00.000Z",
    pages: [],
    sections: [
      {
        project_key: "demo",
        wiki_path: "wiki/architecture/ranking.md",
        category: "architecture",
        page_title: "Ranking",
        section_id: "ranking",
        heading_level: 1,
        heading_text: "Ranking",
        heading_path: ["Ranking"],
        body_text: "Ranking body.",
        snippet: "Ranking body.",
        section_hash: "sha256:section",
      },
    ],
    warnings: [],
  };
  const hints: ProjectMemoryHintFile = {
    schema_version: 1,
    project_key: "demo",
    category: "architecture",
    generated_by: { flow: "project_memory_hint_generation", provider: "stub", model: "stub", run_ref: "run" },
    entries: [
      {
        wiki_path: "wiki/architecture/ranking.md",
        section_id: "ranking",
        section_hash: "sha256:section",
        keywords: ["ranking"],
        aliases: ["proposal ranking"],
        topics: ["architecture"],
        query_phrases: ["how does ranking work"],
        confidence: "high",
      },
    ],
  };

  const result = validateProjectMemoryHintFile(manifest, hints);

  expect(result.valid_entries).toHaveLength(1);
  expect(result.status_entries[0]).toMatchObject({ status: "valid", reason: null });
});

test("marks changed hash hints stale and missing refs orphaned", () => {
  const manifest = manifestWithSection("sha256:current");
  const result = validateProjectMemoryHintFile(manifest, {
    schema_version: 1,
    project_key: "demo",
    category: "architecture",
    generated_by: { flow: "project_memory_hint_generation", provider: "stub", model: "stub", run_ref: "run" },
    entries: [
      hintEntry({ section_hash: "sha256:old" }),
      hintEntry({ section_id: "missing", section_hash: "sha256:current" }),
    ],
  });

  expect(result.status_entries.map((entry) => entry.status)).toEqual(["stale", "orphaned"]);
  expect(result.valid_entries).toEqual([]);
});
```

- [ ] **Step 2: Implement hint schemas and validation**

```ts
export type ProjectMemoryHintEntry = {
  wiki_path: string;
  section_id: string;
  section_hash: string;
  keywords: string[];
  aliases: string[];
  topics: string[];
  query_phrases: string[];
  confidence: "low" | "medium" | "high";
};

export type ProjectMemoryHintFile = {
  schema_version: 1;
  project_key: string;
  category: string | null;
  generated_by: {
    flow: "project_memory_hint_generation";
    provider: string;
    model: string;
    run_ref: string;
  };
  entries: ProjectMemoryHintEntry[];
};

export type ProjectMemoryHintStatusEntry = {
  wiki_path: string;
  section_id: string;
  status: "valid" | "stale" | "orphaned" | "missing_required" | "needs_reembed" | "low_confidence";
  reason: string | null;
};
```

Validation:

```ts
export function validateProjectMemoryHintFile(
  manifest: ProjectMemorySectionManifest,
  hintFile: ProjectMemoryHintFile,
): {
  valid_entries: ProjectMemoryHintEntry[];
  status_entries: ProjectMemoryHintStatusEntry[];
} {
  const sectionByRef = new Map(manifest.sections.map((section) => [`${section.wiki_path}#${section.section_id}`, section]));
  const valid_entries: ProjectMemoryHintEntry[] = [];
  const status_entries: ProjectMemoryHintStatusEntry[] = [];
  for (const entry of hintFile.entries) {
    const section = sectionByRef.get(`${entry.wiki_path}#${entry.section_id}`);
    if (!section) {
      status_entries.push({ wiki_path: entry.wiki_path, section_id: entry.section_id, status: "orphaned", reason: "section ref missing" });
      continue;
    }
    if (section.section_hash !== entry.section_hash) {
      status_entries.push({ wiki_path: entry.wiki_path, section_id: entry.section_id, status: "stale", reason: "section hash changed" });
      continue;
    }
    valid_entries.push(entry);
    status_entries.push({ wiki_path: entry.wiki_path, section_id: entry.section_id, status: "valid", reason: null });
  }
  return { valid_entries, status_entries };
}
```

- [ ] **Step 3: Run hint validation tests**

Run: `rtk bun test tests/project/project-memory-hints.test.ts`  
Expected: passes.

### Task 2: Add hint job/status storage

**Files:**

- Modify: `src/memory/migrations.ts`
- Create: `src/memory/project-memory-hint-jobs.ts`
- Create: `tests/memory/project-memory-hint-jobs.test.ts`

- [ ] **Step 1: Add migration**

Use the next migration version after prior chunks.

```ts
CREATE TABLE project_memory_hint_jobs (
  id                  TEXT PRIMARY KEY,
  project_key         TEXT NOT NULL,
  category            TEXT,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  required            INTEGER NOT NULL CHECK (required IN (0, 1)),
  section_refs_json   TEXT NOT NULL,
  provider            TEXT,
  model               TEXT,
  run_ref             TEXT,
  failure_reason      TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  completed_at        TEXT
);
CREATE INDEX project_memory_hint_jobs_project_status
  ON project_memory_hint_jobs(project_key, status, created_at);
```

- [ ] **Step 2: Implement job helpers**

```ts
export type ProjectMemoryHintJobStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export function createProjectMemoryHintJob(db: Database, input: {
  project_key: string;
  category: string | null;
  required: boolean;
  section_refs: string[];
  provider?: string;
  model?: string;
  now: string;
}): ProjectMemoryHintJobRow;

export function markProjectMemoryHintJobCompleted(db: Database, input: {
  id: string;
  run_ref: string;
  now: string;
}): ProjectMemoryHintJobRow;

export function markProjectMemoryHintJobFailed(db: Database, input: {
  id: string;
  failure_reason: string;
  now: string;
}): ProjectMemoryHintJobRow;
```

- [ ] **Step 3: Run hint job tests**

Run: `rtk bun test tests/memory/project-memory-hint-jobs.test.ts`  
Expected: passes.

### Task 3: Implement provider-backed hint generator

**Files:**

- Create: `src/project/project-memory-hint-generator.ts`
- Test: `tests/project/project-memory-hint-generator.test.ts`

- [ ] **Step 1: Write generator tests with stub runner**

```ts
test("writes accepted category hint file and preserves raw provider output", async () => {
  const result = await generateProjectMemoryHints({
    root,
    projectKey: "demo",
    category: "architecture",
    manifest,
    sections: manifest.sections,
    provider: "codex",
    model: "stub-hints",
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schema_version: 1,
        project_key: "demo",
        category: "architecture",
        entries: [validHintEntry],
      }),
      stderr: "",
    }),
    now: new Date("2026-06-28T10:00:00.000Z"),
  });

  expect(result.status).toBe("completed");
  expect(result.accepted_entries).toBe(1);
  expect(await Bun.file(join(root, "projects", "demo", "state", "project-memory-retrieval", "hints", "architecture.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_ref, "hint-generation-output.json")).exists()).toBe(true);
});
```

- [ ] **Step 2: Implement generator result and prompt contract**

```ts
export type ProjectMemoryHintGenerationResult = {
  status: "completed" | "failed" | "skipped";
  project_key: string;
  category: string | null;
  required: boolean;
  accepted_entries: number;
  rejected_entries: number;
  run_ref: string;
  degraded: boolean;
  degraded_reason?: string;
};
```

Prompt requirements:

- JSON on stdout;
- entries must include `wiki_path`, `section_id`, `section_hash`, `keywords`, `aliases`, `topics`, `query_phrases`, `confidence`;
- no markdown writes;
- no canonical truth decisions.

- [ ] **Step 3: Preserve conservative replacement policy**

When an existing hint file is valid and refresh was not explicitly requested, keep old valid hints. Replace stale hints and required missing hints. Preserve alternative output as diagnostics.

- [ ] **Step 4: Run generator tests**

Run: `rtk bun test tests/project/project-memory-hint-generator.test.ts`  
Expected: passes.

## Verification

- `rtk bun test tests/project/project-memory-hints.test.ts tests/memory/project-memory-hint-jobs.test.ts tests/project/project-memory-hint-generator.test.ts`  
  Expected: passes.
- `rtk bun test tests/memory/project-memory-retrieval-indexer.test.ts`  
  Expected: passes after indexer consumes only valid hints.
- `rtk bun run typecheck`  
  Expected: passes.

## Acceptance Criteria Covered

- Hint generation is separate from Project Memory curator output.
- Hint files live under `state/project-memory-retrieval/hints/`.
- Run artifacts preserve provider prompt/output/diagnostics.
- SQLite job/status rows track retryable hint work.
- Invalid/stale/orphaned hints are excluded from embeddings.

## Risks And Rollback

- Risk: this chunk becomes too broad. Mitigation: land hint validation/job storage first, then provider orchestration in the same chunk only if reviewable.
- Risk: provider invocation can fail or output invalid JSON. Mitigation: preserve raw output artifact, mark job failed, and do not mutate canonical markdown.
- Rollback: disable hint generator invocation and rely on structural section text indexing; generated hint files and jobs are derived state.

## Non-Goals

- No Project Memory curator changes.
- No canonical markdown writes.
- No MCP/query feedback producer.
- No final `project learn` lifecycle integration.

## Type And Name Consistency

Verify these names are exact:

- `ProjectMemoryHintFile`
- `ProjectMemoryHintEntry`
- `validateProjectMemoryHintFile`
- `project_memory_hint_jobs`
- `generateProjectMemoryHints`
- `state/project-memory-retrieval/hints/<category>.json`
- `state/project-memory-retrieval/hint-status.json`
