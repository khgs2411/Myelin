# Chunk 06: Curator Writer Flow

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `04-evidence-map-builder.md`, `05-create-mode-schema-validator.md`
**Enables:** `07-independent-usefulness-critique.md`, `10-dogfood-regression-slice.md`

## Goal

Update `project learn` create mode so the curator writer consumes the deterministic evidence map and cannot replace missing evidence with generic prose. After this chunk, the prompt and run artifacts make the two-pass create workflow visible and enforceable.

## Source Artifacts

- `../spec.md`: Two-Pass Evidence Workflow, Create-Mode Coverage Requirements.
- `../agenda.md`: Questions 2 and 3.
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-prompt-budget.ts`
- `src/project/project-memory-evidence-map.ts`
- `src/runtime/project-run-infrastructure.ts`
- `tests/project/project-memory-prompt-budget.test.ts`
- `tests/project/project-memory-curator-service.test.ts`

## Relationships

- **Depends on:** Evidence map artifact and schema/validator contract.
- **Enables:** Independent critique receives rendered docs plus evidence map; dogfood regression can verify create-mode run artifacts.
- **Shared contracts:** create prompt must reference `project-memory-evidence-map.json`; missing evidence remains diagnostics, not prose.
- **Integration points:** `buildPromptBudgetedProjectMemoryPacket`, `invokeProjectCurator`, run artifact writing.

## File Responsibility Map

**Modify:**
- `src/project/project-memory-prompt-budget.ts` - include evidence-map artifact instructions for create mode.
- `src/project/project-memory-curator-service.ts` - ensure evidence map is built before prompt construction or passed into prompt builder.

**Test:**
- `tests/project/project-memory-prompt-budget.test.ts` - prompt references evidence-map artifact and prohibits generic evidence gaps.
- `tests/project/project-memory-curator-service.test.ts` - service writes evidence map before invoking curator.

## Implementation Tasks

### Task 1: Pass Evidence Map Into Prompt Builder

**Files:**
- Modify: `src/project/project-memory-prompt-budget.ts`
- Modify: `src/project/project-memory-curator-service.ts`
- Test: `tests/project/project-memory-prompt-budget.test.ts`

- [ ] **Step 1: Extend prompt builder input**

Add an optional evidence-map artifact ref:

```ts
export type BuildPromptBudgetedProjectMemoryPacketInput = {
  root: string;
  projectKey: string;
  runDir: string;
  absoluteRunDir: string;
  repoPath: string;
  transport: "artifact_reference";
  evidenceMapArtifact?: "project-memory-evidence-map.json";
};
```

If the file uses an inline input type instead of an exported type, update the local function signature directly.

- [ ] **Step 2: Build evidence map before prompt budget**

Move or keep evidence-map construction before `buildPromptBudgetedProjectMemoryPacket`. Then pass:

```ts
evidenceMapArtifact: packet.mode === "create" ? PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT : undefined,
```

If the current packet is only available after prompt budgeting, split packet construction so create mode can build the packet, evidence map, then prompt. The sequence must be:

1. build packet;
2. write `input-packet.json`;
3. build/write `project-memory-evidence-map.json` for create mode;
4. build prompt that references both artifacts.

### Task 2: Tighten Create Prompt Instructions

**Files:**
- Modify: `src/project/project-memory-prompt-budget.ts`
- Test: `tests/project/project-memory-prompt-budget.test.ts`

- [ ] **Step 1: Add evidence-map rules to create prompt**

Add these create-mode instructions near the existing create-mode output requirements:

```ts
"Create mode is two-pass: use input-packet.json for bounded context and project-memory-evidence-map.json as the required evidence map.",
"Every page answer_domain, required_topic, representative_question, and section must be supported by evidence_refs or repo_citations from the evidence map.",
"If an answer domain has missing_evidence in project-memory-evidence-map.json, report it in quality_diagnostics.missing_coverage or shallow_summary_findings; do not fill the gap with generic prose.",
"Candidates, handoffs, and Session Memory are leads only. Convert them into Project Memory only when the evidence map points to repo-grounded support.",
```

- [ ] **Step 2: Add prompt tests**

Assert the create prompt includes:

```ts
expect(prompt).toContain("project-memory-evidence-map.json");
expect(prompt).toContain("do not fill the gap with generic prose");
expect(prompt).toContain("leads only");
```

Assert maintain-mode prompt does not require `project-memory-evidence-map.json`.

### Task 3: Make Run Artifacts Tell The Two-Pass Story

**Files:**
- Modify: `src/project/project-memory-curator-service.ts`
- Test: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Include evidence-map artifact in all create terminal results**

When create mode writes terminal artifacts after packet construction, set the `evidenceMap` flag for success and failure paths that already wrote the artifact:

```ts
return await this.writeTerminalArtifacts({
  input,
  run,
  mode: packet.mode,
  outputArtifact,
  validation,
  status: applyDecision.status,
  stoppedReason: applyDecision.reason,
  promptBudget: true,
  runtimeInboxIntake: true,
  curatorOutputContract: true,
  evidenceMap: packet.mode === "create",
});
```

Do not claim an evidence map artifact in early failures before packet construction.

## Verification

- Run: `bun test tests/project/project-memory-prompt-budget.test.ts`
  - Expected: exits 0; create prompt references evidence map and missing-evidence rules.
- Run: `bun test tests/project/project-memory-curator-service.test.ts`
  - Expected: exits 0; create run artifacts include evidence map before curator output.
- Run: `bun run typecheck`
  - Expected: exits 0.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Evidence map precedes curator writing.
- Writer cannot paper over missing evidence.
- Candidates/session leads are explicitly non-canonical until repo-grounded.

## Risks And Rollback

- Risk: existing prompt-budget helper may currently own packet construction. If so, keep the smallest split that preserves current budget behavior while allowing evidence-map insertion.
- Rollback: remove evidence-map prompt inputs and service flags. Do not remove the evidence-map builder from chunk 04.

## Non-Goals

- No independent critique.
- No apply promotion changes.
- No clean reset command.

## Type And Name Consistency

Before finishing, verify `PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT`, `evidenceMapArtifact`, and `artifacts.evidence_map` names match across service, prompt builder, and tests.
