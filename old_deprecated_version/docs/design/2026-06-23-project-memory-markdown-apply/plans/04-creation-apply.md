# Chunk 04: Creation Apply

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-apply-payload-contracts-and-validation.md`, `02-markdown-entry-renderer-and-safe-mutation.md`, `03-apply-journal-staging-and-recovery.md`
**Enables:** `06-source-consumption-and-changeset-evidence.md`, `07-project-learn-service-integration.md`

## Goal

Implement creation-mode apply so a valid `ProjectMemoryCreationDraft` publishes the first trusted Project Memory wiki pages and writes curated `projects/<key>/state/project-memory.json` through the staged journal promotion path. This chunk does not yet wire creation apply into `project learn`; it exposes and tests the applier behavior directly.

## Source Artifacts

- `../spec.md`: Creation Apply, Data / State, Acceptance Criteria.
- `../agenda.md`: Question 2 and trusted-state audit refinement.
- `../pseudocode/ProjectLearnMarkdownApplyFlow.md`
- `../pseudocode/src/project/project-memory-markdown-applier.ts`
- `src/project/project-memory-apply-contracts.ts`
- `src/project/project-memory-markdown-renderer.ts`
- `src/project/project-memory-markdown-applier.ts`
- `src/runtime/project-shell.ts` for existing `project-memory.json` and `pages.json` state conventions.

## Relationships

- **Depends on:** structured payload contracts, renderer helpers, staged promotion.
- **Enables:** source-consumption/changset evidence and service integration.
- **Shared contracts:** creation requires index plus domain page/rationale and writes `project-memory.json` last.
- **Integration points:** project wiki files, `state/project-memory.json`, optional `state/pages.json`, run artifacts.

## File Responsibility Map

**Create:**

- No new production file required if `ProjectMemoryMarkdownApplier` owns creation apply.

**Modify:**

- `src/project/project-memory-markdown-applier.ts` - add `applyCreationDraft` method and creation write-set construction.
- `src/project/project-memory-apply-contracts.ts` - no planned edit; keep creation helper input local to `project-memory-markdown-applier.ts`.

**Test:**

- `tests/project/project-memory-markdown-applier.test.ts` - creation apply tests.

## Implementation Tasks

### Task 1: Add Creation Apply Tests

**Files:**

- Modify: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Add direct creation apply test**

```ts
test("applies creation drafts as trusted wiki pages and project memory state", async () => {
  await seedProject();
  const run = await seedRun("run-create");
  const applier = new ProjectMemoryMarkdownApplier(root);

  const result = await applier.applyCreationDraft({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-create",
    absolute_run_dir: run,
    draft: creationDraft(),
  });

  expect(result.status).toBe("applied");
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toContain("# Demo");
  expect(await readFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "utf8")).toContain("# Setup");
  const state = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8"));
  expect(state.status).toBe("curated");
  expect(state.source_run_dir).toBe("projects/demo/runs/project-learn/run-create");
});
```

- [ ] **Step 2: Add stopped-before-write tests for trusted-state and publication minimum**

```ts
test("rejects creation apply when project memory is already curated", async () => {
  await seedProject();
  await writeJson(join(root, "projects", "demo", "state", "project-memory.json"), { status: "curated" });
  const run = await seedRun("run-create-curated");
  const applier = new ProjectMemoryMarkdownApplier(root);

  const result = await applier.applyCreationDraft({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-create-curated",
    absolute_run_dir: run,
    draft: creationDraft(),
  });

  expect(result.status).toBe("skipped");
  expect(result.reason).toContain("already curated");
});

test("rejects creation apply without index plus domain page or rationale", async () => {
  await seedProject();
  const run = await seedRun("run-create-minimum");
  const draft = creationDraft();
  draft.pages = draft.pages.filter((page) => page.id === "page_index");
  const applier = new ProjectMemoryMarkdownApplier(root);

  const result = await applier.applyCreationDraft({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-create-minimum",
    absolute_run_dir: run,
    draft,
  });

  expect(result.status).toBe("skipped");
  expect(result.reason).toContain("publication minimum");
});
```

Add helper:

```ts
function creationDraft() {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "create" as const,
    packet_ref: {
      run_dir: "projects/demo/runs/project-learn/run-create",
      artifact: "input-packet.json" as const,
      packet_schema_version: 1 as const,
    },
    packet_context: { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } },
    summary: "Initial brain",
    brain_intent: {
      name: "Demo",
      first_brain_summary: "Create first brain",
      untrusted_existing_markdown_policy: "adopt" as const,
    },
    pages: [
      creationPage("page_index", "index.md", "Demo", "Project Memory index"),
      creationPage("page_setup", "setup/index.md", "Setup", "Setup workflows"),
    ],
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" as const },
    evidence_refs: [{ kind: "project_state" as const, ref: "bootstrap_state" }],
    repo_citations: [],
    risk: { level: "low" as const, reasons: [], requires_quarantine: false },
  };
}

