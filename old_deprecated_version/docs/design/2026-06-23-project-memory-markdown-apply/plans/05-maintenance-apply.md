# Chunk 05: Maintenance Apply

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-apply-payload-contracts-and-validation.md`, `02-markdown-entry-renderer-and-safe-mutation.md`, `03-apply-journal-staging-and-recovery.md`
**Enables:** `06-source-consumption-and-changeset-evidence.md`, `07-project-learn-service-integration.md`

## Goal

Implement maintenance-mode apply so eligible `ProjectMemoryMaintenanceProposal` items update existing Project Memory wiki pages through deterministic entry-block operations. This chunk supports the initial operation set, requires trusted `project-memory.json.status === "curated"`, and uses staged journal promotion.

## Source Artifacts

- `../spec.md`: Maintenance Apply, Markdown Shape, Error Handling.
- `../agenda.md`: Questions 1, 3, 4, 5, and trusted-state audit refinement.
- `../pseudocode/ProjectMemoryEntryBlockFormat.md`
- `../pseudocode/ProjectLearnMarkdownApplyFlow.md`
- `../pseudocode/src/project/project-memory-markdown-applier.ts`
- `src/project/project-memory-markdown-renderer.ts`
- `src/project/project-memory-markdown-applier.ts`
- `src/project/project-memory-curator-contracts.ts`
- `tests/project/project-memory-markdown-applier.test.ts`

## Relationships

- **Depends on:** contracts, renderer, and journal staging.
- **Enables:** changesets, source-consumption records, and service integration.
- **Shared contracts:** maintenance operation semantics and trusted-state predicate.
- **Integration points:** existing wiki pages and `state/project-memory.json`.

## File Responsibility Map

**Create:**

- No new production file required if `ProjectMemoryMarkdownApplier` owns maintenance apply.

**Modify:**

- `src/project/project-memory-markdown-applier.ts` - add `applyMaintenanceProposal` and operation dispatch.

**Test:**

- `tests/project/project-memory-markdown-applier.test.ts` - maintenance operation tests.

## Implementation Tasks

### Task 1: Add Maintenance Apply Tests

**Files:**

- Modify: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Add success test for CREATE_ENTRY and PATCH_ENTRY**

```ts
test("applies maintenance CREATE_ENTRY and PATCH_ENTRY to existing wiki pages", async () => {
  await seedCuratedProject();
  const run = await seedRun("run-maintain");
  const applier = new ProjectMemoryMarkdownApplier(root);

  const createResult = await applier.applyMaintenanceProposal({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-maintain",
    absolute_run_dir: run,
    proposal: maintenanceProposal([maintenanceItem("create_setup", "CREATE_ENTRY")]),
    eligible_item_ids: ["create_setup"],
  });

  expect(createResult.status).toBe("applied");
  expect(await readFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "utf8")).toContain('id="setup.cli"');

  const patchRun = await seedRun("run-maintain-patch");
  const patchResult = await applier.applyMaintenanceProposal({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-maintain-patch",
    absolute_run_dir: patchRun,
    proposal: maintenanceProposal([maintenanceItem("patch_setup", "PATCH_ENTRY", { body: { paragraphs: ["Updated CLI command behavior."] } })]),
    eligible_item_ids: ["patch_setup"],
  });

  expect(patchResult.status).toBe("applied");
  const page = await readFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "utf8");
  expect(page).toContain("Updated CLI command behavior.");
  expect(page).not.toContain("Document CLI setup command.");
});
```

- [ ] **Step 2: Add lifecycle operation tests**

```ts
test("applies lifecycle maintenance operations without deleting entry history", async () => {
  await seedCuratedProject();
  const applier = new ProjectMemoryMarkdownApplier(root);
  const createRun = await seedRun("run-lifecycle-create");
  await applier.applyMaintenanceProposal({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-lifecycle-create",
    absolute_run_dir: createRun,
    proposal: maintenanceProposal([maintenanceItem("create_setup", "CREATE_ENTRY")]),
    eligible_item_ids: ["create_setup"],
  });

  const staleRun = await seedRun("run-lifecycle-stale");
  const staleResult = await applier.applyMaintenanceProposal({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-lifecycle-stale",
    absolute_run_dir: staleRun,
    proposal: maintenanceProposal([maintenanceItem("stale_setup", "MARK_STALE", { lifecycle: "stale_pending" })]),
    eligible_item_ids: ["stale_setup"],
  });

  expect(staleResult.status).toBe("applied");
  const page = await readFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "utf8");
  expect(page).toContain('id="setup.cli" lifecycle="stale_pending"');
  expect(page).toContain("Lifecycle:");
});
```

- [ ] **Step 3: Add stop tests**

```ts
test("skips maintenance apply without trusted project-memory state", async () => {
  await seedProject();
  const run = await seedRun("run-maintain-untrusted");
  const applier = new ProjectMemoryMarkdownApplier(root);

  const result = await applier.applyMaintenanceProposal({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-maintain-untrusted",
    absolute_run_dir: run,
    proposal: maintenanceProposal([maintenanceItem("create_setup", "CREATE_ENTRY")]),
    eligible_item_ids: ["create_setup"],
  });

  expect(result.status).toBe("skipped");
  expect(result.reason).toContain("trusted Project Memory state");
});

