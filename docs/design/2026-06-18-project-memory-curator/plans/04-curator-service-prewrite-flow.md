# Chunk 04: Curator Service Prewrite Flow

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-curator-contracts.md`, `02-curator-validator.md`, `03-project-run-infrastructure.md`
**Enables:** `05-command-surface-and-vocabulary.md`, `06-phase-0-runner-retirement.md`

## Goal

Add `ProjectMemoryCuratorService.runProjectLearn` as the semantic owner of `project learn`. The service builds the Project Memory packet, invokes a mode-specific curator prompt, validates the returned JSON, writes curator artifacts, and stops before markdown mutation.

## Source Artifacts

- `../spec.md`: User-Facing Behavior, Mode-Scoped Authority, Run Artifacts.
- `../pseudocode/ProjectLearnCuratorFlow.md`: required flow.
- `../pseudocode/src/project/project-memory-curator-service.ts`: source-shaped service reference.
- `src/project/project-service.ts`: current service facade.
- `src/project/project-memory-packet.ts`: packet construction.
- `src/runtime/project-run-infrastructure.ts`: created by Chunk 03.

## Relationships

- **Depends on:** Contract exports, validator exports, runtime helpers.
- **Enables:** `project learn` command cutover can delegate to the service.
- **Shared contracts:** `ProjectMemoryCuratorService.runProjectLearn(input)`, `ProjectMemoryCuratorRunResult`.
- **Integration points:** `src/project/project-service.ts`, `tests/project/project-memory-curator-service.test.ts`, `tests/project/project-service.test.ts`.

## File Responsibility Map

**Create:**
- `src/project/project-memory-curator-service.ts` - semantic `project learn` curator flow.
- `tests/project/project-memory-curator-service.test.ts` - artifacts, validation, no-write behavior.

**Modify:**
- `src/project/project-service.ts` - add `runProjectLearn` facade without changing current `runPipeline` yet.

**Test:**
- `tests/project/project-memory-curator-service.test.ts` - service behavior.
- `tests/project/project-service.test.ts` - facade delegation if covered.

## Implementation Tasks

### Task 1: Add Curator Service Tests

**Files:**
- Create: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Add no-write artifact tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectMemoryCuratorService } from "../../src/project/project-memory-curator-service.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-curator-service-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("runs project learn in create mode, writes curator artifacts, and stops before wiki writes", async () => {
  await seedProject("uncurated");
  await seedSchema();
  const originalWiki = await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8");
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T10:00:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schema_version: 1,
        project_key: "demo",
        mode: "create",
        packet_ref: { run_dir: "projects/demo/runs/project-learn/2026-06-23T10-00-00.000Z-run", artifact: "input-packet.json", packet_schema_version: 1 },
        summary: "Initial brain draft",
        brain_intent: { name: "Demo", first_brain_summary: "Create first brain", untrusted_existing_markdown_policy: "adopt" },
        pages: [{ id: "page_index", target: { path: "index.md", path_kind: "new_wiki_page" }, title: "Demo", purpose: "Index", content_intent: "Create index", required_sections: ["Overview"], evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }], repo_citations: [], notes_for_apply: [] }],
        state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
        evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
        repo_citations: [],
        risk: { level: "low", reasons: [], requires_quarantine: false },
      }),
      stderr: "",
    }),
  });

  expect(result.status).toBe("completed");
  expect(result.mode).toBe("create");
  expect(result.stopped_before_writes).toBe(true);
  expect(result.artifacts.input_packet).toBe("input-packet.json");
  expect(result.artifacts.curator_output).toBe("curator-creation-draft.json");
  expect(await Bun.file(join(root, result.run_dir, "curator-validation.json")).exists()).toBe(true);
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toBe(originalWiki);
});

test("runs maintain mode and returns needs_review when validation rejects all items", async () => {
  await seedProject("curated");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T11:00:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schema_version: 1,
        project_key: "demo",
        mode: "maintain",
        packet_ref: { run_dir: "projects/demo/runs/project-learn/2026-06-23T11-00-00.000Z-run", artifact: "input-packet.json", packet_schema_version: 1 },
        summary: "Rejected update",
        items: [{ id: "bad", operation: "PATCH_ENTRY", target_page: { path: "../state/project.json", path_kind: "existing_wiki_page" }, content_intent: "bad", source_packet_refs: [], evidence_refs: [], repo_citations: [], applicability: {}, lifecycle_intent: "active", risk: { level: "low", reasons: [], requires_quarantine: false }, preconditions: [], expected_outcome: "reject" }],
        noop_inputs: [],
        risk: { level: "low", reasons: [], requires_quarantine: false },
      }),
      stderr: "",
    }),
  });

  expect(result.status).toBe("needs_review");
  expect(result.validation_ok).toBe(false);
  expect(result.stopped_reason).toBe("curator validation did not produce eligible output");
});

test("writes failure artifacts when provider invocation fails after packet creation", async () => {
  await seedProject("curated");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T12:00:00.000Z"),
    runner: async () => ({ exitCode: 2, stdout: "", stderr: "provider unavailable" }),
  });

  expect(result.status).toBe("failed");
  expect(result.validation_ok).toBe(false);
  expect(result.artifacts.curator_output).toBe("curator-output-error.json");
  expect(await Bun.file(join(root, result.run_dir, "curator-validation.json")).exists()).toBe(true);
  expect(await readFile(join(root, result.run_dir, "summary.md"), "utf8")).toContain("provider invocation failed");
});

test("writes failure artifacts when curator output is not valid JSON", async () => {
  await seedProject("curated");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T12:30:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "not json", stderr: "" }),
  });

  expect(result.status).toBe("failed");
  expect(result.validation_ok).toBe(false);
  expect(result.stopped_reason).toContain("curator output was not valid JSON");
  expect(await Bun.file(join(root, result.run_dir, "curator-run-result.json")).exists()).toBe(true);
});

async function seedProject(status: "curated" | "uncurated"): Promise<void> {
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [join(root, "repos", "demo")],
  });
  await writeJson(join(root, "projects", "demo", "state", "bootstrap-state.json"), { status });
  if (status === "curated") await writeJson(join(root, "projects", "demo", "state", "project-memory.json"), { status: "curated" });
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "index.md"), "# Demo\n", "utf8");
}

async function seedSchema(): Promise<void> {
  await mkdir(join(root, "schema", "rules"), { recursive: true });
  await writeFile(join(root, "schema", "global.md"), "Project schema\n", "utf8");
  await writeJson(join(root, "schema", "rules", "source-classification.json"), { source_kind: ["handoff"], ownership: ["project"], action: ["update-existing-pages"], required_fields: ["source_kind"] });
  await writeJson(join(root, "schema", "rules", "memory-scopes.json"), { phase_0_active: ["project"], phase_0_deferred: [], scopes: [{ key: "project", description: "Project" }] });
  await writeJson(join(root, "schema", "rules", "page-taxonomy.json"), { categories: [{ key: "setup", description: "Setup" }] });
}
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/project/project-memory-curator-service.test.ts`
Expected: fails because `ProjectMemoryCuratorService` does not exist.