function creationPage(id: string, path: string, title: string, purpose: string) {
  return {
    id,
    target: { path, path_kind: "new_wiki_page" as const },
    title,
    purpose,
    content_intent: `Create ${title}`,
    apply_payload: {
      schema_version: 1 as const,
      pages: [
        {
          page_path: path,
          title,
          purpose,
          body: { paragraphs: [`${title} describes ${purpose}.`] },
          evidence_refs: [{ kind: "project_state" as const, ref: "bootstrap_state" }],
          repo_citations: [],
          inference: {
            label: "initial_project_memory",
            why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
          },
        },
      ],
    },
    required_sections: ["Overview"],
    evidence_refs: [{ kind: "project_state" as const, ref: "bootstrap_state" }],
    repo_citations: [],
    notes_for_apply: [],
  };
}
```

- [ ] **Step 3: Run focused tests**

Run: `bun test tests/project/project-memory-markdown-applier.test.ts`

Expected: fails because `applyCreationDraft` does not exist.

### Task 2: Implement Creation Write-Set Construction

**Files:**

- Modify: `src/project/project-memory-markdown-applier.ts`

- [ ] **Step 1: Add imports**

```ts
import type { ProjectMemoryCreationDraft } from "./project-memory-curator-contracts.ts";
import { renderPageDraft } from "./project-memory-markdown-renderer.ts";
import { readJsonIfExists } from "../runtime/json.ts";
```

- [ ] **Step 2: Add input type**

```ts
export type ApplyCreationDraftInput = {
  project_key: string;
  run_dir: string;
  absolute_run_dir: string;
  draft: ProjectMemoryCreationDraft;
};
```

- [ ] **Step 3: Implement `applyCreationDraft`**

Add method to `ProjectMemoryMarkdownApplier`:

```ts
  async applyCreationDraft(input: ApplyCreationDraftInput): Promise<ProjectMemoryApplyResult> {
    const existingState = await readJsonIfExists<{ status?: string }>(
      resolveInside(this.root, "projects", input.project_key, "state", "project-memory.json"),
    );
    if (existingState?.status === "curated") {
      return skippedResult("creation apply skipped: project memory is already curated");
    }
    if (!creationPublicationMinimumMet(input.draft)) {
      return skippedResult("creation apply skipped: publication minimum not met");
    }
    if (!input.draft.state_intent.mark_project_memory_curated) {
      return skippedResult("creation apply skipped: curated state intent missing");
    }

    const writes: ProjectMemoryStagedWrite[] = [];
    for (const page of input.draft.pages) {
      const payloadPage = page.apply_payload?.pages?.find((draftPage) => draftPage.page_path === page.target.path);
      if (!payloadPage) return skippedResult(`creation apply skipped: missing page payload for ${page.id}`);
      writes.push({
        canonical_project_path: `projects/${input.project_key}/wiki/${page.target.path}`,
        content: renderPageDraft(payloadPage),
        write_kind: "wiki_page",
      });
    }

    writes.push({
      canonical_project_path: `projects/${input.project_key}/state/project-memory.json`,
      content: `${JSON.stringify(
        {
          project_key: input.project_key,
          source_run_dir: input.run_dir,
          status: "curated",
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      write_kind: "project_state",
    });

    return await this.promoteStagedWrites({
      project_key: input.project_key,
      run_dir: input.run_dir,
      absolute_run_dir: input.absolute_run_dir,
      curator_output_ref: "curator-creation-draft.json",
      staged_outputs_dir: resolveInside(input.absolute_run_dir, "staged"),
      writes,
    });
  }
```

Add helpers:

```ts
function creationPublicationMinimumMet(draft: ProjectMemoryCreationDraft): boolean {
  const hasIndex = draft.pages.some((page) => page.target.path === "index.md");
  const hasDomainPage = draft.pages.some((page) => page.target.path !== "index.md");
  const hasRationale = draft.pages.some((page) => page.notes_for_apply.some((note) => note.includes("no-domain-pages")));
  return hasIndex && (hasDomainPage || hasRationale);
}

function skippedResult(reason: string): ProjectMemoryApplyResult {
  return {
    status: "skipped",
    applied_page_ids: [],
    applied_item_ids: [],
    skipped_page_ids: [],
    skipped_item_ids: [],
    failed_page_ids: [],
    failed_item_ids: [],
    changed_files: [],
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

If `skippedResult` already exists from chunk 03 implementation, extend that helper rather than duplicating it.

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/project/project-memory-markdown-applier.test.ts`

Expected: exits `0`.

### Task 3: Add Pages Manifest Write If Existing Convention Is Present

**Files:**

- Modify: `src/project/project-memory-markdown-applier.ts`
- Test: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Add assertion to creation test**

In the successful creation apply test, add:

```ts
  const pages = JSON.parse(await readFile(join(root, "projects", "demo", "state", "pages.json"), "utf8"));
  expect(pages.pages).toContain("wiki/index.md");
  expect(pages.pages).toContain("wiki/setup/index.md");
```

- [ ] **Step 2: Add pages manifest staged write**

Before the `project-memory.json` write in `applyCreationDraft`, add:

```ts
    writes.push({
      canonical_project_path: `projects/${input.project_key}/state/pages.json`,
      content: `${JSON.stringify(
        {
          project_key: input.project_key,
          pages: input.draft.pages.map((page) => `wiki/${page.target.path}`).sort(),
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      write_kind: "page_state",
    });
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

- Creation apply tests pass.
- Typecheck exits `0`.
- Whitespace check exits `0`.

## Acceptance Criteria Covered

- Valid creation drafts can publish bounded Project Memory wiki pages.
- Creation apply writes curated project-memory state with provenance-backed pages.
- Creation apply requires index plus domain page or explicit rationale.
- Preexisting untrusted state cannot be treated as maintenance-ready.

## Risks And Rollback

- Risk: using `new Date()` makes tests brittle if they assert exact timestamp.
- Rollback: tests should assert presence/shape, not exact timestamp, until service integration passes `now`.
- Risk: manifest shape may need to preserve existing pages instead of replacing them.
- Rollback: update pages manifest construction in this method without changing renderer or journal code.

## Non-Goals

- Does not integrate creation apply into `project learn`.
- Does not implement maintenance operations.
- Does not write source-consumption records or changesets beyond journal result data.
- Does not mutate candidate or handoff status.

## Type And Name Consistency

- Use `applyCreationDraft` as the applier entrypoint for creation mode.
- Keep `ProjectMemoryCreationDraft` as the input contract.
- Keep `project-memory.json` state status as `curated`.
