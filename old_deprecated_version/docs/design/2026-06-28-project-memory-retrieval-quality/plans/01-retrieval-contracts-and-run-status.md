# Chunk 01: Retrieval Contracts And Run Status

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Completed  
**Depends on:** None  
**Enables:** `02-markdown-section-manifest.md`, `03-retrieval-storage-and-vector-state.md`, `06-lookup-and-packet-quality.md`, `07-curator-evidence-and-scoped-gating.md`, `09-project-learn-lifecycle-and-dogfood.md`

## Goal

Add the shared Project Memory retrieval vocabulary and lifecycle result vocabulary that later chunks consume. This chunk introduces typed lookup quality, canonical section refs, evidence dependencies, explicit no-op decisions, lookup quality summaries, and `completed_with_pending_index` without changing storage, lookup execution, or apply behavior.

## Source Artifacts

- `../spec.md`: Lookup Quality And Apply Gating, Packet And Evidence Contract, Planning Boundary Guidance
- `../agenda.md`: documented decisions for fallback review gating, explicit no-op scope, and terminal status policy
- `../pseudocode/ProjectMemoryRetrievalContracts.ts`
- `../pseudocode/ProjectMemoryCuratorEvidenceContract.md`
- `../pseudocode/ProjectLearnRetrievalLifecycle.md`
- `../../../../CONTEXT.md`: Project Memory Retrieval Index, Explicit No-Op Decision, Evidence Dependency
- `../../../../docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`
- `../../../../docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`
- `../../../../src/project/project-memory-curator-contracts.ts`
- `../../../../tests/project/project-memory-curator-contracts.test.ts`
- `../../../../tests/project/project-memory-curator-validator.test.ts`
- `../../../../tests/project/project-memory-curator-service.test.ts`
- `../../../../tests/commands/project.test.ts`

## Relationships

- **Depends on:** no prior chunk.
- **Enables:** all chunks that need canonical section refs, lookup quality values, evidence dependency values, or run status vocabulary.
- **Shared contracts:** `ProjectMemoryRetrievalMethod`, `ProjectMemoryLookupQuality`, `ProjectMemoryLookupFreshness`, `ProjectMemoryApplySeverity`, `ProjectMemoryCanonicalSectionRef`, `ProjectMemoryLookupResult`, `ProjectMemoryLookupQualitySummary`, `ProjectMemoryEvidenceDependency`, `ExplicitNoOpDecision`, `completed_with_pending_index`.
- **Integration points:** curator output contracts, validator findings, service result type, command output tests.

## File Responsibility Map

**Create:**

- `src/project/project-memory-retrieval-contracts.ts` - owns Project Memory retrieval vocabulary shared across lookup, packet, storage, indexer, validator, and queue chunks.

**Modify:**

- `src/project/project-memory-curator-contracts.ts` - imports/re-exports evidence dependency and no-op types, adds `completed_with_pending_index` to run status, and extends proposal shapes without changing validation behavior yet.
- `src/project/project-memory-curator-service.ts` - accepts the new status in type-safe result construction only; no behavior should return it in this chunk.
- `src/commands/project.ts` if project command output has status narrowing that needs the new status accepted.

**Test:**

- `tests/project/project-memory-curator-contracts.test.ts` - verifies exported status and retrieval/evidence vocabularies.
- `tests/project/project-memory-curator-service.test.ts` - only update compile-facing fixtures if status typing requires it.
- `tests/commands/project.test.ts` - only update compile-facing expectations if status formatting has an exhaustive list.

## Implementation Tasks

### Task 1: Add retrieval contract exports

**Files:**

- Create: `src/project/project-memory-retrieval-contracts.ts`
- Test: `tests/project/project-memory-curator-contracts.test.ts`

- [ ] **Step 1: Add contract tests first**

Add tests that assert the values intended for downstream chunks are exported.

```ts
import {
  PROJECT_MEMORY_APPLY_SEVERITIES,
  PROJECT_MEMORY_LOOKUP_FRESHNESS_VALUES,
  PROJECT_MEMORY_LOOKUP_QUALITIES,
  PROJECT_MEMORY_RETRIEVAL_METHODS,
} from "../../src/project/project-memory-retrieval-contracts.ts";

test("Project Memory retrieval contracts expose lookup quality vocabulary", () => {
  expect(PROJECT_MEMORY_RETRIEVAL_METHODS).toEqual([
    "indexed_section_retrieval",
    "fallback_markdown_search",
    "unavailable",
  ]);
  expect(PROJECT_MEMORY_LOOKUP_QUALITIES).toEqual(["indexed", "fallback", "unavailable"]);
  expect(PROJECT_MEMORY_LOOKUP_FRESHNESS_VALUES).toEqual([
    "fresh",
    "stale",
    "orphaned",
    "unknown",
    "not_applicable",
  ]);
  expect(PROJECT_MEMORY_APPLY_SEVERITIES).toEqual(["advisory", "proposal_scoped", "blocking"]);
});
```

- [ ] **Step 2: Run the focused contract test**

