# Chunk 06: Project Learn Composition And Recreate

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `04-agent-authored-create-mode.md`, `05-agent-authored-maintenance-mode.md`  
**Enables:** `07-retrieval-and-legacy-curator-cleanup.md`, `08-live-dogfood-and-acceptance.md`

## Goal

Wire the new create and maintenance services into `project learn`. The first curated run executes create mode, then maintenance mode against the create draft before a single canonical promotion. Later runs execute maintenance-only against the existing canonical wiki. `--recreate` explicitly forces a new create-plus-maintenance run, while routine runs never recreate by surprise.

## Source Artifacts

- `../spec.md`: first-run create plus maintenance, later maintenance-only, recreate.
- `../../../adr/0067-use-agent-authored-project-memory-documentation.md`.
- Current code:
  - `src/project/project-memory-curator-service.ts`
  - `src/project/project-service.ts`
  - `src/commands/project.ts`
  - `src/project/project-memory-packet.ts`
  - `src/project/project-memory-markdown-applier.ts`
  - `tests/project/project-memory-curator-service.test.ts`
  - `tests/project/project-service.test.ts`
  - `tests/commands/project.test.ts`
- Chunk outputs:
  - `src/project/project-memory-agent-create-service.ts`
  - `src/project/project-memory-agent-maintenance-service.ts`
  - `src/project/project-memory-draft-promotion.ts`

## Relationships

- **Depends on:** create and maintenance services.
- **Enables:** cleanup of obsolete curator gates and final dogfood.
- **Shared contracts:** `RunProjectMemoryCuratorInput.recreate`, `ProjectMemoryCuratorRunResult.run_kind`, promotion fallback behavior.
- **Integration points:** public `ProjectService.runProjectLearn`, CLI result formatting, packet builder pending sources, source-consumption reconciler, run artifacts.

## File Responsibility Map

**Create:**
- No new top-level service is required if `ProjectMemoryCuratorService` remains the public class. If implementation discovers the class is too coupled, create `src/project/project-memory-learn-service.ts` and have `ProjectMemoryCuratorService.runProjectLearn` delegate to it.

**Modify:**
- `src/project/project-memory-curator-service.ts` - replace main `runProjectLearn` path with agent-authored composition.
- `src/project/project-service.ts` - no behavior change unless class delegation changes.
- `src/commands/project.ts` - human output includes `run_kind`; JSON already returns result.
- `src/project/project-memory-curator-contracts.ts` - result fields from chunk `01` are populated.

**Test:**
- `tests/project/project-memory-curator-service.test.ts` - replace old JSON curator expectations with create-plus-maintenance and maintenance-only expectations.
- `tests/project/project-service.test.ts` - public service still delegates and returns result.
- `tests/commands/project.test.ts` - `--recreate` behavior and human output.

## Implementation Tasks

### Task 1: Detect Create, Maintenance, And Recreate Mode

**Files:**
- Modify: `src/project/project-memory-curator-service.ts`
- Test: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Add mode-selection tests**

```ts
test("runs create then maintenance when no curated project memory exists", async () => {
  await seedProject("uncurated");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());
  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    provider: "codex",
    env: { FILE_AUTHORING_STUB_OUTPUTS_DIR: fixtures },
    now: new Date("2026-07-06T00:00:00.000Z"),
  });
  expect(result.status).toBe("completed");
  expect(result.mode).toBe("create");
  expect(result.curation_kind).toBe("agent_authored");
  expect(result.run_kind).toBe("create_then_maintenance");
  expect(result.artifacts.subject_manifest).toBe("reports/documentation-subject-manifest.json");
  expect(result.artifacts.maintenance_report).toBe("reports/documentation-maintenance-report.json");
});

test("runs maintenance only when curated project memory exists", async () => {
  await seedProject("curated");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());
  await writeJson(join(root, "projects", "demo", "state", "project-memory.json"), {
    schema_version: 2,
    project_key: "demo",
    status: "curated",
    source_run_dir: "older-run",
    updated_at: "2026-07-05T00:00:00.000Z",
    provider_mode: "stub",
    curation_kind: "agent_authored",
    run_kind: "create_then_maintenance",
    retrieval_readiness: { status: "ready", checked_at: "2026-07-05T00:00:00.000Z" },
  });
  const result = await service.runProjectLearn(validMaintenanceInput());
  expect(result.mode).toBe("maintain");
  expect(result.curation_kind).toBe("agent_authored");
  expect(result.run_kind).toBe("maintenance");
});
```

