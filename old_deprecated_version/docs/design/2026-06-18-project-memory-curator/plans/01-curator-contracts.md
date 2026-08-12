# Chunk 01: Curator Contracts

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** None
**Enables:** `02-curator-validator.md`, `04-curator-service-prewrite-flow.md`

## Goal

Add the shared Project Memory Curator TypeScript contract surface under `src/project/`. This chunk creates the common evidence/path/risk primitives plus separate creation and maintenance top-level contracts. It does not invoke a provider, validate filesystem state, write run artifacts, or change CLI behavior.

## Source Artifacts

- `../spec.md`: Curator Output Contracts, Data / State, Acceptance Criteria.
- `../agenda.md`: Question 6 chose separate creation and maintenance contracts; Question 7 removes `project ingest` from target Project Memory.
- `../pseudocode/src/project/project-memory-curator-contracts.ts`: source-shaped contract reference.
- `../../../../adr/0058-use-mode-scoped-project-learn-curator-contracts.md`: mode-scoped curator contract decision.
- `src/project/project-memory-packet.ts`: provides `ProjectMemoryPacket` and packet `mode`.

## Relationships

- **Depends on:** Existing `ProjectMemoryPacket`.
- **Enables:** Validator logic can import one stable contract file; service result types can reuse `RunProjectMemoryCuratorInput` and `ProjectMemoryCuratorRunResult`.
- **Shared contracts:** `ProjectMemoryCuratorMode`, evidence refs, repo citations, path refs, risk, validation findings, creation draft, maintenance proposal, validation result, run input, run result.
- **Integration points:** `src/project/project-memory-curator-validator.ts`, `src/project/project-memory-curator-service.ts`, `tests/project/project-memory-curator-contracts.test.ts`.

## File Responsibility Map

**Create:**
- `src/project/project-memory-curator-contracts.ts` - exported curator contract types and narrow runtime constants for operations/outcomes.
- `tests/project/project-memory-curator-contracts.test.ts` - sanity checks for exported runtime constants.

**Modify:**
- None.

**Test:**
- `tests/project/project-memory-curator-contracts.test.ts` - proves operations and outcomes stay stable for dependent chunks.

## Implementation Tasks

### Task 1: Add Curator Contract Exports

**Files:**
- Create: `src/project/project-memory-curator-contracts.ts`

- [ ] **Step 1: Create the contract file**

