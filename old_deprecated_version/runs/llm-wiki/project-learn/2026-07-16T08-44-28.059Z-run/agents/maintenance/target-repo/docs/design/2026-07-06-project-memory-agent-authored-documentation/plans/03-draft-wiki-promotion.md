# Chunk 03: Draft Wiki Promotion

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `01-contracts-state-and-cli-surface.md`  
**Enables:** `04-agent-authored-create-mode.md`, `05-agent-authored-maintenance-mode.md`, `06-project-learn-composition-and-recreate.md`, `07-retrieval-and-legacy-curator-cleanup.md`

## Goal

Add the filesystem promotion path for agent-authored draft wikis. The new helper stages markdown, state, source-consumption state, and log writes through the existing apply journal before canonical promotion. It must preserve ADR 0060 journal recovery while removing the requirement that create mode produce structured page payloads.

## Source Artifacts

- `../spec.md`: canonical promotion, state v2, draft wiki, maintenance report.
- `../../../adr/0060-use-apply-journal-for-project-memory-writes.md`.
- `../../../adr/0067-use-agent-authored-project-memory-documentation.md`.
- Current code:
  - `src/project/project-memory-markdown-applier.ts`
  - `src/project/project-memory-apply-contracts.ts`
  - `src/project/project-memory-agent-contracts.ts` from chunk `01`
  - `tests/project/project-memory-markdown-applier.test.ts`

## Relationships

- **Depends on:** chunk `01` for state/report types.
- **Enables:** create and maintenance services to promote completed draft directories safely.
- **Shared contracts:** `promoteDraftWiki`, `ProjectMemoryDraftPromotionInput`, `ProjectMemoryDraftPromotionResult`, state v2 writer.
- **Integration points:** existing `ProjectMemoryMarkdownApplier.promoteStagedWrites`, apply journal recovery, canonical `projects/<key>/wiki/`, `projects/<key>/state/project-memory.json`, `projects/<key>/state/project-memory-source-consumptions.json`.

## File Responsibility Map

**Create:**
- `src/project/project-memory-draft-promotion.ts` - draft tree scanning, destructive-change guard, state v2 serialization, source consumption serialization, and call into `promoteStagedWrites`.
- `tests/project/project-memory-draft-promotion.test.ts` - draft promotion behavior without structured curator payloads.

**Modify:**
- `src/project/project-memory-markdown-applier.ts` - export or keep `ProjectMemoryStagedWrite` usable by the new helper; no behavior change to `promoteStagedWrites`.
- `src/project/project-memory-apply-contracts.ts` - add `agent_draft_wiki` or `agent_maintenance` refs only if needed by result metadata.

**Test:**
- `tests/project/project-memory-markdown-applier.test.ts` - existing journal tests keep passing.

## Implementation Tasks

### Task 1: Promote Markdown Files From A Draft Wiki

**Files:**
- Create: `src/project/project-memory-draft-promotion.ts`
- Test: `tests/project/project-memory-draft-promotion.test.ts`

- [ ] **Step 1: Add draft promotion test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  promoteDraftWiki,
  type ProjectMemoryDraftPromotionInput,
} from "../../src/project/project-memory-draft-promotion.ts";

describe("promoteDraftWiki", () => {
  test("promotes draft markdown and v2 state through the apply journal", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-1");
    const draftWiki = join(runDir, "agents", "create", "draft-wiki");
    await mkdir(draftWiki, { recursive: true });
    await writeFile(join(draftWiki, "index.md"), "# Demo\n\n- [Runtime](runtime.md)\n", "utf8");
    await writeFile(join(draftWiki, "runtime.md"), "# Runtime\n\nHow the runtime works.\n", "utf8");

    const result = await promoteDraftWiki({
      root,
      projectKey: "demo",
      runDir: "projects/demo/runs/project-learn/run-1",
      absoluteRunDir: runDir,
      mode: "create",
      draftWikiDir: draftWiki,
      curatorOutputRef: "documentation-create-result.json",
      state: {
        schema_version: 2,
        project_key: "demo",
        status: "curated",
        source_run_dir: "projects/demo/runs/project-learn/run-1",
        updated_at: "2026-07-06T00:00:00.000Z",
        provider_mode: "stub",
        curation_kind: "agent_authored",
        run_kind: "create",
        create: {
          status: "completed",
          planner_status: "completed",
          subject_writer_status: "completed",
          subject_count: 0,
          subject_writer_concurrency_limit: 4,
          subject_writer_retry_limit: 1,
          subject_report_refs: [],
        },
        retrieval_readiness: { status: "pending", checked_at: "2026-07-06T00:00:00.000Z" },
        content_quality: {
          status: "not_evaluated",
          reason: "agent_authored_documentation_has_no_schema_quality_gate",
        },
      },
      sourceConsumptions: [],
    });

    expect(result.status).toBe("applied");
    expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toContain("# Demo");
    const state = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8"));
    expect(state.schema_version).toBe(2);
    expect(state.content_quality.status).toBe("not_evaluated");
  });
});
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/project/project-memory-draft-promotion.test.ts`  
Expected: fails because `promoteDraftWiki` does not exist.

- [ ] **Step 3: Implement input/result types**

```ts
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { resolveInside } from "../runtime/fs.ts";
import type { ProjectMemoryAgentStateV2 } from "./project-memory-agent-contracts.ts";
import type {
  ProjectMemoryApplyResult,
  ProjectMemorySourceConsumptionRecord,
} from "./project-memory-apply-contracts.ts";
import {
  ProjectMemoryMarkdownApplier,
  type ProjectMemoryStagedWrite,
} from "./project-memory-markdown-applier.ts";