- [ ] **Step 2: Implement state detection**

```ts
async function readProjectMemoryState(root: string, projectKey: string): Promise<{ status?: string; schema_version?: number } | null> {
  return await readJsonIfExists(resolveInside(root, "projects", projectKey, "state", "project-memory.json"));
}

function shouldRunCreate(input: RunProjectMemoryCuratorInput, state: { status?: string } | null): boolean {
  if (input.recreate) return true;
  return state?.status !== "curated";
}
```

- [ ] **Step 3: Run focused service tests**

Run: `bun test tests/project/project-memory-curator-service.test.ts`  
Expected: new mode-selection tests pass after composition code is implemented in later tasks.

### Task 2: Compose First-Run Create Plus Maintenance Before Promotion

**Files:**
- Modify: `src/project/project-memory-curator-service.ts`
- Test: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Add promotion-order test**

```ts
test("first run promotes the post-maintenance draft, not the pre-maintenance snapshot", async () => {
  const result = await service.runProjectLearn(validCreateThenMaintenanceInput());
  expect(result.changed_files).toContain("projects/demo/wiki/runtime.md");
  const runtime = await readFile(join(repo.root, "projects", "demo", "wiki", "runtime.md"), "utf8");
  expect(runtime).toContain("maintenance-added detail");
  expect(runtime).not.toContain("planner placeholder only");
});
```

- [ ] **Step 2: Implement create-plus-maintenance flow**

Replace the main successful write path inside `runProjectLearn` with:

```ts
const state = await readProjectMemoryState(this.root, input.projectKey);
const createRequired = shouldRunCreate(input, state);
const run = await createProjectCuratorRun(this.root, input.projectKey, input.now);
await ensureProjectLearnSchemaContext(this.root, input.projectKey, { dryRun: input.dryRun, now: input.now });
const packet = await buildProjectMemoryPacket(this.root, input.projectKey);
await writeRunArtifact(run.absolute_run_dir, "input-packet.json", packet);

if (createRequired) {
  const create = await runProjectMemoryCreateMode({
    root: this.root,
    projectKey: input.projectKey,
    runDir: run.run_dir,
    absoluteRunDir: run.absolute_run_dir,
    targetRepoDir: this.root,
    provider: input.provider,
    modelOverride: input.modelOverride,
    env: input.env,
    runner: input.runner,
    now: input.now,
  });
  if (create.status !== "completed") return failedRunResultFromCreate(input, run, create);

  const maintenance = await runProjectMemoryMaintenanceMode({
    root: this.root,
    projectKey: input.projectKey,
    runDir: run.run_dir,
    absoluteRunDir: run.absolute_run_dir,
    targetRepoDir: this.root,
    baseWikiDir: create.draft_wiki_dir,
    pendingSources: pendingSourcesFromPacket(packet),
    provider: input.provider,
    modelOverride: input.modelOverride,
    env: input.env,
    runner: input.runner,
    now: input.now,
  });
  const promotableDraft = maintenance.status === "failed" && maintenanceFailureIsCandidateSpecific(maintenance)
    ? create.draft_wiki_dir
    : maintenance.draft_wiki_dir;
  const promotion = await promoteDraftWiki({
    root: this.root,
    projectKey: input.projectKey,
    runDir: run.run_dir,
    absoluteRunDir: run.absolute_run_dir,
    mode: "create",
    draftWikiDir: promotableDraft,
    curatorOutputRef: "documentation-create-result.json",
    state: agentStateForCreateRun(input, run, create, maintenance),
    sourceConsumptions: maintenance.status === "completed" ? maintenance.source_consumptions : [],
  });
  return runResultFromAgentFlow(input, run, "create", "create_then_maintenance", create, maintenance, promotion);
}
```

- [ ] **Step 3: Implement pending source adapter**

```ts
function pendingSourcesFromPacket(packet: ProjectMemoryPacket): ProjectMemoryMaintenancePendingSource[] {
  return [
    ...packet.pending.project_candidates.map((candidate) => ({
      source_kind: "project_candidate" as const,
      source_ref: candidate.id,
      summary: candidate.title ?? candidate.id,
      body: candidate.summary ?? "",
    })),
    ...packet.pending.project_handoffs.map((handoff) => ({
      source_kind: "project_handoff" as const,
      source_ref: handoff.id,
      summary: handoff.title ?? handoff.id,
      body: handoff.prompt_text ?? handoff.objective ?? "",
    })),
  ];
}
```

