# Chunk 01: Contracts, State, And CLI Surface

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** None  
**Enables:** `02-file-authoring-runner.md`, `03-draft-wiki-promotion.md`, `04-agent-authored-create-mode.md`, `05-agent-authored-maintenance-mode.md`, `06-project-learn-composition-and-recreate.md`

## Goal

Introduce the shared TypeScript contracts for agent-authored Project Memory before any orchestration code depends on them. This chunk owns the new subject manifest, agent reports, maintenance disposition vocabulary, Project Memory state v2, run result surface, and `project learn --recreate` CLI parsing. It also migrates the old candidate disposition vocabulary through the current enum consumers so later chunks do not carry two competing meanings.

## Source Artifacts

- `../spec.md`: create mode, maintenance mode, state v2, recreate, candidate dispositions.
- `../agenda.md`: decisions to avoid fixed file shapes and schema-quality gates.
- `../../../adr/0067-use-agent-authored-project-memory-documentation.md`: authoritative architecture.
- Current code:
  - `src/project/project-memory-curator-contracts.ts`
  - `src/project/project-memory-quality-contract.ts`
  - `src/project/project-memory-apply-contracts.ts`
  - `src/project/project-memory-source-consumption-reconciler.ts`
  - `src/project/project-memory-retrieval-contracts.ts`
  - `src/commands/project.ts`
  - `tests/commands/project.test.ts`
  - `tests/project/project-memory-quality-contract.test.ts`
  - `tests/project/project-memory-source-consumption-reconciler.test.ts`

## Relationships

- **Depends on:** no prior chunk.
- **Enables:** all implementation chunks that need stable contract names.
- **Shared contracts:** `ProjectMemoryAgentStateV2`, `ProjectMemorySubjectManifest`, `ProjectMemorySubjectReport`, `ProjectMemoryMaintenanceReport`, `ProjectMemoryAgentCandidateDisposition`, `RunProjectMemoryCuratorInput.recreate`, new result artifact names.
- **Integration points:** CLI parser, project service input, candidate source consumption reconciliation, retrieval explicit-noop compatibility.

## File Responsibility Map

**Create:**
- `src/project/project-memory-agent-contracts.ts` - new agent-authored Project Memory contracts and runtime constants.
- `tests/project/project-memory-agent-contracts.test.ts` - contract-level expectations for dispositions, state shape helpers, and manifest path rules.

**Modify:**
- `src/project/project-memory-curator-contracts.ts` - add `recreate`, agent-authored mode fields, and new artifact names to the existing public service result type.
- `src/project/project-memory-quality-contract.ts` - replace candidate disposition vocabulary for new paths and keep old quality diagnostics isolated as legacy.
- `src/project/project-memory-apply-contracts.ts` - migrate `ProjectMemorySourceConsumptionRecord.terminal_decision` to the new terminal disposition union.
- `src/project/project-memory-source-consumption-reconciler.ts` - accept new terminal dispositions and map legacy `already_trusted` to `already_covered` when reading old state.
- `src/project/project-memory-retrieval-contracts.ts` - update explicit no-op disposition compatibility types.
- `src/commands/project.ts` - parse and pass `--recreate`.

**Test:**
- `tests/project/project-memory-quality-contract.test.ts` - old quality scoring expectations either move to a legacy block or stop asserting new disposition vocabulary.
- `tests/project/project-memory-source-consumption-reconciler.test.ts` - new dispositions are terminal; old `already_trusted` remains readable.
- `tests/commands/project.test.ts` - `project learn <key> --recreate` is accepted and passed to `ProjectService.runProjectLearn`.

## Implementation Tasks

### Task 1: Add Agent Contracts

**Files:**
- Create: `src/project/project-memory-agent-contracts.ts`
- Test: `tests/project/project-memory-agent-contracts.test.ts`

- [ ] **Step 1: Add the contract test**

```ts
import { describe, expect, test } from "bun:test";
import {
  PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS,
  isProjectMemoryAgentCandidateDisposition,
  normalizeProjectMemoryAgentCandidateDisposition,
} from "../../src/project/project-memory-agent-contracts.ts";

describe("project memory agent contracts", () => {
  test("defines the maintenance disposition vocabulary", () => {
    expect([...PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS]).toEqual([
      "applied_to_project_memory",
      "already_covered",
      "insufficient_evidence",
      "not_durable",
      "belongs_to_other_layer",
      "deferred_unsafe_change",
      "blocked_by_runner_failure",
    ]);
  });

  test("normalizes legacy already_trusted as already_covered", () => {
    expect(normalizeProjectMemoryAgentCandidateDisposition("already_trusted")).toBe("already_covered");
    expect(normalizeProjectMemoryAgentCandidateDisposition("blocked_by_quality")).toBeNull();
    expect(isProjectMemoryAgentCandidateDisposition("already_covered")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/project/project-memory-agent-contracts.test.ts`  
