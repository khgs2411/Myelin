# Chunk 04: Producer Boundary And Packet Prioritization

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-quality-contract-and-diagnostics.md`
**Enables:** `05-maintain-mode-section-first-apply.md`, `07-dogfood-reset-and-validation.md`

## Goal

Make every Project Memory producer feed the same downstream candidate/handoff boundary and make maintenance treat Memory Candidates as strong prioritization signals without giving them direct write authority. This chunk strengthens intake and packet shape; it does not implement future gap/stale producers beyond preserving their normalized insertion path.

## Source Artifacts

- `../spec.md`: `User-Stated Direction`, `Proposed Direction`, and producer routing guidance.
- `../agenda.md`: Question 2 and Question 2A.
- `../pseudocode/ProducerCandidateBoundary.md`.
- `../plans/01-quality-contract-and-diagnostics.md`.
- `../../../../CONTEXT.md`: Memory Candidate and Layer Handoff relationships.
- ADRs: `docs/adr/0006-use-flexible-candidate-payloads-in-first-slice.md`, `docs/adr/0061-use-layer-shaped-runtime-inbox-with-implemented-consumers.md`.
- Current code: `src/project/project-memory-candidate-intake-service.ts`, `src/project/project-memory-packet.ts`, `src/project/project-memory-source-consumption-reconciler.ts`, `src/memory/candidates.ts`, `src/memory/handoffs.ts`, `src/ingest/worker.ts`.
- Tests: `tests/project/project-memory-candidate-intake-service.test.ts`, `tests/project/project-memory-packet.test.ts`, `tests/project/project-memory-source-consumption-reconciler.test.ts`, `tests/memory/memory-candidate-service.test.ts`, `tests/memory/handoffs.test.ts`.

## Relationships

- **Depends on:** Chunk 01 candidate disposition vocabulary.
- **Enables:** Chunk 05 can consume prioritized candidate/handoff refs and write terminal source-consumption decisions.
- **Shared contracts:** `MemoryCandidate`, `LayerHandoffInstruction`, packet `pending.project_candidates`, packet `pending.project_handoffs`, candidate disposition names.
- **Integration points:** Runtime inbox intake, Session Memory ingest output, packet construction, source-consumption reconciliation.

## Resolved Decisions For Execution

- `priority` is a curator attention hint only. It may affect packet ordering and prompt wording, but it must never bypass repo evidence, target selection, quality diagnostics, validation, or apply eligibility.
- `producer_kind` is diagnostic-only. It is emitted so operators can understand the source lane, not so `project learn` can branch into producer-specific curation behavior.
- Runtime inbox, Session Memory, and future gap/stale producers must converge into `MemoryCandidate` or `LayerHandoffInstruction` before packet construction.

## File Responsibility Map

**Create:**
- `src/project/project-memory-producer-boundary.ts` - normalized producer priority and packet lead helpers.
- `tests/project/project-memory-producer-boundary.test.ts` - priority and normalization behavior.

**Modify:**
- `src/project/project-memory-packet.ts` - adds `priority` and `producer_kind` to packet candidates/handoffs.
- `src/project/project-memory-candidate-intake-service.ts` - ensures runtime inbox items produce normalized project candidates only.
- `src/project/project-memory-source-consumption-reconciler.ts` - recognizes supported no-op dispositions from chunk 01.
- `src/ingest/worker.ts` - confirms Session Memory output keeps using Memory Candidate and Layer Handoff shapes.

**Test:**
- `tests/project/project-memory-packet.test.ts` - candidates and handoffs include priority and producer kind.
- `tests/project/project-memory-candidate-intake-service.test.ts` - runtime inbox intake does not create a separate downstream lane.
- `tests/project/project-memory-source-consumption-reconciler.test.ts` - explicit supported no-op can retire a source.

## Implementation Tasks

### Task 1: Add producer boundary helper

**Files:**
- Create: `src/project/project-memory-producer-boundary.ts`
- Test: `tests/project/project-memory-producer-boundary.test.ts`

- [ ] **Step 1: Add tests for candidate priority**

```ts
import { describe, expect, test } from "bun:test";
import { priorityForProjectMemoryLead } from "../../src/project/project-memory-producer-boundary.ts";

describe("Project Memory producer boundary", () => {
  test("weights project candidates above session context during maintenance", () => {
    expect(priorityForProjectMemoryLead({ source_kind: "project_candidate", confidence: "high", risk: "low" })).toBe("high");
    expect(priorityForProjectMemoryLead({ source_kind: "session_memory", confidence: "high", risk: "low" })).toBe("normal");
  });
});
```

- [ ] **Step 2: Implement priority helper**

```ts
export type ProjectMemoryLeadSourceKind = "project_candidate" | "project_handoff" | "session_memory";
export type ProjectMemoryLeadPriority = "high" | "normal" | "low";

