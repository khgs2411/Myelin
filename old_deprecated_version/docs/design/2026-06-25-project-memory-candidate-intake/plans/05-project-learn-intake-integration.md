# Chunk 05: Project Learn Intake Integration

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `03-project-candidate-intake-service.md`  
**Enables:** self-maintaining runtime inbox product loop and dogfood checkpoint

## Goal

Compose `ProjectMemoryCandidateIntakeService` inside `project learn` after source-consumption reconciliation and before packet construction. A newly created runtime inbox item should become a normalized `needs_review` Project Memory candidate during the same `project learn` run, and the curator should see the normalized candidate through the existing packet path rather than reading raw inbox files.

## Source Artifacts

- `../spec.md`: Learn Integration, Intake Boundary, Acceptance Criteria.
- `../agenda.md`: Question 4 and pressure-test sequencing decisions.
- `../pseudocode/ProjectLearnCandidateIntakeFlow.md`
- `../pseudocode/CandidateIntakeReliabilityBoundary.md`
- `../pseudocode/ProjectMemoryCandidateIntakeService.ts`
- `../plan.md`: project learn ordering and risk notes.
- Code context: `src/project/project-memory-curator-service.ts`, `src/project/project-memory-curator-contracts.ts`, `src/project/project-memory-packet.ts`, `src/project/project-memory-source-consumption-reconciler.ts`, `src/project/project-service.ts`, `src/commands/project.ts`.
- Test context: `tests/project/project-memory-curator-service.test.ts`, `tests/commands/project.test.ts`.

## Relationships

- **Depends on:** `ProjectMemoryCandidateIntakeService.intakeProjectInbox`.
- **Enables:** dogfooding `project learn llm-wiki` with a runtime-inbox-derived Project Memory candidate.
- **Shared contracts:** project learn ordering, `runtime-inbox-intake.json` run artifact, optional `artifacts.runtime_inbox_intake` result field.
- **Integration points:** run artifact writing through `writeRunArtifact`, existing packet construction through `buildProjectMemoryPacket`, existing source-consumption reconciliation.

## File Responsibility Map

**Create:**

- None.

**Modify:**

- `src/project/project-memory-curator-contracts.ts` - add optional run artifact field for runtime inbox intake.
- `src/project/project-memory-curator-service.ts` - run intake after source-consumption reconciliation and before packet construction; write intake artifact; fail before curator work on blocking intake.
- `docs/CLI.md` - update `project learn` side effects to mention automatic runtime inbox intake.

**Test:**

- `tests/project/project-memory-curator-service.test.ts` - verifies ordering and packet visibility.
- `tests/commands/project.test.ts` - verifies JSON result includes the intake artifact when `project learn` runs normally.

## Implementation Tasks

### Task 1: Add Failing Project Learn Integration Tests

**Files:**

- Modify: `tests/project/project-memory-curator-service.test.ts`
- Modify: `tests/commands/project.test.ts`

- [ ] **Step 1: Add imports to curator service tests if missing**

```ts
import { createRuntimeInboxItem } from "../../src/inbox/runtime-inbox-items.ts";
```

- [ ] **Step 2: Add a service-level ordering test**

Add this test near the existing source-consumption reconciliation test:

```ts
test("runs runtime inbox intake before building the curator packet", async () => {
  await seedProject("curated");
  seedMemoryDb();
  await seedSchema();
  const inbox = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Runtime inbox intake candidate",
    body: "Runtime inbox intake should enter the Project Memory packet.",
    rationale: "Project learn should compose runtime inbox intake before packet construction.",
    evidenceRefs: ["docs/design/spec.md"],
    targetHint: null,
    confidence: "high",
    risk: "medium",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (inbox.status !== "created") throw new Error("failed to create inbox fixture");
  await mkdir(join(root, "projects", "demo", "wiki", "setup"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "# Setup\n", "utf8");
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-25T11:00:00.000Z"),
    runner: async (_command, options) => {
      expect(options?.stdin).toContain("Runtime inbox intake should enter the Project Memory packet.");
      expect(options?.stdin).toContain("project.inbox");
      return {
        exitCode: 0,
        stdout: JSON.stringify(maintenanceProposal("projects/demo/runs/project-learn/2026-06-25T11-00-00.000Z-run")),
        stderr: "",
      };
    },
  });

  expect(result.status).toBe("completed");
  expect(result.artifacts.runtime_inbox_intake).toBe("runtime-inbox-intake.json");
  const intakeArtifact = JSON.parse(await readFile(join(root, result.run_dir, "runtime-inbox-intake.json"), "utf8"));
  expect(intakeArtifact.created_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
});
```

