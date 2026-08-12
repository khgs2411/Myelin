# Chunk 03: Apply Journal Staging And Recovery

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-apply-payload-contracts-and-validation.md`, `02-markdown-entry-renderer-and-safe-mutation.md`
**Enables:** `04-creation-apply.md`, `05-maintenance-apply.md`, `07-project-learn-service-integration.md`

## Goal

Implement the deterministic write-safety substrate for Project Memory apply: staged outputs, apply journals, canonical promotion order, observed promotion tracking, and recovery from incomplete journals. This chunk creates the applier class and infrastructure but only needs a test harness with synthetic rendered outputs; mode-specific creation and maintenance write sets are owned by later chunks.

## Source Artifacts

- `../spec.md`: Apply Artifacts, Error Handling, Testing Strategy.
- `../agenda.md`: Questions 3 and 7.
- `../pseudocode/ProjectApplyGateBoundary.md`
- `../pseudocode/ProjectLearnMarkdownApplyFlow.md`
- `../pseudocode/src/project/project-memory-markdown-applier.ts`
- `../../../adr/0060-use-apply-journal-for-project-memory-writes.md`
- `src/project/project-memory-apply-contracts.ts`
- `src/project/project-memory-markdown-renderer.ts`
- `src/runtime/json.ts`
- `src/runtime/fs.ts`
- `src/runtime/project-run-infrastructure.ts`

## Relationships

- **Depends on:** apply contract types and renderer helpers from chunks 01 and 02.
- **Enables:** mode-specific apply chunks and service recovery preflight.
- **Shared contracts:** `ProjectMemoryApplyJournal`, `ProjectMemoryExpectedWrite`, `ProjectMemoryObservedPromotion`, `ProjectMemoryApplyResult`.
- **Integration points:** run directory artifacts under `projects/<key>/runs/project-learn/<run-id>/`, canonical project paths under `projects/<key>/wiki` and `projects/<key>/state`.

## File Responsibility Map

**Create:**

- `src/project/project-memory-markdown-applier.ts` - owns staged output writes, journal creation/update, promotion, recovery, and helper methods later chunks will call.
- `tests/project/project-memory-markdown-applier.test.ts` - verifies staging, promotion order, terminal journal state, and recovery behavior.

**Modify:**

- `src/project/project-memory-apply-contracts.ts` - no planned edit; use local staged-write helper types in `project-memory-markdown-applier.ts` unless TypeScript export needs arise during implementation.

**Test:**

- `tests/project/project-memory-markdown-applier.test.ts` - synthetic write-set tests that do not require provider invocation.

## Implementation Tasks

### Task 1: Add Synthetic Staging Tests

**Files:**

- Create: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Add tests for staged promotion and state-last ordering**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectMemoryMarkdownApplier } from "../../src/project/project-memory-markdown-applier.ts";
import { readJson, writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-markdown-applier-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("promotes staged writes and records terminal apply journal", async () => {
  await seedProject();
  const run = await seedRun("run-1");
  const applier = new ProjectMemoryMarkdownApplier(root);

  const result = await applier.promoteStagedWrites({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-1",
    absolute_run_dir: run,
    curator_output_ref: "curator-creation-draft.json",
    staged_outputs_dir: join(run, "staged"),
    writes: [
      { canonical_project_path: "projects/demo/wiki/index.md", content: "# Demo\n", write_kind: "wiki_page" },
      { canonical_project_path: "projects/demo/state/project-memory.json", content: JSON.stringify({ status: "curated" }, null, 2) + "\n", write_kind: "project_state" },
    ],
  });

  expect(result.status).toBe("applied");
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toBe("# Demo\n");
  expect(JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8")).status).toBe("curated");

  const journal = await readJson(join(run, "project-memory-apply-journal.json"));
  expect(journal.status).toBe("applied");
  expect(journal.expected_writes.map((write: { write_kind: string }) => write.write_kind)).toEqual(["wiki_page", "project_state"]);
  expect(journal.observed_promotions).toHaveLength(2);
});
```

- [ ] **Step 2: Add tests for recovery before a new curator run**