```ts
import type { ProjectMemoryPacket } from "./project-memory-packet.ts";

export const PROJECT_MEMORY_MAINTENANCE_OPERATIONS = [
  "CREATE_ENTRY",
  "PATCH_ENTRY",
  "ATTACH_EVIDENCE",
  "MARK_STALE",
  "MARK_DISPUTED",
  "SUPERSEDE_ENTRY",
  "RETRACT_ENTRY",
  "NOOP",
] as const;

export const PROJECT_MEMORY_VALIDATION_OUTCOMES = [
  "eligible",
  "rejected",
  "quarantined",
  "noop",
] as const;

export type ProjectMemoryCuratorMode = "create" | "maintain";

export type ProjectMemoryEvidenceKind =
  | "project_handoff"
  | "project_candidate"
  | "session_memory"
  | "wiki_page"
  | "lookup_result"
  | "project_state"
  | "repo_citation"
  | "inference";

export type ProjectMemoryEvidenceRef = {
  kind: ProjectMemoryEvidenceKind;
  ref: string;
  note?: string;
};

export type ProjectMemoryRepoCitation = {
  path: string;
  line_start?: number;
  line_end?: number;
  reason: string;
};

export type ProjectMemoryPathKind =
  | "existing_wiki_page"
  | "new_wiki_page"
  | "project_state"
  | "run_artifact";

export type ProjectMemoryPathRef = {
  path: string;
  path_kind: ProjectMemoryPathKind;
};

export type ProjectMemoryRisk = {
  level: "low" | "medium" | "high";
  reasons: string[];
  requires_quarantine: boolean;
};

export type ProjectMemoryValidationFinding = {
  severity: "info" | "warn" | "blocker";
  code: string;
  item_id?: string;
  message: string;
  evidence_refs?: ProjectMemoryEvidenceRef[];
};

export type ProjectMemoryCuratorEnvelope = {
  schema_version: 1;
  project_key: string;
  mode: ProjectMemoryCuratorMode;
  packet_ref: {
    run_dir: string;
    artifact: "input-packet.json";
    packet_schema_version: ProjectMemoryPacket["schema_version"];
  };
  summary: string;
};

export type ProjectMemoryCreationDraft = ProjectMemoryCuratorEnvelope & {
  mode: "create";
  brain_intent: {
    name: string;
    first_brain_summary: string;
    untrusted_existing_markdown_policy: "adopt" | "rewrite" | "ignore" | "quarantine_mixed";
  };
  pages: ProjectMemoryCreationPageDraft[];
  state_intent: {
    mark_project_memory_curated: boolean;
    freshness_intent: "initialize" | "leave_degraded";
  };
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  risk: ProjectMemoryRisk;
};

export type ProjectMemoryCreationPageDraft = {
  id: string;
  target: ProjectMemoryPathRef;
  title: string;
  purpose: string;
  content_intent: string;
  required_sections: string[];
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  notes_for_apply: string[];
};

export type ProjectMemoryMaintenanceOperation =
  (typeof PROJECT_MEMORY_MAINTENANCE_OPERATIONS)[number];

export type ProjectMemoryMaintenanceProposal = ProjectMemoryCuratorEnvelope & {
  mode: "maintain";
  items: ProjectMemoryMaintenanceProposalItem[];
  noop_inputs: ProjectMemoryNoopInput[];
  risk: ProjectMemoryRisk;
};

export type ProjectMemoryMaintenanceProposalItem = {
  id: string;
  operation: ProjectMemoryMaintenanceOperation;
  target_page: ProjectMemoryPathRef;
  target_entry_id?: string;
  proposed_entry_id?: string;
  content_intent: string;
  source_packet_refs: ProjectMemoryEvidenceRef[];
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: {
    label: string;
    why_direct_repo_evidence_is_unavailable: string;
  };
  applicability: {
    branches?: string[];
    repo_paths?: string[];
    commands?: string[];
    notes?: string;
  };
  lifecycle_intent: "active" | "stale_pending" | "disputed" | "superseded" | "retracted";
  risk: ProjectMemoryRisk;
  preconditions: string[];
  expected_outcome: string;
};

export type ProjectMemoryNoopInput = {
  source_packet_ref: ProjectMemoryEvidenceRef;
  reason: "already_trusted" | "not_durable" | "belongs_to_other_layer" | "insufficient_evidence";
  notes: string;
};

export type ProjectMemoryCuratorOutput =
  | ProjectMemoryCreationDraft
  | ProjectMemoryMaintenanceProposal;

export type ProjectMemoryValidationOutcome =
  (typeof PROJECT_MEMORY_VALIDATION_OUTCOMES)[number];

export type ProjectMemoryItemValidation = {
  item_id: string;
  outcome: ProjectMemoryValidationOutcome;
  findings: ProjectMemoryValidationFinding[];
};

export type ProjectMemoryCuratorValidationResult = {
  ok: boolean;
  mode: ProjectMemoryCuratorMode;
  project_key: string;
  global_findings: ProjectMemoryValidationFinding[];
  item_results: ProjectMemoryItemValidation[];
  eligible_item_ids: string[];
  rejected_item_ids: string[];
  quarantined_item_ids: string[];
  noop_refs: string[];
};

export type RunProjectMemoryCuratorInput = {
  projectKey: string;
  dryRun: boolean;
  review: boolean;
  provider?: "codex" | "claude";
  modelOverride?: string;
  env?: NodeJS.ProcessEnv;
  runner?: import("../runtime/llm-client.ts").ProcessRunner;
  now?: Date;
};

export type ProjectMemoryCuratorRunResult = {
  status: "completed" | "failed" | "needs_review";
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
  };
  validation_ok: boolean;
  stopped_before_writes: true;
  dry_run: boolean;
  review: boolean;
  stopped_reason?: string;
};
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: passes or fails only on pre-existing unrelated errors. If it fails on this file, fix export/import names before proceeding.

### Task 2: Add Contract Constant Tests

**Files:**
- Create: `tests/project/project-memory-curator-contracts.test.ts`

- [ ] **Step 1: Add runtime constant tests**

```ts
import { expect, test } from "bun:test";
import {
  PROJECT_MEMORY_MAINTENANCE_OPERATIONS,
  PROJECT_MEMORY_VALIDATION_OUTCOMES,
} from "../../src/project/project-memory-curator-contracts.ts";

test("curator maintenance operations expose the pre-write operation set", () => {
  expect(PROJECT_MEMORY_MAINTENANCE_OPERATIONS).toEqual([
    "CREATE_ENTRY",
    "PATCH_ENTRY",
    "ATTACH_EVIDENCE",
    "MARK_STALE",
    "MARK_DISPUTED",
    "SUPERSEDE_ENTRY",
    "RETRACT_ENTRY",
    "NOOP",
  ]);
});

test("curator validation outcomes expose the per-item outcome set", () => {
  expect(PROJECT_MEMORY_VALIDATION_OUTCOMES).toEqual([
    "eligible",
    "rejected",
    "quarantined",
    "noop",
  ]);
});
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/project/project-memory-curator-contracts.test.ts`
Expected: passes.

## Verification

- `bun test tests/project/project-memory-curator-contracts.test.ts`
  - Expected: both contract constant tests pass.
- `bun run typecheck`
  - Expected: no new type errors from `project-memory-curator-contracts.ts`.

## Acceptance Criteria Covered

- Defines separate Project Memory Curator output contracts for creation and maintenance.
- Establishes the shared primitives used by validator and service chunks.
- Preserves the pseudocode-defined split between creation draft and maintenance proposal.

## Risks And Rollback

- Risk: exporting runtime constants from a type-heavy module can invite logic into the contract file. Keep only stable arrays needed by validators/tests here.
- Rollback: delete `src/project/project-memory-curator-contracts.ts` and `tests/project/project-memory-curator-contracts.test.ts`; no command behavior depends on this chunk alone.

## Non-Goals

- No proposal validation.
- No provider invocation.
- No command wiring.
- No markdown mutation.
- No `runner.ts` deprecation or deletion.

## Type And Name Consistency

Before marking this chunk done, verify these exports exist exactly: `ProjectMemoryCreationDraft`, `ProjectMemoryMaintenanceProposal`, `ProjectMemoryCuratorValidationResult`, `RunProjectMemoryCuratorInput`, and `ProjectMemoryCuratorRunResult`.