test("skips maintenance apply when target page is missing", async () => {
  await seedCuratedProject();
  const run = await seedRun("run-maintain-missing-page");
  const proposal = maintenanceProposal([maintenanceItem("missing_page", "CREATE_ENTRY")]);
  proposal.items[0].target_page.path = "missing/index.md";
  const applier = new ProjectMemoryMarkdownApplier(root);

  const result = await applier.applyMaintenanceProposal({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-maintain-missing-page",
    absolute_run_dir: run,
    proposal,
    eligible_item_ids: ["missing_page"],
  });

  expect(result.status).toBe("skipped");
  expect(result.reason).toContain("target page is missing");
});
```

Add helpers:

```ts
async function seedCuratedProject(): Promise<void> {
  await seedProject();
  await writeJson(join(root, "projects", "demo", "state", "project-memory.json"), { status: "curated" });
  await mkdir(join(root, "projects", "demo", "wiki", "setup"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "# Setup\n", "utf8");
}

function maintenanceProposal(items: ReturnType<typeof maintenanceItem>[]) {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain" as const,
    packet_ref: {
      run_dir: "projects/demo/runs/project-learn/run-maintain",
      artifact: "input-packet.json" as const,
      packet_schema_version: 1 as const,
    },
    packet_context: { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } },
    summary: "maintenance",
    items,
    noop_inputs: [],
    risk: { level: "low" as const, reasons: [], requires_quarantine: false },
  };
}

