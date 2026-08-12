# Chunk 07: Project Learn Service Integration

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `04-creation-apply.md`, `05-maintenance-apply.md`, `06-source-consumption-and-changeset-evidence.md`
**Enables:** `08-docs-roadmap-and-final-verification.md`

## Goal

Wire deterministic apply into `ProjectMemoryCuratorService.runProjectLearn`: recover incomplete journals before new curator work, invoke the curator and validator as today, decide whether apply is allowed, run creation or maintenance apply, and report terminal run status/artifacts accurately through CLI JSON and human output.

## Source Artifacts

- `../spec.md`: User-Facing Behavior, Error Handling, Testing Strategy, Acceptance Criteria.
- `../agenda.md`: Questions 3, 5, 7, and trusted-state audit refinement.
- `../pseudocode/ProjectLearnMarkdownApplyFlow.md`
- `../pseudocode/src/project/project-memory-curator-service.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-packet.ts`
- `src/project/project-memory-markdown-applier.ts`
- `src/commands/project.ts`
- `tests/project/project-memory-curator-service.test.ts`
- `tests/commands/project.test.ts`

## Relationships

- **Depends on:** creation apply, maintenance apply, source-consumption/changset artifacts.
- **Enables:** full feature verification and docs/roadmap cleanup.
- **Shared contracts:** `ProjectMemoryCuratorRunResult`, `stopped_before_writes`, artifact refs, trusted-state gate.
- **Integration points:** CLI `project learn`, `ProjectService.runProjectLearn`, curator service, packet mode compatibility.

## File Responsibility Map

**Create:**

- No new file required.

**Modify:**

- `src/project/project-memory-curator-contracts.ts` - widen run result artifacts and `stopped_before_writes`.
- `src/project/project-memory-curator-service.ts` - add recovery preflight, apply decision, apply invocation, terminal artifact writing.
- `src/commands/project.ts` - display apply artifact/result details only when present.

**Test:**

- `tests/project/project-memory-curator-service.test.ts` - end-to-end service behavior with stub curator output.
- `tests/commands/project.test.ts` - CLI JSON/human output for applied and stopped runs.
- `tests/project/project-memory-packet.test.ts` - trusted-state predicate reconciliation if packet behavior changes.

## Implementation Tasks

### Task 1: Widen Run Result Contract

**Files:**

- Modify: `src/project/project-memory-curator-contracts.ts`
- Test: existing service and command tests.

- [ ] **Step 1: Update result type**

Change `ProjectMemoryCuratorRunResult`:

```ts
export type ProjectMemoryCuratorRunResult = {
  status: ProjectMemoryCuratorRunStatus;
  project_key: string;
  mode: ProjectMemoryCuratorMode;
  run_id: string;
  run_dir: string;
  artifacts: {
    input_packet: string;
    curator_output: string;
    curator_validation: string;
    curator_run_result: string;
    summary: string;
    apply_journal?: "project-memory-apply-journal.json";
    apply_result?: "project-memory-apply-result.json";
    changeset?: "project-memory-changeset.json";
  };
  validation_ok: boolean;
  stopped_before_writes: boolean;
  dry_run: boolean;
  review: boolean;
  applied_page_ids?: string[];
  applied_item_ids?: string[];
  changed_files?: string[];
  source_consumptions?: string[];
  stopped_reason?: string;
};
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: exits `0` or fails only at call sites that still assume literal `true`.

### Task 2: Add Service Tests For Applied Creation And Maintenance

**Files:**

- Modify: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Update successful creation test fixture**

The existing creation test currently expects `stopped_before_writes: true` for every successful run. Replace that assertion path with applied behavior and update `creationDraft` helper to include index plus domain page payloads:

```ts
expect(result.status).toBe("completed");
expect(result.mode).toBe("create");
expect(result.stopped_before_writes).toBe(false);
expect(result.artifacts.apply_journal).toBe("project-memory-apply-journal.json");
expect(result.artifacts.apply_result).toBe("project-memory-apply-result.json");
expect(result.artifacts.changeset).toBe("project-memory-changeset.json");
expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toContain("# Demo");
expect(await readFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "utf8")).toContain("# Setup");
```

Update `creationDraft` pages:

```ts
pages: [
  creationPage("page_index", "index.md", "Demo", "Project Memory index"),
  creationPage("page_setup", "setup/index.md", "Setup", "Setup workflows"),
],
```

Add `creationPage` helper mirroring chunk 04.

- [ ] **Step 2: Add maintenance applied test**

```ts
test("runs maintain mode and applies eligible low-risk maintenance output", async () => {
  await seedProject("curated");
  await mkdir(join(root, "projects", "demo", "wiki", "setup"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "# Setup\n", "utf8");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T13:00:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify(maintenanceProposal("projects/demo/runs/project-learn/2026-06-23T13-00-00.000Z-run")),
      stderr: "",
    }),
  });

  expect(result.status).toBe("completed");
  expect(result.mode).toBe("maintain");
  expect(result.stopped_before_writes).toBe(false);
  expect(result.applied_item_ids).toEqual(["item_1"]);
  expect(await readFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "utf8")).toContain('id="setup.cli"');
});
```

Add `maintenanceProposal` helper using the chunk 05 shape.

- [ ] **Step 3: Keep stopped-before-writes tests**

Do not change validation failure/provider failure tests to apply. They should continue to assert:

```ts
expect(result.stopped_before_writes).toBe(true);
```

- [ ] **Step 4: Run focused service tests**

Run: `bun test tests/project/project-memory-curator-service.test.ts`

Expected: fails until service integration is implemented.

### Task 3: Implement Recovery Preflight

**Files:**

- Modify: `src/project/project-memory-curator-service.ts`

- [ ] **Step 1: Import applier**

```ts
import { ProjectMemoryMarkdownApplier } from "./project-memory-markdown-applier.ts";
```

- [ ] **Step 2: Add preflight before shell repair and new run creation**

At the top of `runProjectLearn`, after `findProject`:

```ts
    const applier = new ProjectMemoryMarkdownApplier(this.root);
    const incompleteJournals = await applier.findIncompleteApplyJournals(input.projectKey);
    if (incompleteJournals.length > 0) {
      const recoveredRun = runInfoFromJournalPath(incompleteJournals[0]);
      const recovered = await applier.recoverFromJournal(incompleteJournals[0]);
      return {
        status: recovered.status === "applied" ? "completed" : "failed",
        project_key: input.projectKey,
        mode: recoveredRun.mode,
        run_id: recoveredRun.run_id,
        run_dir: recoveredRun.run_dir,
        artifacts: {
          input_packet: "input-packet.json",
          curator_output: "curator-output.json",
          curator_validation: "curator-validation.json",
          curator_run_result: "curator-run-result.json",
          summary: "summary.md",
          apply_journal: "project-memory-apply-journal.json",
          apply_result: "project-memory-apply-result.json",
          changeset: "project-memory-changeset.json",
        },
        validation_ok: recovered.status === "applied",
        stopped_before_writes: recovered.status !== "applied",
        dry_run: input.dryRun,
        review: input.review,
        changed_files: recovered.changed_files.map((file) => file.path),
        stopped_reason: recovered.status === "applied" ? undefined : recovered.reason,
      };
    }