Expected: fails because `project-memory-agent-contracts.ts` does not exist.

- [ ] **Step 3: Create the shared contract module**

```ts
export const PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS = [
  "applied_to_project_memory",
  "already_covered",
  "insufficient_evidence",
  "not_durable",
  "belongs_to_other_layer",
  "deferred_unsafe_change",
  "blocked_by_runner_failure",
] as const;

export type ProjectMemoryAgentCandidateDisposition =
  (typeof PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS)[number];

export const PROJECT_MEMORY_LEGACY_CANDIDATE_DISPOSITION_ALIASES = {
  already_trusted: "already_covered",
} as const satisfies Record<string, ProjectMemoryAgentCandidateDisposition>;

export function normalizeProjectMemoryAgentCandidateDisposition(value: unknown): ProjectMemoryAgentCandidateDisposition | null {
  if (typeof value !== "string") return null;
  if (isProjectMemoryAgentCandidateDisposition(value)) return value;
  return PROJECT_MEMORY_LEGACY_CANDIDATE_DISPOSITION_ALIASES[
    value as keyof typeof PROJECT_MEMORY_LEGACY_CANDIDATE_DISPOSITION_ALIASES
  ] ?? null;
}

export function isProjectMemoryAgentCandidateDisposition(value: unknown): value is ProjectMemoryAgentCandidateDisposition {
  return typeof value === "string" && PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS.includes(value as ProjectMemoryAgentCandidateDisposition);
}

export type ProjectMemoryAgentProviderMode = "live" | "stub" | "test";
export type ProjectMemoryAgentCurationKind = "agent_authored" | "human_reviewed";
export type ProjectMemoryAgentRunKind = "create" | "maintenance" | "create_then_maintenance" | "recreate";
export type ProjectMemoryAgentRunStatus =
  | "completed"
  | "completed_with_pending_index"
  | "degraded"
  | "failed";

export type ProjectMemorySubjectManifest = {
  schema_version: 1;
  project_key: string;
  subjects: ProjectMemorySubjectManifestEntry[];
};

export type ProjectMemorySubjectManifestEntry = {
  subject_id: string;
  wiki_path: string;
  title: string;
  purpose: string;
  suggested_repo_paths: string[];
  depends_on_subject_ids?: string[];
};

export type ProjectMemorySubjectReport = {
  schema_version: 1;
  project_key: string;
  subject_id: string;
  wiki_path: string;
  status: "completed" | "failed";
  evidence_paths: string[];
  touched_paths: string[];
  known_gaps: string[];
  error?: string;
};

export type ProjectMemoryMaintenanceDisposition = {
  source_kind: "project_candidate" | "project_handoff";
  source_ref: string;
  disposition: ProjectMemoryAgentCandidateDisposition;
  reason: string;
  output_refs: string[];
};

export type ProjectMemoryMaintenanceReport = {
  schema_version: 1;
  project_key: string;
  status: "completed" | "degraded" | "failed";
  dispositions: ProjectMemoryMaintenanceDisposition[];
  touched_paths: string[];
  evidence_paths: string[];
  known_gaps: string[];
};

export type ProjectMemoryAgentStateV2 = {
  schema_version: 2;
  project_key: string;
  status: "curated" | "degraded" | "failed";
  source_run_dir: string;
  updated_at: string;
  provider_mode: ProjectMemoryAgentProviderMode;
  curation_kind: ProjectMemoryAgentCurationKind;
  run_kind: ProjectMemoryAgentRunKind;
  create?: {
    status: "completed" | "failed" | "skipped";
    planner_status: "completed" | "failed";
    subject_writer_status: "completed" | "failed" | "partial_failed";
    subject_count: number;
    subject_writer_concurrency_limit: number;
    subject_writer_retry_limit: number;
    manifest_ref?: string;
    planner_report_ref?: string;
    subject_report_refs: string[];
    pre_maintenance_wiki_ref?: string;
  };
  maintenance?: {
    status: "completed" | "noop" | "degraded" | "skipped" | "failed";
    report_ref?: string;
    dispositions_count: number;
    applied_count: number;
    already_covered_count: number;
    degraded_reason?: string;
    degraded_reasons: string[];
  };
  retrieval_readiness: {
    status: "ready" | "pending" | "degraded" | "not_applicable";
    checked_at: string;
    reason?: string;
  };
  content_quality?: {
    status: "not_evaluated";
    reason: "agent_authored_documentation_has_no_schema_quality_gate";
  };
};
```