- [ ] **Step 3: Add a command-level JSON artifact test**

In `tests/commands/project.test.ts`, add `createRuntimeInboxItem` import and extend the existing `project learn routes through curator service and writes curator artifacts` test or add a separate test:

```ts
test("project learn JSON includes runtime inbox intake artifact when intake runs", async () => {
  await seedProject("active", "active");
  await writeJson(join(root, "projects", "active", "state", "bootstrap-state.json"), {
    status: "uncurated",
    missing: ["curated_project_memory"],
  });
  await mkdir(join(root, "projects", "active", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "active", "wiki", "index.md"), "# Active\n", "utf8");
  seedMemoryDb();
  await seedSchema();
  const inbox = await createRuntimeInboxItem(root, {
    projectKey: "active",
    targetLayer: "project",
    title: "Runtime inbox candidate",
    body: "Runtime inbox candidate visible to project learn.",
    rationale: "Project learn should run intake before packet construction.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (inbox.status !== "created") throw new Error("failed to create inbox fixture");
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    now: () => new Date("2026-06-25T11:00:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify(creationDraft("active", "projects/active/runs/project-learn/2026-06-25T11-00-00.000Z-run")),
      stderr: "",
    }),
  });

  const result = await cli.run(["project", "learn", "active", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.artifacts.runtime_inbox_intake).toBe("runtime-inbox-intake.json");
  expect(await Bun.file(join(root, response.run_dir, "runtime-inbox-intake.json")).exists()).toBe(true);
});
```

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/project/project-memory-curator-service.test.ts tests/commands/project.test.ts`  
Expected: fails because `project learn` does not call runtime inbox intake and the result artifact field does not exist.

### Task 2: Add Runtime Inbox Intake Artifact To Run Result Contract

**Files:**

- Modify: `src/project/project-memory-curator-contracts.ts`

- [ ] **Step 1: Add the optional artifact field**

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
    runtime_inbox_intake?: "runtime-inbox-intake.json";
    apply_journal?: "project-memory-apply-journal.json";
    apply_result?: "project-memory-apply-result.json";
    changeset?: "project-memory-changeset.json";
  };
  // keep the rest of the existing fields unchanged
};
```

When applying, add only `runtime_inbox_intake?: "runtime-inbox-intake.json";` to the existing `artifacts` object.

### Task 3: Compose Intake Inside Project Learn

**Files:**

- Modify: `src/project/project-memory-curator-service.ts`

- [ ] **Step 1: Add import**

```ts
import { ProjectMemoryCandidateIntakeService } from "./project-memory-candidate-intake-service.ts";
```

- [ ] **Step 2: Run intake after source-consumption reconciliation**

In `runProjectLearn`, after the reconciliation blocking branch and before `const packet = await buildProjectMemoryPacket(...)`, insert:

```ts
const runtimeInboxIntake = await new ProjectMemoryCandidateIntakeService(this.root).intakeProjectInbox(input.projectKey, now);
await writeRunArtifact(run, "runtime-inbox-intake.json", runtimeInboxIntake);
if (runtimeInboxIntake.blocking) {
  const mode = await projectLearnModeForState(this.root, input.projectKey);
  const packet = await buildProjectMemoryPacket(this.root, input.projectKey);
  await writeRunArtifact(run, "input-packet.json", packet);
  return await this.writeTerminalArtifacts({
    input,
    run,
    mode,
    outputArtifact: "runtime-inbox-intake.json",
    validation: failureValidation(
      input.projectKey,
      mode,
      "runtime_inbox_intake_failed",
      runtimeInboxIntake.degraded_reasons.join("; ") || "runtime inbox intake failed",
    ),
    status: "failed",
    stoppedReason: runtimeInboxIntake.degraded_reasons.join("; ") || "runtime inbox intake failed",
    runtimeInboxIntake: true,
  });
}
```