Run: `rtk bun test tests/project/project-memory-curator-contracts.test.ts`  
Expected: fails because `src/project/project-memory-retrieval-contracts.ts` does not exist yet.

- [ ] **Step 3: Create `project-memory-retrieval-contracts.ts`**

Use this contract surface as the first implementation target. Field names intentionally match the pseudocode and spec.

```ts
export const PROJECT_MEMORY_RETRIEVAL_METHODS = [
  "indexed_section_retrieval",
  "fallback_markdown_search",
  "unavailable",
] as const;

export const PROJECT_MEMORY_LOOKUP_QUALITIES = ["indexed", "fallback", "unavailable"] as const;

export const PROJECT_MEMORY_LOOKUP_FRESHNESS_VALUES = [
  "fresh",
  "stale",
  "orphaned",
  "unknown",
  "not_applicable",
] as const;

export const PROJECT_MEMORY_APPLY_SEVERITIES = ["advisory", "proposal_scoped", "blocking"] as const;

export type ProjectMemoryRetrievalMethod = (typeof PROJECT_MEMORY_RETRIEVAL_METHODS)[number];
export type ProjectMemoryLookupQuality = (typeof PROJECT_MEMORY_LOOKUP_QUALITIES)[number];
export type ProjectMemoryLookupFreshness = (typeof PROJECT_MEMORY_LOOKUP_FRESHNESS_VALUES)[number];
export type ProjectMemoryApplySeverity = (typeof PROJECT_MEMORY_APPLY_SEVERITIES)[number];

export type ProjectMemoryCanonicalSectionRef = {
  project_key: string;
  wiki_path: string;
  category: string | null;
  page_title: string;
  section_id: string;
  heading_path: string[];
  section_hash: string;
};

export type ProjectMemoryLookupResultId = string;

export type ProjectMemoryLookupHit = {
  id: string;
  canonical_ref: ProjectMemoryCanonicalSectionRef | null;
  score: number;
  distance?: number;
  snippet: string;
  matched_terms?: string[];
  source_components: {
    structural_text: boolean;
    retrieval_hints: boolean;
    fallback_text: boolean;
  };
  freshness: ProjectMemoryLookupFreshness;
  stale_reason?: string;
};

export type ProjectMemoryLookupSourceKind =
  | "project_handoff"
  | "project_candidate"
  | "session_memory"
  | "manual"
  | "retrieval_maintenance";

export type ProjectMemoryLookupResult = {
  id: ProjectMemoryLookupResultId;
  query: string;
  source_kind: ProjectMemoryLookupSourceKind;
  source_id: string;
  retrieval_method: ProjectMemoryRetrievalMethod;
  lookup_quality: ProjectMemoryLookupQuality;
  lookup_freshness: ProjectMemoryLookupFreshness;
  apply_severity: ProjectMemoryApplySeverity;
  degraded_reason?: string;
  hits: ProjectMemoryLookupHit[];
  source_tools: string[];
};

export type ProjectMemoryEvidenceDependencyKind =
  | "lookup_result"
  | "canonical_section"
  | "project_candidate"
  | "project_handoff"
  | "session_memory"
  | "repo_citation";

export type ProjectMemoryEvidenceDependency = {
  kind: ProjectMemoryEvidenceDependencyKind;
  ref: string;
  required_for:
    | "target_selection"
    | "dedupe"
    | "supersession"
    | "conflict_check"
    | "content_support"
    | "noop_support";
  minimum_quality?: ProjectMemoryLookupQuality;
  minimum_freshness?: ProjectMemoryLookupFreshness;
};

export type ExplicitNoOpDecision = {
  id: string;
  source_packet_refs: ProjectMemoryEvidenceDependency[];
  checked_existing_memory_refs: ProjectMemoryEvidenceDependency[];
  reason:
    | "already_trusted"
    | "not_durable"
    | "belongs_to_other_layer"
    | "insufficient_evidence"
    | "duplicate_or_superseded";
  explanation: string;
};

export type ProjectMemoryLookupQualitySummary = {
  blocking: boolean;
  blocking_reasons: string[];
  advisory_reasons: string[];
  proposal_scoped_result_ids: ProjectMemoryLookupResultId[];
};
```

- [ ] **Step 4: Re-run the focused contract test**

Run: `rtk bun test tests/project/project-memory-curator-contracts.test.ts`  
Expected: passes or fails only on existing unrelated assertions; new retrieval contract test passes.

### Task 2: Extend curator contract types without behavior changes

**Files:**

- Modify: `src/project/project-memory-curator-contracts.ts`
- Test: `tests/project/project-memory-curator-contracts.test.ts`

- [ ] **Step 1: Add status and shape tests**

Add tests near the existing contract vocabulary tests.