- [ ] **Step 4: Run the focused test again**

Run: `bun test tests/project/project-memory-agent-contracts.test.ts`  
Expected: passes.

### Task 2: Migrate Disposition Consumers

**Files:**
- Modify: `src/project/project-memory-quality-contract.ts`
- Modify: `src/project/project-memory-apply-contracts.ts`
- Modify: `src/project/project-memory-source-consumption-reconciler.ts`
- Modify: `src/project/project-memory-retrieval-contracts.ts`
- Test: `tests/project/project-memory-source-consumption-reconciler.test.ts`

- [ ] **Step 1: Change candidate disposition exports**

In `src/project/project-memory-quality-contract.ts`, import and re-export the new agent disposition vocabulary while leaving rendered quality functions as legacy implementation details until chunk `07` removes new-path usage:

```ts
export {
  PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS as PROJECT_MEMORY_CANDIDATE_DISPOSITIONS,
} from "./project-memory-agent-contracts.ts";
export type {
  ProjectMemoryAgentCandidateDisposition as ProjectMemoryCandidateDisposition,
} from "./project-memory-agent-contracts.ts";
```

Remove the old local `PROJECT_MEMORY_CANDIDATE_DISPOSITIONS` constant and local `ProjectMemoryCandidateDisposition` type from that file.

- [ ] **Step 2: Update source consumption terminal decisions**

In `src/project/project-memory-apply-contracts.ts`, import the new type:

```ts
import type { ProjectMemoryAgentCandidateDisposition } from "./project-memory-agent-contracts.ts";
```

Replace the current string union in `ProjectMemorySourceConsumptionRecord.terminal_decision` with:

```ts
  terminal_decision: ProjectMemoryAgentCandidateDisposition;
```

- [ ] **Step 3: Normalize legacy records in the reconciler**

In `src/project/project-memory-source-consumption-reconciler.ts`, replace the old set with:

```ts
import {
  isProjectMemoryAgentCandidateDisposition,
  normalizeProjectMemoryAgentCandidateDisposition,
} from "./project-memory-agent-contracts.ts";

const TERMINAL_PROJECT_MEMORY_DISPOSITIONS = new Set([
  "applied_to_project_memory",
  "already_covered",
  "not_durable",
  "belongs_to_other_layer",
  "insufficient_evidence",
]);
```

Use this supported-record check:

```ts
const disposition = normalizeProjectMemoryAgentCandidateDisposition(record.terminal_decision);
return (
  record &&
  typeof record === "object" &&
  record.project_key === projectKey &&
  (record.source_kind === "project_candidate" || record.source_kind === "project_handoff") &&
  typeof record.source_ref === "string" &&
  record.source_ref.length > 0 &&
  disposition !== null &&
  TERMINAL_PROJECT_MEMORY_DISPOSITIONS.has(disposition)
);
```

Keep `deferred_unsafe_change` and `blocked_by_runner_failure` out of the terminal set because those do not mark a source as processed.

- [ ] **Step 4: Update retrieval no-op compatibility**

In `src/project/project-memory-retrieval-contracts.ts`, replace old no-op reason unions that include `already_trusted` with the new `ProjectMemoryAgentCandidateDisposition` subset:

```ts
import type { ProjectMemoryAgentCandidateDisposition } from "./project-memory-agent-contracts.ts";

export type ProjectMemoryExplicitNoOpDisposition = Extract<
  ProjectMemoryAgentCandidateDisposition,
  "already_covered" | "not_durable" | "belongs_to_other_layer" | "insufficient_evidence"
>;
```

Use `ProjectMemoryExplicitNoOpDisposition` anywhere the old four-value no-op reason union was used.

- [ ] **Step 5: Update reconciler tests**

Add these assertions to `tests/project/project-memory-source-consumption-reconciler.test.ts`:

```ts
sourceRecord("project_candidate", "cand_1", "already_covered");
sourceRecord("project_candidate", "legacy_cand", "already_trusted" as never);
sourceRecord("project_handoff", "handoff_unsafe", "deferred_unsafe_change");
sourceRecord("project_handoff", "handoff_blocked", "blocked_by_runner_failure");
```

Expected behavior:

```ts
expect(result.processed_candidates).toContain("cand_1");
expect(result.processed_candidates).toContain("legacy_cand");
expect(result.processed_project_handoffs).not.toContain("handoff_unsafe");
expect(result.processed_project_handoffs).not.toContain("handoff_blocked");
```

- [ ] **Step 6: Run focused tests**

Run: `bun test tests/project/project-memory-source-consumption-reconciler.test.ts tests/project/project-memory-quality-contract.test.ts`  
Expected: passes after expected old-disposition assertions are updated.

### Task 3: Add Recreate To Public Run Input And CLI Parser

**Files:**
- Modify: `src/project/project-memory-curator-contracts.ts`
- Modify: `src/commands/project.ts`
- Test: `tests/commands/project.test.ts`

- [ ] **Step 1: Extend run input and result artifacts**

In `RunProjectMemoryCuratorInput`, add:

```ts
  recreate?: boolean;
```

In `ProjectMemoryCuratorRunResult.artifacts`, add optional agent artifacts:

```ts
    subject_manifest?: "reports/documentation-subject-manifest.json";
    planner_report?: "reports/documentation-planner-report.json";
    subject_reports?: string[];
    maintenance_report?: "reports/documentation-maintenance-report.json";
    file_authoring_runs?: string[];
    pre_maintenance_wiki?: "pre-maintenance-wiki";
```

Add this result field:

```ts
  curation_kind?: "agent_authored" | "human_reviewed";
  run_kind?: "create" | "maintenance" | "create_then_maintenance" | "recreate";
```

- [ ] **Step 2: Parse `--recreate`**

In `parseProjectLearnArgs`, add `recreate: boolean` to the return type and initialize it to `false`. Handle the option beside `--dry-run`, `--review`, and `--json`:

```ts
else if (arg === "--recreate") recreate = true;
```

Return it:

```ts
return { projectKey, dryRun, review, json, provider, modelOverride, recreate };
```

Pass it in `projectLearnCommand`:

```ts
      recreate: parsed.recreate,
```

Update usage text to:

```ts
"Usage: myelin project learn <project-key> [--dry-run] [--review] [--recreate] [--provider <name>] [--model <model>] [--json]"
```

- [ ] **Step 3: Test CLI parsing**

Add a `tests/commands/project.test.ts` assertion where the fake service input is captured:

```ts
await cli.run(["project", "learn", "llm-wiki", "--recreate", "--json"]);
expect(runProjectLearnInput).toMatchObject({
  projectKey: "llm-wiki",
  recreate: true,
});
```

- [ ] **Step 4: Run focused CLI tests**

Run: `bun test tests/commands/project.test.ts`  
Expected: passes with `--recreate` accepted and unknown-option behavior unchanged for unrelated flags.

## Verification

- Run: `bun test tests/project/project-memory-agent-contracts.test.ts`  
  Expected: pass.
- Run: `bun test tests/project/project-memory-source-consumption-reconciler.test.ts tests/project/project-memory-quality-contract.test.ts`  
  Expected: pass.
- Run: `bun test tests/commands/project.test.ts`  
  Expected: pass.
- Run: `bun run typecheck`  
  Expected: pass; any failures from old disposition unions are fixed in this chunk.

## Acceptance Criteria Covered

- New candidate disposition vocabulary exists in one shared contract.
- Legacy `already_trusted` remains readable as `already_covered`.
- `blocked_by_quality` and `missing_coverage_no_grounded_write` are not accepted as new maintenance report dispositions.
- `project learn --recreate` is parsed and passed to the service layer.
- Project Memory state v2 and agent report types are available to later chunks.

## Risks And Rollback

- Risk: old tests may still assert `already_trusted`. Rollback is to keep alias normalization while updating tests to assert new canonical output.
- Risk: old validator code may import `ProjectMemoryCandidateDisposition`. This chunk keeps the export name as an alias, so old code compiles until chunk `07` removes or isolates the legacy path.
- Rollback: revert this chunk and no later agent-authored chunks can land, because all later chunks rely on these contract names.

## Non-Goals

- Does not invoke agents.
- Does not write canonical wiki files.
- Does not remove old curator validation, output schema, or rendered quality scoring.
- Does not implement `--recreate` behavior beyond CLI parsing and service input.

## Type And Name Consistency

- New module: `project-memory-agent-contracts.ts`.
- Canonical disposition type: `ProjectMemoryAgentCandidateDisposition`.
- Compatibility export: `ProjectMemoryCandidateDisposition`.
- Canonical state type: `ProjectMemoryAgentStateV2`.
- Authorship state field: `curation_kind`.
- Run topology state/result field: `run_kind`.
- CLI field: `recreate`.