```ts
test("recovers incomplete journals by completing missing promotions", async () => {
  await seedProject();
  const run = await seedRun("run-recovery");
  const applier = new ProjectMemoryMarkdownApplier(root);

  await applier.promoteStagedWrites({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-recovery",
    absolute_run_dir: run,
    curator_output_ref: "curator-creation-draft.json",
    staged_outputs_dir: join(run, "staged"),
    writes: [
      { canonical_project_path: "projects/demo/wiki/index.md", content: "# Demo\n", write_kind: "wiki_page" },
      { canonical_project_path: "projects/demo/state/project-memory.json", content: JSON.stringify({ status: "curated" }, null, 2) + "\n", write_kind: "project_state" },
    ],
    stop_after_promotions_for_test: 1,
  });

  const recovered = await applier.recoverFromJournal(join(run, "project-memory-apply-journal.json"));

  expect(recovered.status).toBe("applied");
  expect(JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8")).status).toBe("curated");
  const journal = await readJson(join(run, "project-memory-apply-journal.json"));
  expect(journal.status).toBe("recovered");
});
```

Add helpers:

```ts
async function seedProject(): Promise<void> {
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  await mkdir(join(root, "projects", "demo", "state"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "index.md"), "# Old\n", "utf8");
}

async function seedRun(id: string): Promise<string> {
  const run = join(root, "projects", "demo", "runs", "project-learn", id);
  await mkdir(run, { recursive: true });
  await writeJson(join(run, "input-packet.json"), { schema_version: 1, project_key: "demo" });
  await writeJson(join(run, "curator-creation-draft.json"), { schema_version: 1, project_key: "demo" });
  await writeJson(join(run, "curator-validation.json"), { ok: true, mode: "create", project_key: "demo" });
  return run;
}
```

- [ ] **Step 3: Run focused tests**

Run: `bun test tests/project/project-memory-markdown-applier.test.ts`

Expected: fails because `ProjectMemoryMarkdownApplier` does not exist.

### Task 2: Implement Staged Write Promotion

**Files:**

- Create: `src/project/project-memory-markdown-applier.ts`
- Review: `src/project/project-memory-apply-contracts.ts` remains unchanged for this task because staged-write helper types are local to the applier.

- [ ] **Step 1: Add staged write helper types**

In `src/project/project-memory-markdown-applier.ts`, implement these local types:

```ts
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ProjectMemoryApplyJournal,
  ProjectMemoryApplyResult,
  ProjectMemoryExpectedWrite,
  ProjectMemoryObservedPromotion,
} from "./project-memory-apply-contracts.ts";
import { ensureParentDir, resolveInside } from "../runtime/fs.ts";
import { readJson, writeJson } from "../runtime/json.ts";

type StagedWriteKind = ProjectMemoryExpectedWrite["write_kind"];

export type ProjectMemoryStagedWrite = {
  canonical_project_path: string;
  content: string;
  write_kind: StagedWriteKind;
};

export type PromoteStagedWritesInput = {
  project_key: string;
  run_dir: string;
  absolute_run_dir: string;
  curator_output_ref: string;
  staged_outputs_dir: string;
  writes: ProjectMemoryStagedWrite[];
  stop_after_promotions_for_test?: number;
};
```

- [ ] **Step 2: Implement class and promotion method**

