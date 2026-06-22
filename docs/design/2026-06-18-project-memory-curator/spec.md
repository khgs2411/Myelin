# Project Memory Curator Pre-Write Gate Design

Status: Final design for review. Not approved for implementation planning yet.

## Goal

Define the first behavior-focused slice that evolves `project learn <key>` from a Phase-0 pipeline scaffold into real Project Memory maintenance.

This slice stops at the pre-write gate for maintenance mode, and defines the state-based authority profiles for `project learn`. It defines how `project learn` should use the bounded Project Memory packet, what structured output the Project Memory Curator must return in each mode, and how Myelin deterministically rejects invalid maintenance proposals before canonical markdown can change.

This design intentionally does not implement page patching, derived retrieval indexing, maintenance scheduling, Practice Memory, Personal Memory, or Current Briefing.

## Current Context

`docs/ROADMAP.md` defines the active Step 3 parent outcome as:

- Evolve `project learn` from a Phase-0 pipeline scaffold into behavior-focused Project Memory maintenance.

The active concrete work under that parent is:

- Define the Project Memory Curator output schemas and validation contract.
- Make `project learn` use the Project Memory packet as its curator input.
- Reject invalid Project Memory Curator proposals before wiki writes.

The current implementation has useful shell pieces:

- `src/commands/project.ts` exposes `project learn`, `project ingest`, and `project packet`.
- `src/project/project-memory-packet.ts` builds a bounded packet from project state, wiki markdown, pending project handoffs/candidates, selected Session Memory, and lookup results.
- `src/project/project-memory-lookup.ts` provides degraded markdown text lookup over Project Memory pages.
- `src/pipeline/runner.ts` runs Phase-0 stages and deterministic apply/validate placeholders.
- `stages/03-propose/instructions.md` still describes the older ranked-domain proposal model.

The current code does not yet answer "what durable project knowledge changed?" in a structured way. The apply stage writes run/freshness artifacts, but it does not validate Project Memory curator proposals or apply meaningful wiki updates.

The `llm-wiki` dogfood project shows an important trust condition: `projects/llm-wiki/state/bootstrap-state.json` marks the project as `uncurated` and `project-memory.json` is absent, while preexisting wiki markdown pages still exist. The design must treat page presence as source context, not proof that Project Memory is trusted and curated.

The user-stated product direction is that `project learn` should be an authoritative command whose permission profile depends on project state. The harness should do the work that code is better suited for, such as verifying bootstrap shape, schema context, project state, file existence, packet shape, and proposal validity. The agent should do the work that requires judgment, such as creating the first project brain or deciding which durable project knowledge changed.

The design posture for this slice is quality-first. Because Myelin is in early foundational development with no external deadline or waiting client, the design should prefer the strongest long-term product shape, clear boundaries, and durable code quality over minimizing implementation workload. This reflects the user's general preference: optimize for the best durable solution and strongest boundaries rather than the smallest implementation delta.

ADR 0058 records the hard-to-reverse boundary decision: `project learn` uses mode-scoped curator contracts, with a Project Memory Creation Draft for first-brain creation and a Project Memory Maintenance Proposal for ongoing constrained maintenance.

## Documented Decisions

- Project Memory canonical truth lives in markdown plus project state, not SQLite.
- SQLite/vector Project Memory rows are derived retrieval state only and must point back to markdown.
- Session Memory and Project Memory differ: Session Memory trusted records live in SQLite, while Project Memory answers must resolve back to markdown.
- The Project Memory Curator must return structured proposals, not write markdown directly.
- Myelin must validate proposals deterministically before canonical markdown can change.
- `project learn` should use the bounded Project Memory packet as the curator input.
- Current Briefing is not active scope until Project Memory curation and retrieval are stable.
- `project learn` may inspect the live repository directly, but durable writes require traceable evidence or explicit inference labels.
- Routine project learning should eventually auto-apply by default, but risky changes must not silently corrupt Project Memory.

## User-Facing Behavior

For this slice, `project learn <key>` should become visibly different from the Phase-0 scaffold even before maintenance-mode markdown application exists.

A run should:

1. Ensure schema context is valid or rebuilt using the existing learn behavior.
2. Build the Project Memory packet for the project.
3. Pass that packet, not unbounded SQLite state or raw conversation history, to the Project Memory Curator.
4. Require curator output to be strict JSON matching the active mode's Project Memory Curator output contract.
5. Validate the proposal deterministically.
6. Stop before wiki writes when validation fails.
7. Write run artifacts that explain the proposal, validation outcome, rejected items, and pre-write status.

If the proposal is valid, this slice may still stop before actual markdown mutation. The important product behavior is that Myelin can prove a curator proposal is valid enough to be eligible for a later bounded apply stage.

### Mode-Scoped Authority

`project learn` is authoritative, but not uniformly permissive. The command should derive its authority profile from project state.

Creation mode applies when the project has a valid bootstrap shell but no trusted curated Project Memory. This includes normal onboarding where `project onboard` runs `bootstrap` and then `project learn`.

The first implementation should use two deterministic modes:

- `create`: no trusted curated Project Memory exists.
- `maintain`: trusted curated Project Memory exists.

Do not introduce a separate migration mode. If preexisting wiki markdown exists without `project-memory.json`, the project is still in `create` mode. The packet should flag those pages as untrusted existing markdown context so the agent can adopt, rewrite, ignore, or quarantine them while creating the first trusted Project Memory brain.

In creation mode:

- the harness verifies the bootstrap shell, schema context, project state, repo path, and input packet;
- the agent can have broad creative authority to create the first working Project Memory brain;
- the run should use a strong model/reasoning profile by default or through configuration;
- the expected output is initial wiki/project documentation, not only small patch proposals;
- validation should focus on structural safety, provenance, forbidden paths, secret/sensitive content, and basic project-shape correctness.
- old markdown can inform the agent, but it is not automatically trusted as current Project Memory.
- the curator should emit a creation brain-draft contract, not the maintenance mutation-proposal contract.

Maintenance mode applies after trusted curated Project Memory exists.

In maintenance mode:

- the harness builds a bounded Project Memory packet from pending project handoffs/candidates, selected Session Memory, existing wiki context, lookup results, and project state;
- the agent proposes bounded durable-memory changes;
- code validates proposal shape, packet references, provenance, target paths, operation scope, and risk before any write;
- broad rewrite, destructive, unsupported, or ambiguous operations are rejected, quarantined, or routed to stronger assurance rather than silently applied.
- the curator should emit a maintenance mutation-proposal contract, not the creation brain-draft contract.

This distinction lets Myelin preserve self-maintenance without pretending that first-brain creation and routine maintenance need the same permissions.

## Technical Design

### Curator Input Boundary

The Project Memory packet is the authoritative input bundle for this slice.

The curator may receive:

- project identity and lifecycle
- project repo paths
- bootstrap/project-memory/freshness/pages state
- wiki page summaries and paths
- pending project handoffs
- pending project candidates
- selected Session Memory rows
- deterministic Project Memory lookup queries and results
- degraded reasons

The curator should not receive:

- all SQLite tables
- all raw Experience Log rows
- all Session Memory rows
- unrelated Practice or Personal candidates
- unbounded transcripts

The live repo remains inspectable under ADR 0018, but any durable proposed update based on repo inspection must cite concrete evidence or label itself as inference.

### Curator Output Contracts

Creation and maintenance should use related but separate top-level output contracts. They should share evidence, path, risk, and validation-finding primitives, but the top-level contracts should reflect the different authority profiles.

Creation mode should emit a Project Memory brain draft. It can describe an initial page set and first-brain structure with broad creative authority, while still using shared primitives for paths, evidence, source references, risk, and validation findings.

Maintenance mode should emit a mutation proposal. It should be itemized and bounded so the harness can validate each proposed change mechanically before any markdown write.

Each maintenance proposal item should be small enough for deterministic validation. A proposal item should identify:

- operation
- target page path
- target entry ID when updating an existing addressable entry
- proposed entry ID when creating a new addressable entry
- proposed content or content intent
- source packet references
- evidence references
- inference label when evidence is indirect
- applicability scope
- lifecycle intent
- risk classification
- preconditions
- expected outcome

Allowed maintenance operations for this pre-write slice should be narrower than the full future mutation list. The initial validator should focus on operations needed to classify eligibility before writes:

- `CREATE_ENTRY`
- `PATCH_ENTRY`
- `ATTACH_EVIDENCE`
- `MARK_STALE`
- `MARK_DISPUTED`
- `SUPERSEDE_ENTRY`
- `RETRACT_ENTRY`
- `NOOP`

Broader structural operations such as `SPLIT`, `MERGE`, full page creation, broad rewrite, and delete should be represented as review or quarantine candidates in this slice rather than eligible write operations.

Creation mode can allow broader first-brain output than maintenance mode, but the harness still owns structural checks and publication safety. The creation output schema should be a separate brain-draft contract, not a maintenance proposal with many optional fields.

### Validation Contract

Validation must be deterministic and run before any markdown write.

The harness validates structured proposal items, not arbitrary prose quality. The curator must return machine-readable fields that code can inspect: operation, target page, source packet references, evidence references, risk, inference label, lifecycle intent, and content intent.

Validation should produce per-item outcomes plus a proposal-level summary. A mixed proposal should not force the harness to choose between "apply all" and "reject all." Each item can be independently classified:

- `eligible`: the item is structurally valid, mode-allowed, target-safe, evidence-backed, and low enough risk to proceed to a later apply stage.
- `rejected`: the item is malformed, unsupported, out of scope, missing mandatory references, missing provenance, or otherwise mechanically invalid.
- `quarantined`: the item has valid shape but is too risky, broad, conflicting, degraded, or ambiguous for normal progression.
- `noop`: the curator checked the input and proposes no durable Project Memory change.

The proposal-level result should be eligible only when at least one item is eligible and no global hard error invalidates the whole proposal. Global hard errors include invalid JSON, schema version mismatch, project key mismatch, unreadable packet, or malformed top-level proposal shape.

Hard rejection conditions:

- invalid JSON or unknown schema version
- project key mismatch
- unknown operation
- target path outside the project wiki
- target page missing when the operation requires an existing page
- new page requested without an explicit new-page operation supported by this slice
- missing source packet references
- missing evidence references and no explicit inference label
- evidence reference has an invalid shape
- source packet reference does not resolve to a handoff, candidate, Session Memory, lookup result, state field, or wiki page in the packet
- proposed lifecycle transition is illegal
- operation is too broad for the pre-write gate
- proposal exceeds item or content-size budget
- protected state or metadata is self-assigned by the curator

### Provenance Floor And Citation Standard

Every proposal item needs at least one packet-resolvable evidence reference. This is the schema floor: code must be able to verify that the item points back to something included in the Project Memory packet, such as a handoff, candidate, Session Memory row, lookup result, state field, wiki page, preserved source, or repo evidence reference.

Repo/file citations are the practical standard whenever a claim can be grounded in repository files. The validator should not require repo citations for every proposal item because some durable Project Memory facts are decisions, current state, preserved-source facts, or synthesis rather than repo-line facts. But when the claim is about code behavior, commands, setup, tests, file layout, runtime behavior, or implementation boundaries, missing repo/file citations should prevent normal eligibility unless the item explicitly explains why repo evidence is unavailable and marks the claim as inference.

Inference labels are allowed, but they are not a loophole. An inference-backed item should identify the packet evidence used for the inference and should usually be quarantined or treated with higher risk when direct repo evidence ought to exist.

Review or quarantine conditions:

- destructive or broad rewrite intent
- low confidence synthesis
- conflicting evidence
- decision-record changes
- branch/applicability ambiguity
- stale lookup or degraded packet state that affects the claim
- old wiki pages exist but curated Project Memory state is absent

The validator should produce structured findings, not just a boolean. Each finding should include severity, code, item ID when applicable, message, and whether the proposal can proceed to the later apply stage.

### Run Artifacts

This slice should leave inspectable run artifacts:

- `input-packet.json`
- `curator-proposal.json`
- `curator-validation.json`
- `mutation-plan.json` or pre-write eligibility artifact
- `pipeline-result.json`
- `summary.md`

When validation fails, artifacts should say that the run stopped before wiki writes and list the rejected conditions. "Completed" should not mean "wiki updated" unless a later apply slice actually mutates markdown.

### Relationship To Existing Pipeline Stages