export type ProjectMemoryDraftPromotionInput = {
  root: string;
  projectKey: string;
  runDir: string;
  absoluteRunDir: string;
  mode: "create" | "maintain";
  draftWikiDir: string;
  curatorOutputRef: string;
  state: ProjectMemoryAgentStateV2;
  sourceConsumptions: ProjectMemorySourceConsumptionRecord[];
};

export type ProjectMemoryDraftPromotionResult = ProjectMemoryApplyResult;
```

- [ ] **Step 4: Implement markdown staging**

```ts
export async function promoteDraftWiki(input: ProjectMemoryDraftPromotionInput): Promise<ProjectMemoryDraftPromotionResult> {
  const markdownWrites = await draftMarkdownWrites(input.root, input.projectKey, input.draftWikiDir);
  assertDraftPublicationMinimum(markdownWrites);
  const writes: ProjectMemoryStagedWrite[] = [
    ...markdownWrites,
    {
      canonical_project_path: `projects/${input.projectKey}/state/project-memory.json`,
      content: `${JSON.stringify(input.state, null, 2)}\n`,
      write_kind: "project_state",
    },
    {
      canonical_project_path: `projects/${input.projectKey}/state/project-memory-source-consumptions.json`,
      content: `${JSON.stringify({
        schema_version: 1,
        project_key: input.projectKey,
        records: input.sourceConsumptions,
      }, null, 2)}\n`,
      write_kind: "source_consumption_state",
    },
  ];

  return await new ProjectMemoryMarkdownApplier(input.root).promoteStagedWrites({
    project_key: input.projectKey,
    run_dir: input.runDir,
    mode: input.mode,
    absolute_run_dir: input.absoluteRunDir,
    curator_output_ref: input.curatorOutputRef,
    staged_outputs_dir: join(input.absoluteRunDir, "staged"),
    writes,
  });
}
```

### Task 2: Add Draft Safety Checks

**Files:**
- Modify: `src/project/project-memory-draft-promotion.ts`
- Test: `tests/project/project-memory-draft-promotion.test.ts`

- [ ] **Step 1: Add safety tests**

```ts
test("rejects a draft without index markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
  const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-2");
  const draftWiki = join(runDir, "agents", "create", "draft-wiki");
  await mkdir(draftWiki, { recursive: true });
  await writeFile(join(draftWiki, "runtime.md"), "# Runtime\n", "utf8");

  await expect(promoteDraftWiki(validInput(root, runDir, draftWiki))).rejects.toThrow("draft wiki must include index.md");
});

test("rejects markdown paths that escape the draft wiki", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
  const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-3");
  const draftWiki = join(runDir, "agents", "create", "draft-wiki");
  await mkdir(join(draftWiki, "nested"), { recursive: true });
  await writeFile(join(draftWiki, "index.md"), "# Demo\n", "utf8");
  await writeFile(join(draftWiki, "nested", "topic.md"), "# Topic\n", "utf8");

  const result = await promoteDraftWiki(validInput(root, runDir, draftWiki));
  expect(result.changed_files.map((file) => file.path)).toContain("projects/demo/wiki/nested/topic.md");
});

