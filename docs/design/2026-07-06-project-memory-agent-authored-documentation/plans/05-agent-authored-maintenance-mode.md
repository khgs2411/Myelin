# Chunk 05: Agent-Authored Maintenance Mode

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `01-contracts-state-and-cli-surface.md`, `02-file-authoring-runner.md`, `03-draft-wiki-promotion.md`  
**Enables:** `06-project-learn-composition-and-recreate.md`, `08-live-dogfood-and-acceptance.md`

## Goal

Implement candidate-guided maintenance as one file-authoring agent. The maintenance agent receives the existing wiki draft or canonical wiki plus pending project candidates and project handoffs, edits markdown directly inside a draft wiki, writes a disposition report, and returns source-consumption records for promotion. This chunk owns maintenance behavior only; first-run composition and fallback rules are chunk `06`.

## Source Artifacts

- `../spec.md`: maintenance mode, candidate dispositions, first-run second phase.
- `../agenda.md`: maintenance handles candidates after create and on later runs.
- `../../../adr/0067-use-agent-authored-project-memory-documentation.md`.
- Chunk outputs:
  - `src/project/project-memory-agent-contracts.ts`
  - `src/runtime/file-authoring-agent.ts`
  - `src/project/project-memory-draft-promotion.ts`
- Current code:
  - `src/memory/candidates.ts`
  - `src/memory/handoffs.ts`
  - `src/project/project-memory-packet.ts`
  - `src/project/project-memory-source-consumption-reconciler.ts`

## Relationships

- **Depends on:** contracts, file-authoring runner, draft promotion helper.
- **Enables:** `project learn` first-run create plus maintenance and later maintenance-only runs.
- **Shared contracts:** `runProjectMemoryMaintenanceMode`, `ProjectMemoryMaintenanceModeInput`, `ProjectMemoryMaintenanceModeResult`, `reports/documentation-maintenance-report.json`.
- **Integration points:** pending packet inputs from current packet builder, source-consumption records, draft wiki promotion.

## File Responsibility Map

**Create:**
- `src/project/project-memory-agent-maintenance-service.ts` - maintenance agent prompt, draft wiki preparation, report parsing, source-consumption conversion.
- `tests/project/project-memory-agent-maintenance-service.test.ts` - fixture-backed maintenance agent behavior.

**Modify:**
- `src/project/project-memory-agent-contracts.ts` - add report guards if chunk `01` did not include them.

**Test:**
- `tests/project/project-memory-source-consumption-reconciler.test.ts` - remains the lifecycle reconciliation contract; chunk `01` updates it.

## Implementation Tasks

### Task 1: Prepare A Draft Wiki And Invoke Maintenance Agent

**Files:**
- Create: `src/project/project-memory-agent-maintenance-service.ts`
- Test: `tests/project/project-memory-agent-maintenance-service.test.ts`

- [ ] **Step 1: Add maintenance orchestration test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectMemoryMaintenanceMode } from "../../src/project/project-memory-agent-maintenance-service.ts";

describe("runProjectMemoryMaintenanceMode", () => {
  test("updates draft wiki and returns source consumptions from report dispositions", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-maintenance-service-"));
    const canonicalWiki = join(root, "projects", "demo", "wiki");
    await mkdir(canonicalWiki, { recursive: true });
    await writeFile(join(canonicalWiki, "index.md"), "# Demo\n\n- [Runtime](runtime.md)\n", "utf8");
    await writeFile(join(canonicalWiki, "runtime.md"), "# Runtime\n\nExisting docs.\n", "utf8");

    const fixtures = join(root, "fixtures");
    await mkdir(join(fixtures, "maintenance", "draft-wiki"), { recursive: true });
    await writeFile(join(fixtures, "maintenance", "draft-wiki", "runtime.md"), "# Runtime\n\nExisting docs.\n\nCandidate detail.\n", "utf8");
    await mkdir(join(fixtures, "maintenance", "reports"), { recursive: true });
    await writeFile(join(fixtures, "maintenance", "reports", "documentation-maintenance-report.json"), JSON.stringify({
      schema_version: 1,
      project_key: "demo",
      status: "completed",
      dispositions: [{
        source_kind: "project_candidate",
        source_ref: "cand_1",
        disposition: "applied_to_project_memory",
        reason: "runtime docs updated",
        output_refs: ["wiki/runtime.md"],
      }],
      touched_paths: ["runtime.md"],
      evidence_paths: ["src/runtime/index.ts"],
      known_gaps: [],
    }, null, 2));

    const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-1");
    const result = await runProjectMemoryMaintenanceMode({
      root,
      projectKey: "demo",
      runDir: "projects/demo/runs/project-learn/run-1",
      absoluteRunDir: runDir,
      targetRepoDir: root,
      baseWikiDir: canonicalWiki,
      pendingSources: [{
        source_kind: "project_candidate",
        source_ref: "cand_1",
        summary: "Runtime detail",
        body: "Candidate detail.",
      }],
      provider: "codex",
      env: { FILE_AUTHORING_STUB_OUTPUTS_DIR: fixtures },
      now: new Date("2026-07-06T00:00:00.000Z"),
    });

    expect(result.status).toBe("completed");
    expect(result.source_consumptions.map((record) => record.terminal_decision)).toEqual(["applied_to_project_memory"]);
    expect(await readFile(join(result.draft_wiki_dir, "runtime.md"), "utf8")).toContain("Candidate detail");
  });
});
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/project/project-memory-agent-maintenance-service.test.ts`  
Expected: fails because the maintenance service does not exist.

- [ ] **Step 3: Implement public types**

```ts
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Provider } from "../runtime/config.ts";
import type { ProcessRunner } from "../runtime/llm-client.ts";
import { invokeFileAuthoringAgent } from "../runtime/project-run-infrastructure.ts";
import { readJson } from "../runtime/json.ts";
import type {
  ProjectMemoryMaintenanceReport,
} from "./project-memory-agent-contracts.ts";
import type { ProjectMemorySourceConsumptionRecord } from "./project-memory-apply-contracts.ts";

