# Chunk 06: Source Consumption And Changeset Evidence

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `03-apply-journal-staging-and-recovery.md`, `04-creation-apply.md`, `05-maintenance-apply.md`
**Enables:** `07-project-learn-service-integration.md`

## Goal

Write inspectable Project Memory apply evidence: bounded changesets and project-level Project Memory Source Consumption records. This chunk must not mutate candidate or handoff statuses; it only records consumed source refs, terminal apply decisions, and output refs for a later reconciler.

## Source Artifacts

- `../spec.md`: Apply Artifacts, Data / State, Acceptance Criteria.
- `../agenda.md`: Questions 4, 5, and 6.
- `../pseudocode/ProjectApplyGateBoundary.md`
- `../pseudocode/src/project/project-memory-apply-contracts.ts`
- `../../../../CONTEXT.md`: Project Memory Source Consumption.
- `src/project/project-memory-apply-contracts.ts`
- `src/project/project-memory-markdown-renderer.ts`
- `src/project/project-memory-markdown-applier.ts`
- `src/runtime/json.ts`

## Relationships

- **Depends on:** apply results from creation and maintenance apply.
- **Enables:** service integration and later candidate/handoff lifecycle reconciler.
- **Shared contracts:** `ProjectMemoryChangeset`, `ProjectMemorySourceConsumptionRecord`, `ProjectMemoryBoundedSnippet`.
- **Integration points:** `projects/<key>/state/project-memory-source-consumptions.json`, run `project-memory-changeset.json`, run `project-memory-apply-result.json`.

## File Responsibility Map

**Create:**

- No new production file required if evidence helpers live in `src/project/project-memory-markdown-applier.ts`.

**Modify:**

- `src/project/project-memory-markdown-applier.ts` - collect bounded snippets, write changeset/result artifacts, and write source-consumption state.
- `src/project/project-memory-apply-contracts.ts` - adjust evidence types if implementation discovers missing fields.

**Test:**

- `tests/project/project-memory-markdown-applier.test.ts` - source-consumption and changeset assertions.

## Implementation Tasks

### Task 1: Add Changeset Evidence Tests

**Files:**

- Modify: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Assert changeset and result artifacts after maintenance apply**

In the maintenance CREATE_ENTRY test, add:

```ts
  const changeset = JSON.parse(await readFile(join(run, "project-memory-changeset.json"), "utf8"));
  expect(changeset.schema_version).toBe(1);
  expect(changeset.item_changes[0].item_id).toBe("create_setup");
  expect(changeset.item_changes[0].after_snippet.text).toContain("Document CLI setup command.");
  expect(changeset.file_changes[0].path).toBe("projects/demo/wiki/setup/index.md");

  const applyResult = JSON.parse(await readFile(join(run, "project-memory-apply-result.json"), "utf8"));
  expect(applyResult.status).toBe("applied");
  expect(applyResult.applied_item_ids).toEqual(["create_setup"]);
```

- [ ] **Step 2: Assert creation page changesets**

In the creation apply test, add:

```ts
  const changeset = JSON.parse(await readFile(join(run, "project-memory-changeset.json"), "utf8"));
  expect(changeset.page_changes.map((page: { page_id: string }) => page.page_id).sort()).toEqual(["page_index", "page_setup"]);
  expect(changeset.page_changes[0].after_snippet.text.length).toBeGreaterThan(0);
```

- [ ] **Step 3: Run focused tests**

Run: `bun test tests/project/project-memory-markdown-applier.test.ts`

Expected: fails because changeset/result artifacts are not written yet.

### Task 2: Write Apply Result And Changeset Artifacts

**Files:**

- Modify: `src/project/project-memory-markdown-applier.ts`

- [ ] **Step 1: Add imports**

```ts
import type {
  ProjectMemoryAppliedItemChange,
  ProjectMemoryAppliedPageChange,
  ProjectMemoryChangeset,
} from "./project-memory-apply-contracts.ts";
import { boundedSnippetForText, findEntryBlock } from "./project-memory-markdown-renderer.ts";
import { writeJson } from "../runtime/json.ts";
```

- [ ] **Step 2: Add artifact writer helper**