This keeps the successful ordering:

```text
apply recovery -> shell repair -> schema preflight -> source-consumption reconciliation -> runtime inbox intake -> packet construction
```

- [ ] **Step 3: Thread the optional artifact through terminal result writing**

Update the private `writeTerminalArtifacts` input type:

```ts
runtimeInboxIntake?: boolean;
```

Update the `buildResult` call inside `writeTerminalArtifacts`:

```ts
runtimeInboxIntake: input.runtimeInboxIntake,
```

Update `buildResult` input type:

```ts
runtimeInboxIntake?: boolean;
```

Update the returned `artifacts` object in `buildResult`:

```ts
runtime_inbox_intake: input.runtimeInboxIntake ? "runtime-inbox-intake.json" : undefined,
```

- [ ] **Step 4: Mark successful runs as having the intake artifact**

Every `writeTerminalArtifacts` call after successful runtime inbox intake should pass:

```ts
runtimeInboxIntake: true,
```

Do not pass this flag for the early recovery return before a new run is created. Do not pass it for the source-consumption reconciliation blocking branch because runtime inbox intake did not run.

- [ ] **Step 5: Run focused tests**

Run: `bun test tests/project/project-memory-curator-service.test.ts tests/commands/project.test.ts`  
Expected: passes.

### Task 4: Document Project Learn Side Effect

**Files:**

- Modify: `docs/CLI.md`

- [ ] **Step 1: Update the `project learn` side effects list**

Add this bullet under `project learn` side effects:

```md
- Runs deterministic runtime inbox intake before packet construction, creating or reusing Project Memory candidates for valid `projects/<project-key>/sources/inbox/*.json` source proposals.
```

## Verification

- Run: `bun test tests/project/project-memory-candidate-intake-service.test.ts`  
  Expected: pass, proving the service contract remains stable.
- Run: `bun test tests/project/project-memory-curator-service.test.ts tests/commands/project.test.ts`  
  Expected: pass, including runtime inbox intake artifact and packet visibility tests.
- Run: `bun test`  
  Expected: pass.
- Run: `bun run typecheck`  
  Expected: pass with no TypeScript errors.
- Run: `rtk git diff --check`  
  Expected: no whitespace errors.

## Acceptance Criteria Covered

- `project learn <key>` calls the same intake service as `memory inbox intake`.
- `project learn` runs intake before packet construction.
- A valid runtime inbox item can become a `needs_review` Project Memory candidate during the same learn run.
- The curator sees normalized candidates through packet input, not raw source files.
- Re-running `project learn` does not duplicate candidates because the service is idempotent.
- Session Memory remains a separate producer path.

## Risks And Rollback

- Risk: adding intake before packet construction changes `project learn` write behavior by creating `state/memory.db` and candidate rows. Mitigation: this is the approved product loop; the command should write an explicit `runtime-inbox-intake.json` audit artifact.
- Risk: blocking intake failure could still invoke the curator. Mitigation: branch on `runtimeInboxIntake.blocking` before packet construction and curator invocation.
- Risk: `--dry-run` semantics become unclear. Mitigation: preserve existing shell repair behavior and treat intake as deterministic source-to-candidate processing that runs with `project learn`; if tests expose an unacceptable dry-run write, stop and ask the user before changing product behavior.
- Rollback: remove the import and intake block from `ProjectMemoryCuratorService`, remove the optional artifact field, and remove the tests/docs added by this chunk. Chunks 01-04 remain usable.

## Non-Goals

- No new candidate normalization code in `ProjectMemoryCuratorService`.
- No direct raw inbox reads in the packet builder or curator prompt.
- No changes to source-consumption reconciliation.
- No Practice/Personal intake consumers.
- No gap/stale producer routing.
- No dogfood run against `llm-wiki`; that is the next roadmap checkpoint after implementation.

## Type And Name Consistency

- Service import: `ProjectMemoryCandidateIntakeService`.
- Run artifact file: `runtime-inbox-intake.json`.
- Result artifact field: `runtime_inbox_intake`.
- Failure code: `runtime_inbox_intake_failed`.
- Ordering: source-consumption reconciliation before runtime inbox intake before packet construction.