export type ProjectMemoryMaintenancePendingSource = {
  source_kind: "project_candidate" | "project_handoff";
  source_ref: string;
  summary: string;
  body: string;
};

export type ProjectMemoryMaintenanceModeInput = {
  root: string;
  projectKey: string;
  runDir: string;
  absoluteRunDir: string;
  targetRepoDir: string;
  baseWikiDir: string;
  pendingSources: ProjectMemoryMaintenancePendingSource[];
  provider?: Provider;
  modelOverride?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  now?: Date;
};

export type ProjectMemoryMaintenanceModeResult = {
  status: "completed" | "degraded" | "failed";
  project_key: string;
  draft_wiki_dir: string;
  maintenance_report_ref: "reports/documentation-maintenance-report.json";
  report: ProjectMemoryMaintenanceReport;
  source_consumptions: ProjectMemorySourceConsumptionRecord[];
  file_authoring_run_refs: string[];
  error?: string;
};
```

- [ ] **Step 4: Implement maintenance flow**

```ts
export async function runProjectMemoryMaintenanceMode(
  input: ProjectMemoryMaintenanceModeInput,
): Promise<ProjectMemoryMaintenanceModeResult> {
  const workspaceDir = join(input.absoluteRunDir, "agents", "maintenance");
  const draftWikiDir = join(workspaceDir, "draft-wiki");
  await mkdir(workspaceDir, { recursive: true });
  await cp(input.baseWikiDir, draftWikiDir, { recursive: true });

  const agent = await invokeFileAuthoringAgent({
    root: input.root,
    projectKey: input.projectKey,
    stageId: "maintenance",
    prompt: maintenancePrompt(input),
    runDir: input.absoluteRunDir,
    targetRepoDir: input.targetRepoDir,
    workspaceDir,
    outputRoots: [
      { name: "draft_wiki", relativePath: "draft-wiki" },
      { name: "maintenance_reports", relativePath: "reports" },
    ],
    provider: input.provider,
    modelOverride: input.modelOverride,
    env: input.env,
    runner: input.runner,
  });
  if (agent.status !== "completed") return failedMaintenanceResult(input, draftWikiDir, agent.error ?? "maintenance agent failed");

  const report = await readJson<ProjectMemoryMaintenanceReport>(join(workspaceDir, "reports", "documentation-maintenance-report.json"));
  assertMaintenanceReport(input.projectKey, report);
  return {
    status: report.status,
    project_key: input.projectKey,
    draft_wiki_dir: draftWikiDir,
    maintenance_report_ref: "reports/documentation-maintenance-report.json",
    report,
    source_consumptions: sourceConsumptionsFromReport(input, report),
    file_authoring_run_refs: ["agents/maintenance/file-authoring-agent-result.json"],
  };
}
```

### Task 2: Validate Report Semantics Without Quality Gates

**Files:**
- Modify: `src/project/project-memory-agent-maintenance-service.ts`
- Test: `tests/project/project-memory-agent-maintenance-service.test.ts`

- [ ] **Step 1: Add report validation tests**

```ts
test("rejects unknown disposition values", () => {
  expect(() => assertMaintenanceReport("demo", {
    schema_version: 1,
    project_key: "demo",
    status: "completed",
    dispositions: [{
      source_kind: "project_candidate",
      source_ref: "cand_1",
      disposition: "blocked_by_quality",
      reason: "old gate",
      output_refs: [],
    }],
    touched_paths: [],
    evidence_paths: [],
    known_gaps: [],
  } as never)).toThrow("unsupported maintenance disposition");
});
```

- [ ] **Step 2: Implement report checks**

```ts
import { isProjectMemoryAgentCandidateDisposition } from "./project-memory-agent-contracts.ts";