```ts
import {
  PROJECT_MEMORY_CURATOR_RUN_STATUSES,
  PROJECT_MEMORY_VALIDATOR_ISSUE_CATEGORIES,
} from "../../src/project/project-memory-curator-contracts.ts";

test("curator run statuses expose pending retrieval indexing state", () => {
  expect(PROJECT_MEMORY_CURATOR_RUN_STATUSES).toEqual([
    "completed",
    "completed_with_pending_index",
    "failed",
    "needs_review",
  ]);
});

test("validator issue categories include lookup dependency and explicit no-op findings", () => {
  expect(PROJECT_MEMORY_VALIDATOR_ISSUE_CATEGORIES).toEqual(
    expect.arrayContaining(["lookup_dependency", "explicit_noop"]),
  );
});
```

- [ ] **Step 2: Update curator contract exports**

Add imports and constants, preserving existing names.

```ts
import type {
  ExplicitNoOpDecision,
  ProjectMemoryEvidenceDependency,
} from "./project-memory-retrieval-contracts.ts";

export const PROJECT_MEMORY_CURATOR_RUN_STATUSES = [
  "completed",
  "completed_with_pending_index",
  "failed",
  "needs_review",
] as const;
```

Extend `PROJECT_MEMORY_VALIDATOR_ISSUE_CATEGORIES`:

```ts
export const PROJECT_MEMORY_VALIDATOR_ISSUE_CATEGORIES = [
  "schema",
  "mode",
  "project_key",
  "packet_ref",
  "operation",
  "path",
  "provenance",
  "repo_citation",
  "lifecycle",
  "risk",
  "budget",
  "degraded_context",
  "lookup_dependency",
  "explicit_noop",
  "protected_state",
] as const;
```

Extend the common curator envelope so explicit no-op decisions are available
to both creation and maintenance outputs, then extend maintenance item shapes:

```ts
export type ProjectMemoryCuratorEnvelope = {
  schema_version: 1;
  project_key: string;
  mode: ProjectMemoryCuratorMode;
  packet_ref: {
    run_dir: string;
    artifact: "input-packet.json";
    packet_schema_version: ProjectMemoryPacket["schema_version"];
  };
  packet_context: ProjectMemoryCuratorPacketContext;
  summary: string;
  explicit_noop_decisions?: ExplicitNoOpDecision[];
};

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
  apply_payload?: ProjectMemoryApplyPayload;
  source_packet_refs: ProjectMemoryEvidenceRef[];
  evidence_refs: ProjectMemoryEvidenceRef[];
  evidence_dependencies?: ProjectMemoryEvidenceDependency[];
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
  lifecycle_intent: ProjectMemoryLifecycleIntent;
  risk: ProjectMemoryRisk;
  preconditions: string[];
  expected_outcome: string;
};
```

Replace the status type:

```ts
export type ProjectMemoryCuratorRunStatus = (typeof PROJECT_MEMORY_CURATOR_RUN_STATUSES)[number];
```

- [ ] **Step 3: Keep existing behavior unchanged**

Do not update `canApply`, packet lookup, indexing, or validator semantics in this chunk. Type-level acceptance of new fields is enough.

- [ ] **Step 4: Run contract and typecheck**

Run: `rtk bun test tests/project/project-memory-curator-contracts.test.ts`  
Expected: passes.

Run: `rtk bun run typecheck`  
Expected: passes. If consumers have exhaustive status handling, update only those consumers to accept and display the new status without making any path return it.

## Verification

- `rtk bun test tests/project/project-memory-curator-contracts.test.ts`  
  Expected: all contract tests pass, including retrieval vocabulary and run status tests.
- `rtk bun test tests/project/project-memory-curator-service.test.ts tests/commands/project.test.ts`  
  Expected: existing service/command tests pass; no runtime behavior has changed.
- `rtk bun run typecheck`  
  Expected: TypeScript accepts the new types and status value.

## Acceptance Criteria Covered

- Shared lookup quality and freshness vocabulary exists.
- Evidence dependency and explicit no-op types exist.
- `completed_with_pending_index` is a first-class result status type.
- No storage, lookup, validator, or apply behavior changes in this chunk.

## Risks And Rollback

- Risk: widening status type can break exhaustive status formatting. Mitigation: update only display branches and keep runtime behavior unchanged.
- Risk: importing retrieval contracts into curator contracts creates a cycle later. Mitigation: `project-memory-retrieval-contracts.ts` must not import curator modules.
- Rollback: remove the new contract file and revert `project-memory-curator-contracts.ts` to the prior status/type shapes. No migrations or data changes are introduced.

## Non-Goals

- No markdown section extraction.
- No SQLite migration.
- No vector indexing.
- No packet lookup behavior change.
- No validator gating change.
- No hint generation.

## Type And Name Consistency

Before closing this chunk, verify these names are exact across exports and tests:

- `ProjectMemoryRetrievalMethod`
- `ProjectMemoryLookupQuality`
- `ProjectMemoryLookupFreshness`
- `ProjectMemoryApplySeverity`
- `ProjectMemoryCanonicalSectionRef`
- `ProjectMemoryLookupResult`
- `ProjectMemoryLookupQualitySummary`
- `ProjectMemoryEvidenceDependency`
- `ExplicitNoOpDecision`
- `completed_with_pending_index`
