# Chunk 09: Project Learn Lifecycle And Dogfood

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Completed  
**Depends on:** `05-indexer-and-status-command.md`, `06-lookup-and-packet-quality.md`, `07-curator-evidence-and-scoped-gating.md`, `08-hint-generation-flow.md`  
**Enables:** Step 3.5 dogfood completion and next roadmap item selection

## Goal

Integrate Project Memory retrieval indexing and hint generation into `project learn`, surface `completed_with_pending_index` when canonical writes succeed but required retrieval work remains pending, update CLI/reporting/tests, and rerun the `llm-wiki` dogfood scenario to prove fallback markdown lookup no longer stops the run solely because it exists.

## Source Artifacts

- `../spec.md`: lifecycle, dogfood verification, testing strategy
- `../agenda.md`: terminal status, no-op, fallback gating decisions
- `../pseudocode/ProjectLearnRetrievalLifecycle.md`
- `../../../../docs/ROADMAP.md`: Step 3.5 dogfood item
- `../../../../src/project/project-memory-curator-service.ts`
- `../../../../src/project/project-memory-curator-contracts.ts`
- `../../../../src/project/project-memory-markdown-applier.ts`
- `../../../../src/commands/project.ts`
- `../../../../tests/project/project-memory-curator-service.test.ts`
- `../../../../tests/project/project-service.test.ts`
- `../../../../tests/commands/project.test.ts`

## Relationships

- **Depends on:** indexer/status command, lookup quality summary, scoped validator gating, hint generation flow.
- **Enables:** implementation can move from design/planning back to dogfood and then decide the next Step 3.5 item.
- **Shared contracts:** `completed`, `completed_with_pending_index`, `needs_review`, post-apply retrieval artifacts.
- **Integration points:** `runProjectLearn`, terminal artifacts, CLI JSON/human output, final dogfood run artifacts.

## File Responsibility Map

**Modify:**

- `src/project/project-memory-curator-service.ts` - after successful apply, run structural metadata refresh, mandatory hint generation for new pages/entries, and Project Memory retrieval indexing; choose final status.
- `src/project/project-memory-curator-contracts.ts` - add optional artifacts for retrieval index/hint generation results if not already added in chunk 1.
- `src/commands/project.ts` - display `completed_with_pending_index` and retrieval artifact/status details.
- `docs/ROADMAP.md` - update Step 3.5 progress after dogfood evidence.

**Test:**

- `tests/project/project-memory-curator-service.test.ts` - lifecycle status and post-apply retrieval artifacts.
- `tests/project/project-service.test.ts` - facade status compatibility.
- `tests/commands/project.test.ts` - CLI human/JSON output.

## Implementation Tasks

### Task 1: Add lifecycle tests for post-apply indexing result

**Files:**

- Modify: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Add completed-with-pending-index test**

Inject retrieval lifecycle dependencies into `ProjectMemoryCuratorService` if the service does not already support test doubles. Keep default behavior unchanged for production.

```ts
test("returns completed_with_pending_index when apply succeeds but required retrieval indexing fails", async () => {
  await seedProject("uncurated");
  seedMemoryDb();
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root, {
    retrievalLifecycle: {
      async afterProjectMemoryApply() {
        return {
          status: "pending",
          artifacts: {
            retrieval_index_result: "project-memory-retrieval-index-result.json",
          },
          degraded_reason: "mandatory hint generation failed",
        };
      },
    },
  });

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-28T10:00:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify(creationDraft("projects/demo/runs/project-learn/2026-06-28T10-00-00.000Z-run")),
      stderr: "",
    }),
  });

  expect(result.status).toBe("completed_with_pending_index");
  expect(result.stopped_before_writes).toBe(false);
  expect(result.stopped_reason).toContain("mandatory hint generation failed");
  expect(result.artifacts.retrieval_index_result).toBe("project-memory-retrieval-index-result.json");
});
```

- [ ] **Step 2: Add completed test for successful retrieval indexing**

```ts
test("returns completed when apply and required retrieval indexing succeed", async () => {
  const service = new ProjectMemoryCuratorService(root, {
    retrievalLifecycle: {
      async afterProjectMemoryApply() {
        return {
          status: "completed",
          artifacts: { retrieval_index_result: "project-memory-retrieval-index-result.json" },
        };
      },
    },
  });

  const result = await runValidCreation(service);

  expect(result.status).toBe("completed");
  expect(result.artifacts.retrieval_index_result).toBe("project-memory-retrieval-index-result.json");
});
```