```ts
export class ProjectMemoryMarkdownApplier {
  constructor(private readonly root: string) {}

  async promoteStagedWrites(input: PromoteStagedWritesInput): Promise<ProjectMemoryApplyResult> {
    const ordered = orderWrites(input.writes);
    await mkdir(input.staged_outputs_dir, { recursive: true });
    const expected: ProjectMemoryExpectedWrite[] = [];

    for (let index = 0; index < ordered.length; index += 1) {
      const write = ordered[index];
      const canonical = resolveInside(this.root, write.canonical_project_path);
      const stagedRef = `staged/${String(index + 1).padStart(3, "0")}-${write.write_kind}-${safeBasename(write.canonical_project_path)}`;
      const stagedPath = resolveInside(input.absolute_run_dir, stagedRef);
      await ensureParentDir(stagedPath);
      await writeFile(stagedPath, write.content, "utf8");
      expected.push({
        canonical_path: write.canonical_project_path,
        staged_output_ref: stagedRef,
        before_sha256: await sha256FileIfExists(canonical),
        write_order: index + 1,
        write_kind: write.write_kind,
      });
    }

    const journalPath = join(input.absolute_run_dir, "project-memory-apply-journal.json");
    const journal: ProjectMemoryApplyJournal = {
      schema_version: 1,
      project_key: input.project_key,
      run_dir: input.run_dir,
      status: "staged",
      packet_ref: "input-packet.json",
      curator_output_ref: input.curator_output_ref,
      validation_ref: "curator-validation.json",
      staged_outputs_dir: "staged",
      expected_writes: expected,
      observed_promotions: [],
      recovery: { required_before_new_curator: true },
    };
    await writeJson(journalPath, journal);

    return await this.promoteFromJournal(journalPath, input.stop_after_promotions_for_test);
  }

  async recoverFromJournal(journalPath: string): Promise<ProjectMemoryApplyResult> {
    return await this.promoteFromJournal(journalPath);
  }

  private async promoteFromJournal(journalPath: string, stopAfterPromotionsForTest?: number): Promise<ProjectMemoryApplyResult> {
    const journal = await readJson<ProjectMemoryApplyJournal>(journalPath);
    const runAbs = dirname(journalPath);
    const observed: ProjectMemoryObservedPromotion[] = [...journal.observed_promotions];
    await writeJson(journalPath, { ...journal, status: "promoting", observed_promotions: observed });

    for (const expected of journal.expected_writes.sort((a, b) => a.write_order - b.write_order)) {
      if (observed.some((promotion) => promotion.canonical_path === expected.canonical_path)) continue;
      const canonical = resolveInside(this.root, expected.canonical_path);
      const currentHash = await sha256FileIfExists(canonical);
      if (currentHash !== expected.before_sha256) {
        throw new Error(`Cannot recover Project Memory apply; canonical hash changed for ${expected.canonical_path}`);
      }
      const staged = resolveInside(runAbs, expected.staged_output_ref);
      await ensureParentDir(canonical);
      const tmpPath = `${canonical}.tmp-${process.pid}-${Date.now()}`;
      await copyFile(staged, tmpPath);
      await rename(tmpPath, canonical);
      observed.push({
        canonical_path: expected.canonical_path,
        after_sha256: await sha256File(canonical),
        promoted_at: new Date().toISOString(),
      });
      await writeJson(journalPath, { ...journal, status: "promoting", observed_promotions: observed });
      if (stopAfterPromotionsForTest && observed.length >= stopAfterPromotionsForTest) {
        return resultFor("failed", journal, observed, "stopped during test promotion");
      }
    }

    const terminalStatus = journal.status === "promoting" && journal.observed_promotions.length > 0 ? "recovered" : "applied";
    await writeJson(journalPath, {
      ...journal,
      status: terminalStatus,
      observed_promotions: observed,
      recovery: { required_before_new_curator: false },
    });
    return resultFor("applied", journal, observed);
  }
}
```

- [ ] **Step 3: Add helper functions**