function validInput(root: string, runDir: string, draftWiki: string): ProjectMemoryDraftPromotionInput {
  return {
    root,
    projectKey: "demo",
    runDir: relative(root, runDir),
    absoluteRunDir: runDir,
    mode: "create",
    draftWikiDir: draftWiki,
    curatorOutputRef: "documentation-create-result.json",
    state: {
      schema_version: 2,
      project_key: "demo",
      status: "curated",
      source_run_dir: relative(root, runDir),
      updated_at: "2026-07-06T00:00:00.000Z",
      provider_mode: "stub",
      curation_kind: "agent_authored",
      run_kind: "create",
      create: {
        status: "completed",
        planner_status: "completed",
        subject_writer_status: "completed",
        subject_count: 0,
        subject_writer_concurrency_limit: 4,
        subject_writer_retry_limit: 1,
        subject_report_refs: [],
      },
      retrieval_readiness: { status: "pending", checked_at: "2026-07-06T00:00:00.000Z" },
      content_quality: {
        status: "not_evaluated",
        reason: "agent_authored_documentation_has_no_schema_quality_gate",
      },
    },
    sourceConsumptions: [],
  };
}
```

- [ ] **Step 2: Implement scanning and guards**

```ts
async function draftMarkdownWrites(root: string, projectKey: string, draftWikiDir: string): Promise<ProjectMemoryStagedWrite[]> {
  const files = (await listMarkdownFiles(draftWikiDir)).sort();
  const relativePaths = files.map((file) => relative(draftWikiDir, file));
  if (!relativePaths.includes("index.md")) throw new Error("draft wiki must include index.md");
  return await Promise.all(files.map(async (file) => {
    const relativePath = relative(draftWikiDir, file);
    if (relativePath.startsWith("..")) throw new Error(`draft markdown escaped draft wiki: ${file}`);
    return {
      canonical_project_path: `projects/${projectKey}/wiki/${relativePath}`,
      content: await readFile(file, "utf8"),
      write_kind: "wiki_page" as const,
      page_ids: [relativePath],
    };
  }));
}

function assertDraftPublicationMinimum(writes: ProjectMemoryStagedWrite[]): void {
  const markdown = writes.filter((write) => write.write_kind === "wiki_page");
  if (!markdown.some((write) => write.canonical_project_path.endsWith("/index.md"))) {
    throw new Error("draft wiki must include index.md");
  }
  if (markdown.length < 1) throw new Error("draft wiki must include at least one markdown page");
}
```

This is not a content-quality gate. It verifies only that the agent produced a navigable markdown wiki root.

- [ ] **Step 3: Run draft promotion tests**

Run: `bun test tests/project/project-memory-draft-promotion.test.ts`  
Expected: passes.

### Task 3: Preserve Existing Journal Recovery Tests

**Files:**
- Modify: `src/project/project-memory-markdown-applier.ts` only if exported types are not currently importable.
- Test: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Export staged write type if needed**

If `ProjectMemoryStagedWrite` is already exported, leave this file unchanged. If not, export it:

```ts
export type ProjectMemoryStagedWrite = {
  canonical_project_path: string;
  content: string;
  write_kind: StagedWriteKind;
  page_ids?: string[];
  item_ids?: string[];
};
```

- [ ] **Step 2: Run existing applier tests**

Run: `bun test tests/project/project-memory-markdown-applier.test.ts`  
Expected: existing journal recovery and staged promotion tests pass.

## Verification

- Run: `bun test tests/project/project-memory-draft-promotion.test.ts`  
  Expected: pass.
- Run: `bun test tests/project/project-memory-markdown-applier.test.ts`  
  Expected: pass; existing `applyCreationDraft` tests may remain until chunk `07` replaces old-path expectations.
- Run: `bun run typecheck`  
  Expected: pass.

## Acceptance Criteria Covered

- Agent-authored markdown can be promoted without structured page payloads.
- `projects/<key>/wiki/index.md` remains required as the navigable wiki root.
- `projects/<key>/state/project-memory.json` is written as schema v2.
- Source consumption records can be staged with the same journal as wiki writes.
- Existing apply journal behavior remains the canonical write path.

## Risks And Rollback

- Risk: promotion may overwrite canonical pages produced by a previous run. Mitigation is chunk `06` deciding create vs maintenance and only passing the correct draft tree.
- Risk: a bad agent can create a sparse but syntactically valid wiki. That is accepted by design and evaluated in dogfood, not by schema-quality gates.
- Rollback: remove `project-memory-draft-promotion.ts`; old structured applier remains available until chunk `07`.

## Non-Goals

- Does not decide when create or maintenance should run.
- Does not invoke any provider.
- Does not score markdown quality, citation density, section count, or answer-domain coverage.
- Does not delete canonical wiki pages absent from the draft.

## Type And Name Consistency

- Promotion function: `promoteDraftWiki`.
- Input type: `ProjectMemoryDraftPromotionInput`.
- State type: `ProjectMemoryAgentStateV2`.
- Required draft page: `index.md`.