export function assertMaintenanceReport(projectKey: string, report: ProjectMemoryMaintenanceReport): void {
  if (report.schema_version !== 1) throw new Error("maintenance report schema_version must be 1");
  if (report.project_key !== projectKey) throw new Error("maintenance report project_key mismatch");
  if (!["completed", "degraded", "failed"].includes(report.status)) throw new Error(`unsupported maintenance status: ${report.status}`);
  if (!Array.isArray(report.dispositions)) throw new Error("maintenance report dispositions must be an array");
  for (const disposition of report.dispositions) {
    if (!isProjectMemoryAgentCandidateDisposition(disposition.disposition)) {
      throw new Error(`unsupported maintenance disposition: ${disposition.disposition}`);
    }
    if (!disposition.source_ref) throw new Error("maintenance disposition source_ref is required");
    if (!disposition.reason) throw new Error(`maintenance disposition reason is required for ${disposition.source_ref}`);
  }
}
```

This check enforces report shape and disposition vocabulary only. It does not score documentation quality.

- [ ] **Step 3: Convert terminal dispositions to source consumptions**

```ts
function sourceConsumptionsFromReport(
  input: ProjectMemoryMaintenanceModeInput,
  report: ProjectMemoryMaintenanceReport,
): ProjectMemorySourceConsumptionRecord[] {
  const terminal = new Set(["applied_to_project_memory", "already_covered", "not_durable", "belongs_to_other_layer", "insufficient_evidence"]);
  const consumedAt = (input.now ?? new Date()).toISOString();
  return report.dispositions
    .filter((item) => terminal.has(item.disposition))
    .map((item) => ({
      source_kind: item.source_kind,
      source_ref: item.source_ref,
      project_key: input.projectKey,
      consumed_by_run: input.runDir,
      consumed_at: consumedAt,
      terminal_decision: item.disposition,
      output_refs: item.output_refs,
    }));
}
```

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/project/project-memory-agent-maintenance-service.test.ts`  
Expected: passes.

### Task 3: Build Candidate-Guided Prompt

**Files:**
- Modify: `src/project/project-memory-agent-maintenance-service.ts`
- Test: `tests/project/project-memory-agent-maintenance-service.test.ts`

- [ ] **Step 1: Add prompt test**

```ts
test("maintenance prompt includes every pending source id", () => {
  const prompt = maintenancePrompt({
    projectKey: "demo",
    pendingSources: [
      { source_kind: "project_candidate", source_ref: "cand_1", summary: "A", body: "Body A" },
      { source_kind: "project_handoff", source_ref: "handoff_1", summary: "B", body: "Body B" },
    ],
  } as never);
  expect(prompt).toContain("cand_1");
  expect(prompt).toContain("handoff_1");
  expect(prompt).toContain("already_covered");
});
```

- [ ] **Step 2: Implement prompt**

```ts
export function maintenancePrompt(input: Pick<ProjectMemoryMaintenanceModeInput, "projectKey" | "pendingSources">): string {
  return [
    `You are maintaining Project Memory documentation for project ${input.projectKey}.`,
    "Read the existing draft-wiki and the repository.",
    "Use the pending sources below only as leads. Verify durable claims against the repository before changing docs.",
    "Update existing canonical pages when they are the right home; create new pages only when the existing wiki lacks a good home.",
    "You may update draft-wiki/index.md if the documentation shape changes.",
    "Write reports/documentation-maintenance-report.json with schema_version 1, project_key, status, dispositions, touched_paths, evidence_paths, and known_gaps.",
    "Allowed dispositions: applied_to_project_memory, already_covered, insufficient_evidence, not_durable, belongs_to_other_layer, deferred_unsafe_change, blocked_by_runner_failure.",
    "Pending sources:",
    JSON.stringify(input.pendingSources, null, 2),
  ].join("\n");
}
```

- [ ] **Step 3: Run prompt and service tests**

Run: `bun test tests/project/project-memory-agent-maintenance-service.test.ts`  
Expected: passes.

## Verification

- Run: `bun test tests/project/project-memory-agent-maintenance-service.test.ts`  
  Expected: pass.
- Run: `bun test tests/project/project-memory-source-consumption-reconciler.test.ts`  
  Expected: pass.
- Run: `bun run typecheck`  
  Expected: pass.

## Acceptance Criteria Covered

- Maintenance uses one agent.
- Maintenance accepts pending candidates and project handoffs as leads.
- Agent edits markdown directly in a draft wiki.
- Maintenance can update `index.md` and create new pages.
- Disposition report drives source-consumption records.
- Non-terminal dispositions do not mark sources processed.
- No structure or quality validation is added.

## Risks And Rollback

- Risk: pending source payload shape from packet builder may need adaptation in chunk `06`. This chunk defines `ProjectMemoryMaintenancePendingSource` as the service boundary.
- Risk: copying a large wiki into the agent workspace may be expensive. It is acceptable for this slice because write safety and simplicity matter more than optimizing copy cost.
- Rollback: remove `project-memory-agent-maintenance-service.ts`; old structured maintenance remains untouched until chunk `07`.

## Non-Goals

- Does not choose first-run vs later-run behavior.
- Does not promote maintenance output.
- Does not run create mode.
- Does not index retrieval sections.

## Type And Name Consistency

- Maintenance service: `runProjectMemoryMaintenanceMode`.
- Input type: `ProjectMemoryMaintenanceModeInput`.
- Result type: `ProjectMemoryMaintenanceModeResult`.
- Prompt helper: `maintenancePrompt`.
- Report artifact: `reports/documentation-maintenance-report.json`.
- Stage id: `maintenance`.