```ts
function orderWrites(writes: ProjectMemoryStagedWrite[]): ProjectMemoryStagedWrite[] {
  const rank: Record<StagedWriteKind, number> = {
    wiki_page: 1,
    page_state: 2,
    log: 3,
    source_consumption_state: 4,
    project_state: 5,
  };
  return [...writes].sort((a, b) => rank[a.write_kind] - rank[b.write_kind] || a.canonical_project_path.localeCompare(b.canonical_project_path));
}

function safeBasename(path: string): string {
  return path.split("/").at(-1)?.replace(/[^a-zA-Z0-9._-]/g, "_") || "output";
}

async function sha256FileIfExists(path: string): Promise<string | null> {
  try {
    await stat(path);
    return await sha256File(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function resultFor(
  status: ProjectMemoryApplyResult["status"],
  journal: ProjectMemoryApplyJournal,
  observed: ProjectMemoryObservedPromotion[],
  reason?: string,
): ProjectMemoryApplyResult {
  return {
    status,
    applied_page_ids: [],
    applied_item_ids: [],
    skipped_page_ids: [],
    skipped_item_ids: [],
    failed_page_ids: [],
    failed_item_ids: [],
    changed_files: observed.map((promotion) => ({
      path: promotion.canonical_path,
      before_sha256: journal.expected_writes.find((write) => write.canonical_path === promotion.canonical_path)?.before_sha256 ?? null,
      after_sha256: promotion.after_sha256,
      operation: "update",
      page_ids: [],
      item_ids: [],
      staged_output_ref: journal.expected_writes.find((write) => write.canonical_path === promotion.canonical_path)?.staged_output_ref ?? "",
    })),
    state_updates: [],
    source_consumptions: [],
    artifacts: {
      apply_journal: "project-memory-apply-journal.json",
      apply_result: "project-memory-apply-result.json",
      changeset: "project-memory-changeset.json",
    },
    reason,
  };
}
```

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/project/project-memory-markdown-applier.test.ts`

Expected: exits `0`.

### Task 3: Make Recovery Detection Available To Service Integration

**Files:**

- Modify: `src/project/project-memory-markdown-applier.ts`
- Test: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Add journal discovery test**

```ts
test("finds incomplete apply journals for a project", async () => {
  await seedProject();
  const run = await seedRun("run-incomplete");
  await writeJson(join(run, "project-memory-apply-journal.json"), {
    schema_version: 1,
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-incomplete",
    status: "promoting",
    packet_ref: "input-packet.json",
    curator_output_ref: "curator-creation-draft.json",
    validation_ref: "curator-validation.json",
    staged_outputs_dir: "staged",
    expected_writes: [],
    observed_promotions: [],
    recovery: { required_before_new_curator: true },
  });

  const applier = new ProjectMemoryMarkdownApplier(root);
  const journals = await applier.findIncompleteApplyJournals("demo");

  expect(journals).toEqual([join(run, "project-memory-apply-journal.json")]);
});
```

- [ ] **Step 2: Implement discovery**

Add imports:

```ts
import { readdir } from "node:fs/promises";
```

Add method:

```ts
  async findIncompleteApplyJournals(projectKey: string): Promise<string[]> {
    const root = resolveInside(this.root, "projects", projectKey, "runs", "project-learn");
    let runDirs: string[];
    try {
      runDirs = await readdir(root);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const journals: string[] = [];
    for (const runDir of runDirs.sort()) {
      const journalPath = resolveInside(root, runDir, "project-memory-apply-journal.json");
      try {
        const journal = await readJson<ProjectMemoryApplyJournal>(journalPath);
        if (journal.recovery.required_before_new_curator || journal.status === "staged" || journal.status === "promoting") {
          journals.push(journalPath);
        }
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
        throw error;
      }
    }
    return journals;
  }
```

- [ ] **Step 3: Run focused tests**

Run: `bun test tests/project/project-memory-markdown-applier.test.ts`

Expected: exits `0`.

## Verification

Run:

```bash
bun test tests/project/project-memory-markdown-applier.test.ts
bun run typecheck
git diff --check
```

Expected:

- Applier tests pass.
- Typecheck exits `0`.
- Whitespace check exits `0`.

## Acceptance Criteria Covered

- Apply journal is written before canonical promotion.
- Canonical writes are staged and promoted in a controlled order.
- `project-memory.json` can be ordered last through write-kind ranking.
- Interrupted apply journals can be discovered and recovered deterministically.

## Risks And Rollback

- Risk: promotion helper may need stronger filesystem atomicity than copy-then-rename.
- Rollback: this chunk is isolated behind `promoteStagedWrites`; update that method without changing mode-specific apply callers.
- Risk: test-only stop hook could leak into production behavior.
- Rollback: keep the option named `stop_after_promotions_for_test` and pass it only from tests; do not expose it through service integration.

## Non-Goals

- Does not implement creation or maintenance write-set construction.
- Does not write apply result or changeset artifacts beyond the journal-focused result object.
- Does not integrate with `project learn`.
- Does not mutate source-consumption state.

## Type And Name Consistency

- Export `ProjectMemoryMarkdownApplier` from `src/project/project-memory-markdown-applier.ts`.
- Use `promoteStagedWrites`, `recoverFromJournal`, and `findIncompleteApplyJournals` as the shared method names for later chunks.
- Keep `project-memory-apply-journal.json` as the journal artifact filename.