- [ ] **Step 3: Run service tests**

Run: `rtk bun test tests/project/project-memory-curator-service.test.ts`  
Expected: fails until service lifecycle integration exists.

### Task 2: Add retrieval lifecycle integration

**Files:**

- Modify: `src/project/project-memory-curator-service.ts`
- Modify: `src/project/project-memory-curator-contracts.ts`

- [ ] **Step 1: Add result artifact fields**

Extend result artifacts:

```ts
artifacts: {
  input_packet: string;
  curator_output: string;
  curator_validation: string;
  curator_run_result: string;
  summary: string;
  prompt_budget?: "prompt-budget.json";
  runtime_inbox_intake?: "runtime-inbox-intake.json";
  apply_journal?: "project-memory-apply-journal.json";
  apply_result?: "project-memory-apply-result.json";
  changeset?: "project-memory-changeset.json";
  retrieval_sections?: "project-memory-retrieval-sections.json";
  hint_generation?: "project-memory-hint-generation-result.json";
  retrieval_index_result?: "project-memory-retrieval-index-result.json";
};
```

- [ ] **Step 2: Add injectable lifecycle dependency**

```ts
export type ProjectMemoryPostApplyRetrievalLifecycle = {
  afterProjectMemoryApply(input: {
    projectKey: string;
    mode: ProjectMemoryCuratorMode;
    run: ProjectCuratorRunPaths;
    apply: ProjectMemoryApplyResult;
    now: Date;
  }): Promise<{
    status: "completed" | "pending";
    artifacts: {
      retrieval_sections?: "project-memory-retrieval-sections.json";
      hint_generation?: "project-memory-hint-generation-result.json";
      retrieval_index_result?: "project-memory-retrieval-index-result.json";
    };
    degraded_reason?: string;
  }>;
};
```

Constructor:

```ts
constructor(
  private readonly root: string,
  private readonly deps: { retrievalLifecycle?: ProjectMemoryPostApplyRetrievalLifecycle } = {},
) {}
```

- [ ] **Step 3: Implement default lifecycle**

Default behavior should:

1. extract sections and write `sections.json`;
2. write a run-local copy or summary artifact named `project-memory-retrieval-sections.json`;
3. run mandatory hint generation for new pages/entries when chunk 8 exposes a service;
4. run `indexProjectMemoryRetrieval`;
5. write `project-memory-hint-generation-result.json` and `project-memory-retrieval-index-result.json`;
6. return `pending` when mandatory hints/indexing fail or pending rows remain.

Use explicit degraded reason:

```ts
const pendingReason = [
  hintResult.degraded_reason,
  indexResult.degraded_reason,
  indexResult.pending_remaining > 0 ? `${indexResult.pending_remaining} Project Memory retrieval rows remain pending` : "",
].filter(Boolean).join("; ");
```

- [ ] **Step 4: Choose final status after apply**

In the `applyResult.status === "applied"` branch:

```ts
const retrieval = await this.postApplyRetrievalLifecycle({
  projectKey: input.projectKey,
  mode: packet.mode,
  run,
  apply: applyResult,
  now,
});
return await this.writeTerminalArtifacts({
  input,
  run,
  mode: packet.mode,
  outputArtifact,
  validation,
  status: retrieval.status === "completed" ? "completed" : "completed_with_pending_index",
  stoppedReason: retrieval.degraded_reason,
  apply: applyResult,
  retrievalArtifacts: retrieval.artifacts,
  promptBudget: true,
  runtimeInboxIntake: true,
});
```

- [ ] **Step 5: Run service tests**

Run: `rtk bun test tests/project/project-memory-curator-service.test.ts`  
Expected: passes.

### Task 3: Update CLI and summary output

**Files:**

- Modify: `src/commands/project.ts`
- Modify: `src/project/project-memory-curator-service.ts`
- Test: `tests/commands/project.test.ts`, `tests/project/project-service.test.ts`

- [ ] **Step 1: Add command output tests**

```ts
expect(result.message).toContain("Project learn completed_with_pending_index for demo.");
expect(result.message).toContain("pending retrieval index");
```

JSON output must include:

```ts
expect(response.status).toBe("completed_with_pending_index");
expect(response.artifacts.retrieval_index_result).toBe("project-memory-retrieval-index-result.json");
```

- [ ] **Step 2: Update human status formatting**

Where project command formats `Project learn ${status}`, allow the new status without treating it as failure. Human output should include `stopped_reason` if present because the reason describes pending retrieval work.

- [ ] **Step 3: Update summary**

`summaryFor` should include retrieval status fields:

```ts
result.artifacts.retrieval_index_result ? `retrieval_index_result: ${result.artifacts.retrieval_index_result}` : "",
result.status === "completed_with_pending_index" ? `pending_retrieval_index: yes` : "",
```

- [ ] **Step 4: Run command tests**

Run: `rtk bun test tests/commands/project.test.ts tests/project/project-service.test.ts`  
Expected: passes.

### Task 4: Final dogfood and roadmap update

**Files:**

- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Run final focused tests**

Run: `rtk bun test tests/project/project-memory-packet.test.ts tests/project/project-memory-curator-validator.test.ts tests/project/project-memory-curator-service.test.ts tests/commands/project.test.ts tests/commands/memory.test.ts`  
Expected: passes.

Run: `rtk bun run typecheck`  
Expected: passes.

Run: `rtk bun test`  
Expected: passes.

- [ ] **Step 2: Run dogfood**

Run: `rtk bun src/cli.ts project learn llm-wiki --json`  
Expected:

- prompt transport remains `artifact_reference`;
- fallback lookup alone does not produce `stopped_reason: packet was degraded`;
- run status is one of:
  - `completed` when no canonical writes are needed and explicit no-op policy is satisfied, or when writes plus retrieval indexing complete;
  - `completed_with_pending_index` when canonical writes succeed and retrieval work remains pending;
  - `needs_review` only when scoped validation, explicit no-op policy, review flag, stale/unavailable evidence, or fallback-dependent maintenance write requires review.

If live provider credentials are unavailable, rerun the same scenario with the repository's LLM stub response mechanism and record that the provider was stubbed.

- [ ] **Step 3: Update roadmap progress**

In `docs/ROADMAP.md`, update Step 3.5 Project Memory retrieval-quality items with:

- chunk implementation status;
- dogfood run directory;
- status outcome;
- whether fallback lookup was advisory/proposal-scoped/blocking;
- whether canonical markdown/state wrote;
- whether retrieval indexing completed or remained pending.

## Verification

- `rtk bun test tests/project/project-memory-curator-service.test.ts tests/project/project-service.test.ts tests/commands/project.test.ts`  
  Expected: passes.
- `rtk bun test tests/project/project-memory-packet.test.ts tests/project/project-memory-curator-validator.test.ts tests/commands/memory.test.ts`  
  Expected: passes.
- `rtk bun run typecheck`  
  Expected: passes.
- `rtk bun test`  
  Expected: passes.
- `rtk bun src/cli.ts project learn llm-wiki --json`  
  Expected: dogfood no longer stops solely because fallback markdown lookup exists.

## Acceptance Criteria Covered

- `project learn` reports `completed_with_pending_index` when canonical writes succeed and retrieval work remains pending.
- Successful canonical writes are not rolled back because derived retrieval indexing fails.
- Final dogfood proves fallback lookup no longer dominates the apply decision.
- CLI, run artifacts, and roadmap evidence describe retrieval status honestly.

## Risks And Rollback

- Risk: automatic post-apply retrieval work may make `project learn` slow or provider-dependent. Mitigation: preserve completed canonical writes and surface pending retrieval status rather than failing the whole run.
- Risk: dogfood provider availability can block verification. Mitigation: use stubs when live provider is unavailable and record that limitation.
- Rollback: disable post-apply retrieval lifecycle injection and return previous `completed` behavior after apply. Derived retrieval artifacts can be ignored; canonical markdown remains valid.

## Non-Goals

- No MCP/general query facade exposure.
- No Current Briefing integration.
- No Practice or Personal Memory retrieval indexing.
- No redesign of Project Memory apply journal semantics.

## Type And Name Consistency

Verify these names are exact:

- `completed_with_pending_index`
- `project-memory-retrieval-sections.json`
- `project-memory-hint-generation-result.json`
- `project-memory-retrieval-index-result.json`
- `pending retrieval index`
- `ProjectMemoryPostApplyRetrievalLifecycle`
