# Chunk 08: All-Or-Nothing Promotion State

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `03-rendered-quality-evaluator.md`, `05-create-mode-schema-validator.md`, `07-independent-usefulness-critique.md`
**Enables:** `09-clean-rebootstrap-reset.md`, `10-dogfood-regression-slice.md`

## Goal

Enforce all-or-nothing first-create promotion. Canonical wiki writes and `status: curated` project state happen only when deterministic validation is trusted and the independent critique passes. Failed, shallow, blocked, or review-only first-create runs write compact project state with artifact refs.

## Source Artifacts

- `../spec.md`: All-Or-Nothing First Create, Failed-Run Resume State, State And Apply Behavior.
- `../agenda.md`: Questions 4 and 5.
- `src/project/project-memory-markdown-applier.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-curator-contracts.ts`
- `tests/project/project-memory-markdown-applier.test.ts`
- `tests/project/project-memory-curator-service.test.ts`

## Relationships

- **Depends on:** Deterministic quality and critique gate.
- **Enables:** Clean reset can reason from terminal state; dogfood tests can assert failed runs are not canonical.
- **Shared contracts:** compact `project-memory.json` statuses `uncurated | shallow | blocked | review_only | curated`.
- **Integration points:** `applyCreationDraft`, `writeTerminalArtifacts`, `canApply`, project packet mode detection.

## File Responsibility Map

**Modify:**
- `src/project/project-memory-curator-contracts.ts` - add create terminal state types if central contract module is preferred.
- `src/project/project-memory-curator-service.ts` - write compact failed-run state on terminal create outcomes before canonical apply.
- `src/project/project-memory-markdown-applier.ts` - preserve all-or-nothing apply behavior for curated create.

**Test:**
- `tests/project/project-memory-curator-service.test.ts` - failed/review-only create writes compact state and no wiki files.
- `tests/project/project-memory-markdown-applier.test.ts` - curated create still writes wiki plus curated state.

## Implementation Tasks

### Task 1: Define Compact Create State

**Files:**
- Modify: `src/project/project-memory-curator-contracts.ts`

- [ ] **Step 1: Add terminal state type**

```ts
export type ProjectMemoryTrustStatus = "uncurated" | "shallow" | "blocked" | "review_only" | "curated";

export type ProjectMemoryCreateTerminalState = {
  schema_version: 1;
  status: ProjectMemoryTrustStatus;
  quality_contract_version: "answer-domain-v1";
  latest_create_run_ref: string;
  evidence_map_ref?: "project-memory-evidence-map.json";
  validation_diagnostics_ref?: "curator-validation.json";
  usefulness_critique_ref?: "project-memory-usefulness-critique.json";
  terminal_reason: string;
  updated_at: string;
};
```

### Task 2: Write Failed-Run Resume State

**Files:**
- Modify: `src/project/project-memory-curator-service.ts`
- Test: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Add helper to derive status**

```ts
function trustStatusForCreateFailure(input: {
  validation: ProjectMemoryCuratorValidationResult;
  stoppedReason?: string;
}): ProjectMemoryTrustStatus {
  const status = input.validation.quality_diagnostics?.content_quality.status;
  if (status === "blocked") return "blocked";
  if (status === "review_only") return "review_only";
  if (status === "shallow") return "shallow";
  return input.stoppedReason ? "blocked" : "uncurated";
}
```

- [ ] **Step 2: Write compact state for terminal create failures**

Add a private helper:

```ts
private async writeCreateTerminalState(input: {
  projectKey: string;
  run: ProjectCuratorRunPaths;
  status: ProjectMemoryTrustStatus;
  stoppedReason?: string;
  evidenceMap?: boolean;
  usefulnessCritique?: boolean;
  now: Date;
}): Promise<void> {
  const state: ProjectMemoryCreateTerminalState = {
    schema_version: 1,
    status: input.status,
    quality_contract_version: "answer-domain-v1",
    latest_create_run_ref: input.run.relative_run_dir,
    evidence_map_ref: input.evidenceMap ? "project-memory-evidence-map.json" : undefined,
    validation_diagnostics_ref: "curator-validation.json",
    usefulness_critique_ref: input.usefulnessCritique ? "project-memory-usefulness-critique.json" : undefined,
    terminal_reason: input.stoppedReason ?? input.status,
    updated_at: input.now.toISOString(),
  };
  await writeJsonFile(projectPath(this.root, input.projectKey, "state", "project-memory.json"), state);
}
```

Use the repo's existing JSON writer if `writeJsonFile` has a different import/name.

- [ ] **Step 3: Call helper only for create non-applied terminals**

In `writeTerminalArtifacts` or the create failure call sites, write compact state when:

```ts
input.mode === "create" && !input.apply && !input.input.dryRun
```

Do not write failed-run state for `--dry-run`.

### Task 3: Preserve Curated Apply As All-Or-Nothing

**Files:**
- Modify: `src/project/project-memory-markdown-applier.ts`
- Test: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Assert applier still skips non-trusted create**

Keep this invariant:

```ts
if (!isTrustedProjectMemoryQuality(input.draft.quality_diagnostics)) {
  return skippedResult("Project Memory content quality is not trusted");
}
```

Add a test that a shallow draft returns skipped and does not write wiki pages.

- [ ] **Step 2: Ensure curated state is written only after successful wiki staging**

The successful create apply should still stage wiki pages and `project-memory.json` together through the apply journal. If code currently stages state before page writes, adjust ordering so expected writes include all pages and state before promotion.

## Verification

- Run: `bun test tests/project/project-memory-curator-service.test.ts`
  - Expected: exits 0; failed create writes compact `project-memory.json` with artifact refs and no canonical wiki promotion.
- Run: `bun test tests/project/project-memory-markdown-applier.test.ts`
  - Expected: exits 0; shallow create does not write wiki; trusted create writes wiki and curated state.
- Run: `bun run typecheck`
  - Expected: exits 0.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- All-or-nothing first-create promotion.
- Compact failed-run resume state.
- `completed_with_pending_index` cannot launder shallow content into curated state.

## Risks And Rollback

- Risk: writing compact failed state could affect packet mode detection. Ensure `projectLearnModeForState` treats only `status: curated` as maintain mode.
- Rollback: remove compact failed-state writing; keep applier all-or-nothing invariant.

## Non-Goals

- No clean project-shell deletion.
- No dogfood command execution.
- No MCP wrapper.

## Type And Name Consistency

Before finishing, verify `ProjectMemoryTrustStatus`, `quality_contract_version`, `latest_create_run_ref`, and artifact ref field names match tests and state readers.