Adjust field names to the actual `ProjectMemoryPacket` type while preserving this adapter boundary.

- [ ] **Step 4: Run focused service tests**

Run: `bun test tests/project/project-memory-curator-service.test.ts`  
Expected: first-run tests pass.

### Task 3: Compose Maintenance-Only Runs

**Files:**
- Modify: `src/project/project-memory-curator-service.ts`
- Test: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Add maintenance-only promotion test**

```ts
test("maintenance-only run promotes maintenance draft and source consumptions", async () => {
  const result = await service.runProjectLearn(validMaintenanceInput());
  expect(result.mode).toBe("maintain");
  expect(result.applied_item_ids).toContain("cand_1");
  const state = JSON.parse(await readFile(join(repo.root, "projects", "demo", "state", "project-memory.json"), "utf8"));
  expect(state.schema_version).toBe(2);
  expect(state.curation_kind).toBe("agent_authored");
  expect(state.run_kind).toBe("maintenance");
});
```

- [ ] **Step 2: Implement maintenance-only flow**

```ts
const maintenance = await runProjectMemoryMaintenanceMode({
  root: this.root,
  projectKey: input.projectKey,
  runDir: run.run_dir,
  absoluteRunDir: run.absolute_run_dir,
  targetRepoDir: this.root,
  baseWikiDir: resolveInside(this.root, "projects", input.projectKey, "wiki"),
  pendingSources: pendingSourcesFromPacket(packet),
  provider: input.provider,
  modelOverride: input.modelOverride,
  env: input.env,
  runner: input.runner,
  now: input.now,
});
if (maintenance.status === "failed") return failedRunResultFromMaintenance(input, run, maintenance);
const promotion = await promoteDraftWiki({
  root: this.root,
  projectKey: input.projectKey,
  runDir: run.run_dir,
  absoluteRunDir: run.absolute_run_dir,
  mode: "maintain",
  draftWikiDir: maintenance.draft_wiki_dir,
  curatorOutputRef: "reports/documentation-maintenance-report.json",
  state: agentStateForMaintenanceRun(input, run, maintenance),
  sourceConsumptions: maintenance.source_consumptions,
});
return runResultFromAgentFlow(input, run, "maintain", "maintenance", null, maintenance, promotion);
```

- [ ] **Step 3: Run focused service tests**

Run: `bun test tests/project/project-memory-curator-service.test.ts`  
Expected: maintenance-only tests pass.

### Task 4: Wire Recreate And CLI Output

**Files:**
- Modify: `src/project/project-memory-curator-service.ts`
- Modify: `src/commands/project.ts`
- Test: `tests/commands/project.test.ts`

- [ ] **Step 1: Add recreate test**