### Task 2: Implement Curator Service

**Files:**
- Create: `src/project/project-memory-curator-service.ts`

- [ ] **Step 1: Add service implementation**

```ts
import { buildProjectMemoryPacket } from "./project-memory-packet.ts";
import type { ProjectMemoryCuratorRunResult, ProjectMemoryCuratorValidationResult, RunProjectMemoryCuratorInput } from "./project-memory-curator-contracts.ts";
import { validateCuratorOutput } from "./project-memory-curator-validator.ts";
import { repairProjectShell } from "../runtime/project-shell.ts";
import { findProject } from "../runtime/projects.ts";
import { stableJson } from "../runtime/json.ts";
import {
  createProjectCuratorRun,
  ensureProjectLearnSchemaContext,
  invokeProjectCurator,
  writeMarkdownArtifact,
  writeRunArtifact,
} from "../runtime/project-run-infrastructure.ts";

export class ProjectMemoryCuratorService {
  constructor(private readonly root: string) {}

  async runProjectLearn(input: RunProjectMemoryCuratorInput): Promise<ProjectMemoryCuratorRunResult> {
    const now = input.now ?? new Date();
    const project = await findProject(this.root, input.projectKey);
    if (!input.dryRun) await repairProjectShell(this.root, input.projectKey, { repoPath: project.config.repo_paths?.[0] });

    const run = await createProjectCuratorRun(this.root, input.projectKey, now);
    await ensureProjectLearnSchemaContext(this.root, input.projectKey, { dryRun: input.dryRun, now });
    const packet = await buildProjectMemoryPacket(this.root, input.projectKey);
    await writeRunArtifact(run, "input-packet.json", packet);

    const stageId = packet.mode === "create" ? "curator-create" : "curator-maintain";
    let curator;
    try {
      curator = await invokeProjectCurator({
        root: this.root,
        stageId,
        prompt: this.promptFor(packet.mode, run.relative_run_dir, packet),
        provider: input.provider,
        modelOverride: input.modelOverride,
        env: input.env,
        runner: input.runner,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stoppedReason = message.includes("response is not valid JSON") || message.includes("empty output")
        ? `curator output was not valid JSON: ${message}`
        : `provider invocation failed: ${message}`;
      const validation = this.failureValidation(input.projectKey, packet.mode, "curator_invocation_failed", stoppedReason);
      await writeRunArtifact(run, "curator-output-error.json", { error: stoppedReason });
      await writeRunArtifact(run, "curator-validation.json", validation);
      const result = this.buildResult(input, packet.mode, run.run_id, run.relative_run_dir, "curator-output-error.json", validation, "failed", stoppedReason);
      await writeRunArtifact(run, "curator-run-result.json", result);
      await writeMarkdownArtifact(run, "summary.md", this.summaryFor(result));
      return result;
    }

    const outputArtifact = packet.mode === "create" ? "curator-creation-draft.json" : "curator-maintenance-proposal.json";
    await writeRunArtifact(run, outputArtifact, curator.response);
    const validation = validateCuratorOutput(packet, curator.response);
    await writeRunArtifact(run, "curator-validation.json", validation);

    const status = validation.ok && !input.review ? "completed" : "needs_review";
    const stoppedReason = validation.ok ? undefined : "curator validation did not produce eligible output";
    const result = this.buildResult(input, packet.mode, run.run_id, run.relative_run_dir, outputArtifact, validation, status, stoppedReason);

    await writeRunArtifact(run, "curator-run-result.json", result);
    await writeMarkdownArtifact(run, "summary.md", this.summaryFor(result));
    return result;
  }

  private promptFor(mode: "create" | "maintain", runDir: string, packet: unknown): string {
    const outputName = mode === "create" ? "ProjectMemoryCreationDraft" : "ProjectMemoryMaintenanceProposal";
    return [
      "You are the Project Memory Curator.",
      `Run directory: ${runDir}`,
      `Input packet artifact: ${runDir}/input-packet.json`,
      `Return ONLY strict JSON matching ${outputName}.`,
      "Use packet references from the input packet. Do not invent packet refs.",
      "Do not write files. Do not mutate wiki markdown.",
      mode === "create"
        ? "Create mode: propose the first trusted Project Memory brain draft."
        : "Maintain mode: propose bounded itemized Project Memory updates only.",
      "",
      "Input packet JSON:",
      stableJson(packet),
    ].join("\n");
  }

  private buildResult(
    input: RunProjectMemoryCuratorInput,
    mode: "create" | "maintain",
    runId: string,
    runDir: string,
    outputArtifact: string,
    validation: ProjectMemoryCuratorValidationResult,
    status: ProjectMemoryCuratorRunResult["status"],
    stoppedReason?: string,
  ): ProjectMemoryCuratorRunResult {
    return {
      status,
      project_key: input.projectKey,
      mode,
      run_id: runId,
      run_dir: runDir,
      artifacts: {
        input_packet: "input-packet.json",
        curator_output: outputArtifact,
        curator_validation: "curator-validation.json",
        curator_run_result: "curator-run-result.json",
        summary: "summary.md",
      },
      validation_ok: validation.ok,
      stopped_before_writes: true,
      dry_run: input.dryRun,
      review: input.review,
      stopped_reason: stoppedReason,
    };
  }

  private failureValidation(projectKey: string, mode: "create" | "maintain", code: string, message: string): ProjectMemoryCuratorValidationResult {
    return {
      ok: false,
      mode,
      project_key: projectKey,
      global_findings: [{ severity: "blocker", code, message }],
      item_results: [],
      eligible_item_ids: [],
      rejected_item_ids: [],
      quarantined_item_ids: [],
      noop_refs: [],
    };
  }

  private summaryFor(result: ProjectMemoryCuratorRunResult): string {
    return [
      `# Project learn ${result.project_key}`,
      "",
      `mode: ${result.mode}`,
      `status: ${result.status}`,
      `validation_ok: ${result.validation_ok}`,
      `stopped_before_writes: ${result.stopped_before_writes}`,
      result.stopped_reason ? `stopped_reason: ${result.stopped_reason}` : "",
      "",
    ].filter(Boolean).join("\n");
  }
}
```

- [ ] **Step 2: Run focused service tests**

Run: `bun test tests/project/project-memory-curator-service.test.ts`
Expected: passes.

### Task 3: Add ProjectService Facade

**Files:**
- Modify: `src/project/project-service.ts`
- Test: `tests/project/project-service.test.ts`

- [ ] **Step 1: Modify imports and add facade method**

```ts
import { ProjectMemoryCuratorService } from "./project-memory-curator-service.ts";
import type { ProjectMemoryCuratorRunResult, RunProjectMemoryCuratorInput } from "./project-memory-curator-contracts.ts";
```

Add to `ProjectService`:

```ts
async runProjectLearn(input: Omit<RunProjectMemoryCuratorInput, "projectKey"> & { projectKey: string }): Promise<ProjectMemoryCuratorRunResult> {
  return new ProjectMemoryCuratorService(this.root).runProjectLearn(input);
}
```

- [ ] **Step 2: Run project service tests**

Run: `bun test tests/project/project-service.test.ts`
Expected: existing tests still pass.

## Verification

- `bun test tests/project/project-memory-curator-service.test.ts`
  - Expected: create, maintain validation-failure, provider-failure, and invalid-JSON service tests pass.
- `bun test tests/project/project-service.test.ts`
  - Expected: existing service tests pass.
- `bun run typecheck`
  - Expected: service, validator, and runtime helper imports typecheck.

## Acceptance Criteria Covered

- `project learn` can use Project Memory packet as curator input through a service boundary.
- Curator output is validated before writes.
- Curator-specific artifacts are written.
- Provider failures and malformed curator JSON still write `curator-validation.json`, `curator-run-result.json`, and `summary.md` after run directory and input packet creation.
- The slice stops before canonical wiki markdown mutation.

## Risks And Rollback

- Risk: prompt text may need tightening after provider smoke tests. Keep the first implementation strict: JSON only, no files, no wiki mutation.
- Risk: creation validation is intentionally structural; maintenance validation owns stricter item outcomes.
- Rollback: remove `ProjectMemoryCuratorService`, its tests, and the `ProjectService.runProjectLearn` facade. Existing `runPipeline` remains untouched until Chunk 05.

## Non-Goals

- No CLI command cutover.
- No `project ingest` removal.
- No `runner.ts` deletion.
- No markdown apply.

## Type And Name Consistency

Before marking this chunk done, verify `ProjectMemoryCuratorService.runProjectLearn` returns `ProjectMemoryCuratorRunResult` and no file in `src/project/project-memory-curator-service.ts` imports `../pipeline/runner.ts`.