function maintenanceItem(id: string, operation: string, overrides: { body?: { paragraphs: string[] }; lifecycle?: string } = {}) {
  const lifecycle = overrides.lifecycle ?? "active";
  return {
    id,
    operation,
    target_page: { path: "setup/index.md", path_kind: "existing_wiki_page" as const },
    target_entry_id: operation === "CREATE_ENTRY" ? undefined : "setup.cli",
    proposed_entry_id: operation === "CREATE_ENTRY" ? "setup.cli" : undefined,
    content_intent: "Document CLI setup command.",
    apply_payload: {
      schema_version: 1 as const,
      entries: [
        {
          entry_id: "setup.cli",
          title: "Setup CLI",
          body: overrides.body ?? { paragraphs: ["Document CLI setup command."] },
          lifecycle,
          evidence_refs: [{ kind: "project_candidate" as const, ref: "cand_1", note: "durable setup" }],
          repo_citations: [{ path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" }],
          applicability: { commands: ["myelin project learn demo"] },
        },
      ],
    },
    source_packet_refs: [{ kind: "project_candidate" as const, ref: "cand_1" }],
    evidence_refs: [{ kind: "project_candidate" as const, ref: "cand_1" }],
    repo_citations: [{ path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" }],
    applicability: { commands: ["myelin project learn demo"] },
    lifecycle_intent: lifecycle,
    risk: { level: "low" as const, reasons: [], requires_quarantine: false },
    preconditions: ["setup page exists"],
    expected_outcome: "setup page changes",
  };
}
```

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/project/project-memory-markdown-applier.test.ts`

Expected: fails because `applyMaintenanceProposal` does not exist.

### Task 2: Implement Maintenance Apply Dispatch

**Files:**

- Modify: `src/project/project-memory-markdown-applier.ts`

- [ ] **Step 1: Add imports and input type**

```ts
import { readFile } from "node:fs/promises";
import type { ProjectMemoryMaintenanceProposal, ProjectMemoryMaintenanceProposalItem } from "./project-memory-curator-contracts.ts";
import { findEntryBlock, renderEntryBlock, updateEntryLifecycle, upsertEntryBlock } from "./project-memory-markdown-renderer.ts";
```

```ts
export type ApplyMaintenanceProposalInput = {
  project_key: string;
  run_dir: string;
  absolute_run_dir: string;
  proposal: ProjectMemoryMaintenanceProposal;
  eligible_item_ids: string[];
};
```

- [ ] **Step 2: Implement trusted-state and target checks**

Add method to `ProjectMemoryMarkdownApplier`:

```ts
  async applyMaintenanceProposal(input: ApplyMaintenanceProposalInput): Promise<ProjectMemoryApplyResult> {
    const projectMemory = await readJsonIfExists<{ status?: string }>(
      resolveInside(this.root, "projects", input.project_key, "state", "project-memory.json"),
    );
    if (projectMemory?.status !== "curated") {
      return skippedResult("maintenance apply skipped: trusted Project Memory state is missing");
    }

    const pageUpdates = new Map<string, string>();
    const appliedItemIds: string[] = [];
    for (const item of input.proposal.items.filter((entry) => input.eligible_item_ids.includes(entry.id))) {
      const target = resolveInside(this.root, "projects", input.project_key, "wiki", item.target_page.path);
      let pageText: string;
      try {
        pageText = pageUpdates.get(item.target_page.path) ?? (await readFile(target, "utf8"));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          return skippedResult(`maintenance apply skipped: target page is missing: ${item.target_page.path}`);
        }
        throw error;
      }
      pageUpdates.set(item.target_page.path, applyMaintenanceItem(pageText, item));
      if (item.operation !== "NOOP") appliedItemIds.push(item.id);
    }

    if (pageUpdates.size === 0) return skippedResult("maintenance apply skipped: no eligible mutation items");

    return await this.promoteStagedWrites({
      project_key: input.project_key,
      run_dir: input.run_dir,
      absolute_run_dir: input.absolute_run_dir,
      curator_output_ref: "curator-maintenance-proposal.json",
      staged_outputs_dir: resolveInside(input.absolute_run_dir, "staged"),
      writes: [...pageUpdates.entries()].map(([path, content]) => ({
        canonical_project_path: `projects/${input.project_key}/wiki/${path}`,
        content,
        write_kind: "wiki_page" as const,
      })),
    });
  }
```

- [ ] **Step 3: Implement operation helper**

```ts
function applyMaintenanceItem(pageText: string, item: ProjectMemoryMaintenanceProposalItem): string {
  if (item.operation === "NOOP") return pageText;
  const entry = item.apply_payload?.entries?.[0];
  if (!entry) throw new Error(`Maintenance item ${item.id} has no entry apply payload`);
  if (item.operation === "CREATE_ENTRY") {
    return upsertEntryBlock(pageText, entry.entry_id, renderEntryBlock(entry));
  }
  if (item.operation === "PATCH_ENTRY") {
    const targetId = item.target_entry_id ?? entry.entry_id;
    if (!findEntryBlock(pageText, targetId)) throw new Error(`Missing Project Memory entry block: ${targetId}`);
    return upsertEntryBlock(pageText, targetId, renderEntryBlock({ ...entry, entry_id: targetId }));
  }
  if (item.operation === "ATTACH_EVIDENCE") {
    const targetId = item.target_entry_id ?? entry.entry_id;
    const block = findEntryBlock(pageText, targetId);
    if (!block) throw new Error(`Missing Project Memory entry block: ${targetId}`);
    const evidenceBlock = renderEntryBlock({ ...entry, entry_id: targetId });
    return upsertEntryBlock(pageText, targetId, evidenceBlock);
  }
  if (
    item.operation === "MARK_STALE" ||
    item.operation === "MARK_DISPUTED" ||
    item.operation === "SUPERSEDE_ENTRY" ||
    item.operation === "RETRACT_ENTRY"
  ) {
    const targetId = item.target_entry_id ?? entry.entry_id;
    return updateEntryLifecycle(pageText, targetId, entry.lifecycle, renderLifecycleNote(item));
  }
  throw new Error(`Unsupported maintenance operation: ${item.operation}`);
}

function renderLifecycleNote(item: ProjectMemoryMaintenanceProposalItem): string {
  return [
    `- Operation: ${item.operation}`,
    `- Expected outcome: ${item.expected_outcome}`,
    ...item.evidence_refs.map((ref) => `- Evidence: ${ref.kind}:${ref.ref}${ref.note ? ` - ${ref.note}` : ""}`),
    ...item.repo_citations.map((citation) => `- Repo: ${citation.path}${citation.line_start ? `:${citation.line_start}${citation.line_end ? `-${citation.line_end}` : ""}` : ""} - ${citation.reason}`),
  ].join("\n");
}
```

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/project/project-memory-markdown-applier.test.ts`

Expected: exits `0`.

### Task 3: Preserve Applied Item IDs In Result

**Files:**

- Modify: `src/project/project-memory-markdown-applier.ts`
- Modify: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Add result assertion**

In the CREATE_ENTRY maintenance test, add:

```ts
  expect(createResult.applied_item_ids).toEqual(["create_setup"]);
```

- [ ] **Step 2: Carry applied ids after promotion**

After `promoteStagedWrites` returns in `applyMaintenanceProposal`, merge ids:

```ts
    const result = await this.promoteStagedWrites({
      project_key: input.project_key,
      run_dir: input.run_dir,
      absolute_run_dir: input.absolute_run_dir,
      curator_output_ref: "curator-maintenance-proposal.json",
      staged_outputs_dir: resolveInside(input.absolute_run_dir, "staged"),
      writes: [...pageUpdates.entries()].map(([path, content]) => ({
        canonical_project_path: `projects/${input.project_key}/wiki/${path}`,
        content,
        write_kind: "wiki_page" as const,
      })),
    });
    return { ...result, applied_item_ids: appliedItemIds };
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

- Maintenance apply tests pass.
- Typecheck exits `0`.
- Whitespace check exits `0`.

## Acceptance Criteria Covered

- Valid low-risk maintenance proposals update targeted Project Memory wiki pages.
- Maintenance targets existing pages only.
- Lifecycle operations preserve entry history and provenance.
- Maintenance apply requires trusted `project-memory.json.status === "curated"`.

## Risks And Rollback

- Risk: `ATTACH_EVIDENCE` as full block replacement may be too broad.
- Rollback: refine only `applyMaintenanceItem` for that operation; the surrounding staged write and service contracts remain unchanged.
- Risk: operation helper throws for missing entries, which service integration should convert to stopped-before-writes.
- Rollback: wrap operation dispatch in a result-returning helper during service integration before exposing maintenance apply through `project learn`.

## Non-Goals

- Does not write source-consumption records.
- Does not write changeset snippets.
- Does not integrate with `project learn`.
- Does not mutate candidate or handoff lifecycle statuses.
- Does not support new-page maintenance operations.

## Type And Name Consistency

- Use `applyMaintenanceProposal` as the applier entrypoint for maintenance mode.
- Use existing operation names from `PROJECT_MEMORY_MAINTENANCE_OPERATIONS`.
- Preserve `target_entry_id` for existing entries and `proposed_entry_id` for `CREATE_ENTRY`.