```ts
test("project learn --recreate forces create flow even when curated state exists", async () => {
  await seedProject("curated");
  const fixtures = join(root, "fixtures");
  await seedAgentAuthoringFixtures(fixtures);
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    env: { FILE_AUTHORING_STUB_OUTPUTS_DIR: fixtures },
    now: () => new Date("2026-07-06T00:00:00.000Z"),
  });
  const response = await cli.run(["project", "learn", "demo", "--recreate"]);
  expect(response.message).toContain("run kind: recreate");
});

async function seedAgentAuthoringFixtures(fixtures: string): Promise<void> {
  await mkdir(join(fixtures, "create-planner", "draft-wiki"), { recursive: true });
  await writeFile(join(fixtures, "create-planner", "draft-wiki", "index.md"), "# Demo\n\n- [Runtime](runtime.md)\n", "utf8");
  await writeFile(join(fixtures, "create-planner", "draft-wiki", "runtime.md"), "# Runtime\n\nplanner placeholder only\n", "utf8");
  await mkdir(join(fixtures, "create-planner", "reports"), { recursive: true });
  await writeJson(join(fixtures, "create-planner", "reports", "documentation-subject-manifest.json"), {
    schema_version: 1,
    project_key: "demo",
    subjects: [{
      subject_id: "runtime",
      wiki_path: "runtime.md",
      title: "Runtime",
      purpose: "Document runtime behavior",
      suggested_repo_paths: ["src/runtime"],
    }],
  });
  await writeJson(join(fixtures, "create-planner", "reports", "documentation-planner-report.json"), {
    schema_version: 1,
    project_key: "demo",
    status: "completed",
    evidence_paths: ["src/runtime"],
    known_gaps: [],
  });
  await mkdir(join(fixtures, "subject-runtime", "draft-wiki"), { recursive: true });
  await writeFile(join(fixtures, "subject-runtime", "draft-wiki", "runtime.md"), "# Runtime\n\nwriter detail\n", "utf8");
  await mkdir(join(fixtures, "subject-runtime", "reports"), { recursive: true });
  await writeJson(join(fixtures, "subject-runtime", "reports", "subject-report.json"), {
    schema_version: 1,
    project_key: "demo",
    subject_id: "runtime",
    wiki_path: "runtime.md",
    status: "completed",
    evidence_paths: ["src/runtime"],
    touched_paths: ["runtime.md"],
    known_gaps: [],
  });
  await mkdir(join(fixtures, "maintenance", "draft-wiki"), { recursive: true });
  await writeFile(join(fixtures, "maintenance", "draft-wiki", "index.md"), "# Demo\n\n- [Runtime](runtime.md)\n", "utf8");
  await writeFile(join(fixtures, "maintenance", "draft-wiki", "runtime.md"), "# Runtime\n\nwriter detail\n\nmaintenance-added detail\n", "utf8");
  await mkdir(join(fixtures, "maintenance", "reports"), { recursive: true });
  await writeJson(join(fixtures, "maintenance", "reports", "documentation-maintenance-report.json"), {
    schema_version: 1,
    project_key: "demo",
    status: "completed",
    dispositions: [],
    touched_paths: ["runtime.md"],
    evidence_paths: ["src/runtime"],
    known_gaps: [],
  });
}
```

- [ ] **Step 2: Set recreate run kind**

When `input.recreate` is true and create succeeds, set:

```ts
curation_kind: "agent_authored",
run_kind: "recreate"
```

in the state and result. The mode remains `"create"` because the canonical operation is create publication.

- [ ] **Step 3: Update human output**

In `projectLearnCommand`, add:

```ts
if (result.run_kind) lines.push(`run kind: ${result.run_kind}`);
```

- [ ] **Step 4: Run CLI tests**

Run: `bun test tests/commands/project.test.ts`  
Expected: passes.

## Verification

- Run: `bun test tests/project/project-memory-curator-service.test.ts`  
  Expected: pass after replacing old structured curator expectations with agent-authored create/maintenance expectations.
- Run: `bun test tests/project/project-service.test.ts`  
  Expected: pass.
- Run: `bun test tests/commands/project.test.ts`  
  Expected: pass.
- Run: `bun run typecheck`  
  Expected: pass.

## Acceptance Criteria Covered

- First run executes create then maintenance before promotion.
- Later runs execute maintenance only.
- Candidate-specific maintenance degradation after create can still promote the create snapshot.
- Unsafe, infrastructure, or corrupt maintenance failures block promotion.
- `--recreate` is explicit and visible through `run_kind: recreate`.
- Human and JSON result output expose curation kind and agent artifacts.

## Risks And Rollback

- Risk: current `ProjectMemoryCuratorService` has large old-path code. Keep old helper functions temporarily if tests still import them, but make the public `runProjectLearn` path agent-authored.
- Risk: packet pending field names may differ from the adapter snippet. Resolve by reading `ProjectMemoryPacket` and keeping the adapter local to this chunk.
- Rollback: restore previous `runProjectLearn` body; chunks `07` and `08` must not proceed.

## Non-Goals

- Does not delete old validator/schema files.
- Does not change retrieval indexing behavior beyond preserving current post-apply calls if already present.
- Does not run live dogfood.
- Does not add a third create-mode synthesis agent.

## Type And Name Consistency

- Public method remains `ProjectMemoryCuratorService.runProjectLearn`.
- Authorship result field: `curation_kind`.
- Topology result field: `run_kind`.
- Recreate input: `RunProjectMemoryCuratorInput.recreate`.
- First-run `run_kind`: `create_then_maintenance`.
- Later-run `run_kind`: `maintenance`.
- Explicit recreate `run_kind`: `recreate`.