```ts
  private async writeApplyArtifacts(input: {
    absolute_run_dir: string;
    project_key: string;
    run_dir: string;
    curator_output_ref: string;
    risk: ProjectMemoryChangeset["risk"];
    result: ProjectMemoryApplyResult;
    page_changes: ProjectMemoryAppliedPageChange[];
    item_changes: ProjectMemoryAppliedItemChange[];
  }): Promise<ProjectMemoryApplyResult> {
    const changeset: ProjectMemoryChangeset = {
      schema_version: 1,
      project_key: input.project_key,
      run_dir: input.run_dir,
      packet_ref: { artifact: "input-packet.json", packet_schema_version: 1 },
      curator_output_ref: input.curator_output_ref,
      validation_ref: "curator-validation.json",
      applied_at: new Date().toISOString(),
      risk: input.risk,
      file_changes: input.result.changed_files,
      page_changes: input.page_changes,
      item_changes: input.item_changes,
      source_consumptions: input.result.source_consumptions,
    };
    await writeJson(resolveInside(input.absolute_run_dir, "project-memory-apply-result.json"), input.result);
    await writeJson(resolveInside(input.absolute_run_dir, "project-memory-changeset.json"), changeset);
    return input.result;
  }
```

- [ ] **Step 3: Call helper from creation apply**

After `promoteStagedWrites` returns in `applyCreationDraft`, build page changes:

```ts
    const promoted = await this.promoteStagedWrites({ ... });
    const pageChanges = input.draft.pages.map((page) => {
      const payloadPage = page.apply_payload?.pages?.find((draftPage) => draftPage.page_path === page.target.path);
      return {
        page_id: page.id,
        operation: page.target.path_kind === "existing_wiki_page" ? "adopt" as const : "create" as const,
        target_page: page.target.path,
        after_snippet: boundedSnippetForText(`wiki/${page.target.path}`, page.id, payloadPage ? renderPageDraft(payloadPage) : ""),
        evidence_refs: page.evidence_refs,
        repo_citations: page.repo_citations,
        inference: payloadPage?.inference,
      };
    });
    return await this.writeApplyArtifacts({
      absolute_run_dir: input.absolute_run_dir,
      project_key: input.project_key,
      run_dir: input.run_dir,
      curator_output_ref: "curator-creation-draft.json",
      risk: input.draft.risk,
      result: { ...promoted, applied_page_ids: input.draft.pages.map((page) => page.id) },
      page_changes: pageChanges,
      item_changes: [],
    });
```

- [ ] **Step 4: Call helper from maintenance apply**

Collect item changes while applying each item:

```ts
    const itemChanges: ProjectMemoryAppliedItemChange[] = [];
```

Inside the item loop after `nextPage` is calculated:

```ts
      const entryId = item.target_entry_id ?? item.proposed_entry_id ?? item.apply_payload?.entries?.[0]?.entry_id;
      itemChanges.push({
        item_id: item.id,
        operation: item.operation,
        target_page: item.target_page.path,
        entry_id: entryId,
        before_snippet: entryId ? snippetFromPage(item.target_page.path, entryId, pageText) : undefined,
        after_snippet: entryId ? snippetFromPage(item.target_page.path, entryId, nextPage) : undefined,
        evidence_refs: item.evidence_refs,
        repo_citations: item.repo_citations,
        inference: item.apply_payload?.entries?.[0]?.inference,
      });
      pageUpdates.set(item.target_page.path, nextPage);
```

Add helper:

```ts
function snippetFromPage(pagePath: string, entryId: string, pageText: string) {
  const block = findEntryBlock(pageText, entryId);
  return block ? boundedSnippetForText(`wiki/${pagePath}`, entryId, block.text) : undefined;
}
```

After `promoteStagedWrites`, call `writeApplyArtifacts`:

```ts
    return await this.writeApplyArtifacts({
      absolute_run_dir: input.absolute_run_dir,
      project_key: input.project_key,
      run_dir: input.run_dir,
      curator_output_ref: "curator-maintenance-proposal.json",
      risk: input.proposal.risk,
      result: { ...result, applied_item_ids: appliedItemIds },
      page_changes: [],
      item_changes: itemChanges,
    });
```

- [ ] **Step 5: Run focused tests**

Run: `bun test tests/project/project-memory-markdown-applier.test.ts`

Expected: exits `0`.

### Task 3: Add Source Consumption State

**Files:**

- Modify: `src/project/project-memory-markdown-applier.ts`
- Test: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Add source-consumption test**

In the maintenance CREATE_ENTRY test, add:

```ts
  const sourceState = JSON.parse(
    await readFile(join(root, "projects", "demo", "state", "project-memory-source-consumptions.json"), "utf8"),
  );
  expect(sourceState.records[0]).toMatchObject({
    source_ref: "cand_1",
    source_kind: "project_candidate",
    consumed_by_run: "projects/demo/runs/project-learn/run-maintain",
    terminal_decision: "applied_to_project_memory",
  });
  expect(changeset.source_consumptions[0].source_ref).toBe("cand_1");
```

- [ ] **Step 2: Implement source consumption collection**

Add helper:

```ts
function sourceConsumptionsForMaintenance(input: {
  projectKey: string;
  runDir: string;
  item: ProjectMemoryMaintenanceProposalItem;
}): ProjectMemorySourceConsumptionRecord[] {
  return input.item.source_packet_refs
    .filter((ref) => ref.kind === "project_candidate" || ref.kind === "project_handoff")
    .map((ref) => ({
      source_ref: ref.ref,
      source_kind: ref.kind,
      consumed_by_run: input.runDir,
      consumed_at: new Date().toISOString(),
      output_refs: [
        {
          page_path: input.item.target_page.path,
          entry_id: input.item.target_entry_id ?? input.item.proposed_entry_id ?? input.item.apply_payload?.entries?.[0]?.entry_id,
          item_id: input.item.id,
        },
      ],
      terminal_decision: "applied_to_project_memory" as const,
    }));
}
```

During maintenance item loop, collect:

```ts
    const sourceConsumptions: ProjectMemorySourceConsumptionRecord[] = [];
```

```ts
      sourceConsumptions.push(...sourceConsumptionsForMaintenance({ projectKey: input.project_key, runDir: input.run_dir, item }));
```

- [ ] **Step 3: Write project-level state**

Add method:

```ts
  private async writeSourceConsumptionState(projectKey: string, records: ProjectMemorySourceConsumptionRecord[]): Promise<void> {
    if (records.length === 0) return;
    const path = resolveInside(this.root, "projects", projectKey, "state", "project-memory-source-consumptions.json");
    const existing = (await readJsonIfExists<{ records?: ProjectMemorySourceConsumptionRecord[] }>(path)) ?? { records: [] };
    const byKey = new Map<string, ProjectMemorySourceConsumptionRecord>();
    for (const record of existing.records ?? []) byKey.set(`${record.source_kind}:${record.source_ref}:${record.consumed_by_run}`, record);
    for (const record of records) byKey.set(`${record.source_kind}:${record.source_ref}:${record.consumed_by_run}`, record);
    await writeJson(path, { schema_version: 1, records: [...byKey.values()] });
  }
```

Before writing apply artifacts in maintenance apply:

```ts
    await this.writeSourceConsumptionState(input.project_key, sourceConsumptions);
    const resultWithSources = { ...result, applied_item_ids: appliedItemIds, source_consumptions: sourceConsumptions };
```

Then pass `resultWithSources` to `writeApplyArtifacts`.

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/project/project-memory-markdown-applier.test.ts`

Expected: exits `0`. Verify tests do not assert candidate/handoff status mutation.

## Verification

Run:

```bash
bun test tests/project/project-memory-markdown-applier.test.ts
bun run typecheck
git diff --check
```

Expected:

- Changeset and source-consumption tests pass.
- Typecheck exits `0`.
- Whitespace check exits `0`.

## Acceptance Criteria Covered

- Apply artifacts include apply result and changeset evidence.
- Changesets include bounded snippets, file refs, ids, hashes, and provenance.
- Source-consumption records are written to project state and mirrored in run artifacts.
- Candidate/handoff statuses are not directly mutated.

## Risks And Rollback

- Risk: source-consumption dedupe key may need to include output ref when one source contributes to multiple entries in one run.
- Rollback: adjust `writeSourceConsumptionState` merge key; no schema migration is needed before release.
- Risk: snippets may be missing for lifecycle operations if entry lookup fails.
- Rollback: fail the item before promotion rather than writing incomplete changeset evidence.

## Non-Goals

- Does not mutate memory candidate or handoff database rows.
- Does not implement a reconciler.
- Does not add SQLite serving state.
- Does not integrate with CLI output directly.

## Type And Name Consistency

- Use `project-memory-source-consumptions.json` as the concrete state filename.
- Use `ProjectMemorySourceConsumptionRecord` for state and changeset records.
- Use `project-memory-apply-result.json` and `project-memory-changeset.json` as run artifact names.