```

Add helper:

```ts
function runInfoFromJournalPath(journalPath: string): {
  run_id: string;
  run_dir: string;
  mode: ProjectMemoryCuratorMode;
} {
  const normalized = journalPath.replaceAll("\\", "/");
  const match = normalized.match(/(projects\/[^/]+\/runs\/project-learn\/([^/]+))\/project-memory-apply-journal\.json$/);
  if (!match) return { run_id: "recovered", run_dir: normalized, mode: "maintain" };
  return { run_id: match[2], run_dir: match[1], mode: "maintain" };
}
```

The mode defaults to `maintain` for recovered interrupted applies because new curator work is not invoked and the recovery path reports apply recovery, not a fresh creation or maintenance proposal. If chunk 03 stores mode in `ProjectMemoryApplyJournal`, prefer that journal value here.

- [ ] **Step 3: Add focused recovery service test**

Use the applier test pattern to create an incomplete journal, then call `runProjectLearn` with a runner that throws if invoked:

```ts
runner: async () => {
  throw new Error("curator should not run during recovery");
},
```

Expected: result is `completed` or `failed` from recovery, and the thrown runner is never used.

### Task 4: Implement Apply Decision And Invocation

**Files:**

- Modify: `src/project/project-memory-curator-service.ts`

- [ ] **Step 1: Add apply decision helper**

```ts
function canApply(input: {
  dryRun: boolean;
  review: boolean;
  packet: ProjectMemoryPacket;
  validation: ProjectMemoryCuratorValidationResult;
  curatorOutput: unknown;
}): { ok: true } | { ok: false; status: ProjectMemoryCuratorRunResult["status"]; reason?: string } {
  if (input.dryRun) return { ok: false, status: "completed", reason: "dry-run requested" };
  if (input.review) return { ok: false, status: "needs_review", reason: "review requested" };
  if (!input.validation.ok) return { ok: false, status: "needs_review", reason: "curator validation did not produce eligible output" };
  if (input.validation.rejected_item_ids.length > 0 || input.validation.quarantined_item_ids.length > 0) {
    return { ok: false, status: "needs_review", reason: "curator validation produced rejected or quarantined output" };
  }
  if (input.packet.mode === "maintain" && statusOf(input.packet.state.project_memory) !== "curated") {
    return { ok: false, status: "needs_review", reason: "trusted Project Memory state is required for maintenance apply" };
  }
  if (input.packet.mode === "maintain" && input.validation.eligible_item_ids.length === 0) {
    return { ok: false, status: "needs_review", reason: "maintenance proposal has no eligible items" };
  }
  return { ok: true };
}
```

Add helper:

```ts
function statusOf(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}
```

- [ ] **Step 2: Invoke apply after validation**

Replace the current status/stoppedReason block after validation with:

```ts
    const applyDecision = canApply({
      dryRun: input.dryRun,
      review: input.review,
      packet,
      validation,
      curatorOutput,
    });
    if (!applyDecision.ok) {
      return await this.writeTerminalArtifacts({
        input,
        run,
        mode: packet.mode,
        outputArtifact,
        validation,
        status: applyDecision.status,
        stoppedReason: applyDecision.reason,
      });
    }

    const applier = new ProjectMemoryMarkdownApplier(this.root);
    const applyResult =
      packet.mode === "create"
        ? await applier.applyCreationDraft({
            project_key: input.projectKey,
            run_dir: run.relative_run_dir,
            absolute_run_dir: run.absolute_run_dir,
            draft: curatorOutput as ProjectMemoryCreationDraft,
          })
        : await applier.applyMaintenanceProposal({
            project_key: input.projectKey,
            run_dir: run.relative_run_dir,
            absolute_run_dir: run.absolute_run_dir,
            proposal: curatorOutput as ProjectMemoryMaintenanceProposal,
            eligible_item_ids: validation.eligible_item_ids,
          });

    return await this.writeTerminalArtifacts({
      input,
      run,
      mode: packet.mode,
      outputArtifact,
      validation,
      status: applyResult.status === "applied" ? "completed" : applyResult.status === "skipped" ? "needs_review" : "failed",
      stoppedReason: applyResult.status === "applied" ? undefined : applyResult.reason,
      applyResult,
    });