export function priorityForProjectMemoryLead(input: {
  source_kind: ProjectMemoryLeadSourceKind;
  confidence?: string;
  risk?: string;
}): ProjectMemoryLeadPriority {
  if (input.risk === "high") return "low";
  if (input.source_kind === "project_candidate" && input.confidence === "high") return "high";
  if (input.source_kind === "project_handoff" && input.confidence === "high") return "high";
  return "normal";
}

export function producerKindForSourceRef(ref: string): string {
  if (ref.startsWith("project_inbox:")) return "runtime_inbox";
  if (ref.startsWith("session_memory:")) return "session_memory";
  return "normalized";
}
```

### Task 2: Add packet lead metadata

**Files:**
- Modify: `src/project/project-memory-packet.ts`
- Test: `tests/project/project-memory-packet.test.ts`

- [ ] **Step 1: Extend packet types**

Add to `PacketCandidate` and `PacketHandoff`:

```ts
priority: "high" | "normal" | "low";
producer_kind: string;
```

- [ ] **Step 2: Populate metadata**

When mapping candidates and handoffs, use:

```ts
priority: priorityForProjectMemoryLead({ source_kind: "project_candidate", confidence: row.confidence, risk: row.risk }),
producer_kind: producerKindForSourceRef(row.source_ref ?? row.id),
```

For handoffs, use `source_kind: "project_handoff"`.

### Task 3: Preserve the single downstream boundary

**Files:**
- Modify: `src/project/project-memory-candidate-intake-service.ts`
- Modify: `src/ingest/worker.ts`
- Test: `tests/project/project-memory-candidate-intake-service.test.ts`

- [ ] **Step 1: Add regression assertions**

Assert runtime inbox project-layer items become `MemoryCandidate` rows with `scope: "project"` and do not create producer-specific packet arrays.

- [ ] **Step 2: Audit Session Memory output**

Keep `src/ingest/worker.ts` producing `MemoryCandidate` and `LayerHandoffInstruction` rows. If code names drift, update tests to assert these rows remain the only downstream shapes accepted by `project learn`.

### Task 4: Connect dispositions to source consumption

**Files:**
- Modify: `src/project/project-memory-source-consumption-reconciler.ts`
- Test: `tests/project/project-memory-source-consumption-reconciler.test.ts`

- [ ] **Step 1: Accept supported terminal no-op dispositions**

Use chunk 01 disposition names so these terminal decisions can retire a source:

```ts
const TERMINAL_PROJECT_MEMORY_DISPOSITIONS = new Set([
  "applied_to_project_memory",
  "already_trusted",
  "not_durable",
  "belongs_to_other_layer",
  "insufficient_evidence",
]);
```

Do not retire `missing_coverage_no_grounded_write` or `blocked_by_quality` unless a later chunk records an explicit review decision.

## Verification

- Run: `bun test tests/project/project-memory-producer-boundary.test.ts`
  Expected: candidate priority helper passes.
- Run: `bun test tests/project/project-memory-packet.test.ts`
  Expected: packet includes producer kind and priority without producer-specific lanes.
- Run: `bun test tests/project/project-memory-candidate-intake-service.test.ts`
  Expected: runtime inbox intake creates normalized project candidates.
- Run: `bun test tests/project/project-memory-source-consumption-reconciler.test.ts`
  Expected: supported terminal no-op dispositions retire sources; missing coverage remains pending/review.
- Run: `bun run typecheck`
  Expected: no TypeScript errors.
- Run: `git diff --check`
  Expected: no whitespace errors.

## Acceptance Criteria Covered

- Producers normalize into Memory Candidate or Layer Handoff Instruction before `project learn`.
- Candidate text remains a lead, not Project Memory truth.
- Maintenance can weigh candidates more heavily for prioritization.
- Producer-specific lanes do not survive into packet construction.

## Risks And Rollback

- Risk: priority metadata is mistaken for authority. Mitigation: field name and prompt text must call it prioritization only.
- Risk: source consumption retires unresolved sources too early. Mitigation: only supported applied/no-op dispositions are terminal.
- Rollback: remove packet `priority` and `producer_kind`; normalized candidate/handoff storage remains unchanged.

## Non-Goals

- Does not implement future gap/stale producers.
- Does not choose final Project Memory page or section placement.
- Does not change markdown apply behavior.

## Type And Name Consistency

Before finalizing implementation, verify that `priority`, `producer_kind`, and disposition strings match packet, validator, source-consumption, and tests exactly.