The existing runner is historical orchestration scaffolding. The `project learn` behavior should be renamed or reshaped around Project Memory Curator concepts when that produces clearer product and code boundaries.

- a curator input/packet stage should prepare the Project Memory packet and mode authority profile;
- a curator proposal stage should invoke the agent and require strict proposal JSON;
- a curator validation stage should validate proposal items before markdown mutation;
- any later apply stage should consume only validated curator output.

The older ranked-domain proposal schema is useful history, but it should not define the new Project Memory Curator contract. Ranked-domain coverage, shelf allowlists, and generic Phase-0 stage names belong to old scaffolding, not the target `project learn` model.

## Data / State

This slice should prefer typed TypeScript contracts over new durable storage.

Likely shared contract surfaces:

- `ProjectMemoryPacket`
- `ProjectMemoryEvidenceRef`
- `ProjectMemoryPathRef`
- `ProjectMemoryRisk`
- `ProjectMemoryCuratorValidationResult`
- `ProjectMemoryCuratorValidationFinding`

Likely mode-specific contract surfaces:

- `ProjectMemoryCreationDraft`
- `ProjectMemoryCreationPageDraft`
- `ProjectMemoryMaintenanceProposal`
- `ProjectMemoryMaintenanceProposalItem`

New durable state should be limited to run artifacts. Candidate/handoff lifecycle updates and markdown mutation belong to later slices unless needed to record a rejected pre-write run.

## Error Handling

The pre-write gate should fail loud.

Failures should stop before wiki writes and preserve enough context for the next run:

- malformed curator JSON
- schema mismatch
- missing packet references
- unsupported operation
- missing provenance
- stale/degraded packet conditions
- proposed write too broad for the current slice

Provider or model failures should leave run artifacts where possible, but should not mutate Project Memory.

## Testing Strategy

Focused tests should prove:

- `project learn` builds or receives a Project Memory packet for curator input.
- Curator output must be JSON matching the proposal schema.
- Invalid proposals are rejected before any wiki file write.
- Missing provenance is rejected.
- Unknown packet references are rejected.
- Out-of-wiki target paths are rejected.
- Unsupported broad operations are rejected or quarantined.
- Degraded packet state is surfaced in validation findings.
- Existing wiki markdown without `project-memory.json` is treated as context, not trusted curated state.

Repo-native verification remains:

```bash
bun test
bun run typecheck
git diff --check
```

## Planning Boundary Guidance

Later implementation planning should split this design into smaller chunks:

- Shared Project Memory curator primitives.
- Creation brain-draft TypeScript schema and validator.
- Maintenance mutation-proposal TypeScript schema and validator.
- Pipeline runner wiring so `project learn` passes the Project Memory packet to the curator stage.
- Run artifact changes for proposal and validation results.
- Pre-write rejection tests for invalid proposals.
- Later bounded apply path that mutates markdown with provenance.

Do not combine this pre-write contract with derived Project Memory vector indexing, auto-maintenance scheduling, Practice/Personal Memory promotion, or Current Briefing.

## Acceptance Criteria

- The design defines separate Project Memory Curator output contracts for creation and maintenance.
- The design defines deterministic validation rules before wiki writes.
- The design states how `project learn` uses the Project Memory packet as curator input.
- The design handles creation-mode ambiguity when markdown exists but trusted Project Memory state is absent.
- The design defines rejected, review/quarantine, and eligible proposal outcomes.
- The design keeps markdown canonical and treats SQLite/vector state as non-canonical.
- The design explicitly defers actual page mutation, derived retrieval indexing, scheduling, Practice/Personal Memory, and Current Briefing.

## Assumptions

- The current `project-memory-packet.ts` shape is directionally correct, though it may need small additions.
- The first implementation can validate maintenance proposal eligibility without applying markdown changes.
- Addressable Project Memory entries are still the intended durable unit, but their exact markdown encoding can be finalized in a later apply/write slice.
- Preexisting wiki pages may be useful evidence or context, but they are not proof that the project has current curated Project Memory state.

## Open Questions

No blocking design questions remain for this brainstorming slice.

Remaining non-blocking shaping work:

- Define exact fields for the Project Memory Creation Draft and Project Memory Maintenance Proposal.
- Define exact validation blocking rules for creation publication versus maintenance eligibility.