```

- [ ] **Step 3: Extend terminal artifact writer**

Update `writeTerminalArtifacts` input type with:

```ts
    applyResult?: ProjectMemoryApplyResult;
```

Pass `applyResult` into `buildResult`, and in `buildResult` set:

```ts
    artifacts: {
      input_packet: "input-packet.json",
      curator_output: input.outputArtifact,
      curator_validation: "curator-validation.json",
      curator_run_result: "curator-run-result.json",
      summary: "summary.md",
      ...(input.applyResult?.status === "applied"
        ? {
            apply_journal: "project-memory-apply-journal.json" as const,
            apply_result: "project-memory-apply-result.json" as const,
            changeset: "project-memory-changeset.json" as const,
          }
        : {}),
    },
    stopped_before_writes: input.applyResult?.status === "applied" ? false : true,
    applied_page_ids: input.applyResult?.applied_page_ids,
    applied_item_ids: input.applyResult?.applied_item_ids,
    changed_files: input.applyResult?.changed_files.map((file) => file.path),
    source_consumptions: input.applyResult?.source_consumptions.map((record) => `${record.source_kind}:${record.source_ref}`),
```

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/project/project-memory-curator-service.test.ts`

Expected: exits `0`.

### Task 5: Update CLI Output Tests

**Files:**

- Modify: `tests/commands/project.test.ts`
- Modify: `src/commands/project.ts`

- [ ] **Step 1: Update JSON output assertion for applied creation**

In the existing `project learn routes through curator service` test, update expected output:

```ts
expect(response.stopped_before_writes).toBe(false);
expect(response.artifacts.apply_journal).toBe("project-memory-apply-journal.json");
expect(await readFile(join(root, response.run_dir, "summary.md"), "utf8")).toContain("stopped_before_writes: false");
```

Also update the creation draft helper with concrete apply payloads and a domain page.

- [ ] **Step 2: Add human output apply artifact line**

In `projectLearnCommand`, after the `stopped_before_writes` line, add:

```ts
      result.artifacts.apply_result ? `apply_result: ${result.artifacts.apply_result}` : "",
```

Keep `.filter(Boolean)` or equivalent so stopped runs do not show missing apply artifacts.

- [ ] **Step 3: Run command tests**

Run: `bun test tests/commands/project.test.ts`

Expected: exits `0`.

## Verification

Run:

```bash
bun test tests/project/project-memory-curator-service.test.ts
bun test tests/commands/project.test.ts
bun test tests/project/project-memory-packet.test.ts
bun run typecheck
git diff --check
```

Expected:

- Service and command tests pass.
- Packet tests either pass unchanged or are updated only to document the compatibility/apply-authority split.
- Typecheck exits `0`.
- Whitespace check exits `0`.

## Acceptance Criteria Covered

- `project learn` applies valid low-risk creation and maintenance outputs.
- `stopped_before_writes` is false only for canonical writes.
- Dry-run, review, invalid, rejected, quarantined, unsupported, or untrusted-maintenance runs stop before writes.
- Incomplete apply journals are recovered before any new curator invocation.
- CLI JSON and human output report applied versus stopped states.

## Risks And Rollback

- Risk: recovery result mode may be hard to infer from journal alone.
- Rollback: add mode to `ProjectMemoryApplyJournal` in chunk 03, then use it here.
- Risk: service integration exposes skipped applier results as `needs_review`.
- Rollback: keep skipped apply as stopped-before-writes with explicit `stopped_reason`; do not silently mark completed applied.

## Non-Goals

- Does not change provider invocation behavior.
- Does not add a standalone recovery command.
- Does not mutate candidate/handoff statuses.
- Does not implement derived retrieval indexing.

## Type And Name Consistency

- Keep command name `project learn`.
- Keep result field `stopped_before_writes`.
- Use optional `artifacts.apply_journal`, `artifacts.apply_result`, and `artifacts.changeset` only for applied runs.
