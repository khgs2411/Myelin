# Project Memory Curator Pre-Write Gate Design Agenda

## Status

- Spec: `spec.md`
- State: Complete
- Completion gate:
  - Live agenda questions resolved: Yes
  - Pressure test complete: Yes
  - Spec finalized: Yes
  - Approved for implementation planning: Yes

## Documented Decisions

- Project Memory canonical truth lives in project markdown plus project state, not SQLite.
- SQLite/vector Project Memory rows are derived retrieval state only and must point back to markdown.
- Session Memory and Project Memory differ: Session Memory trusted records live in SQLite, while Project Memory answers must resolve back to markdown.
- The Project Memory Curator must return structured proposals, not write markdown directly.
- Myelin must validate proposals deterministically before canonical markdown can change.
- `project learn` should use the bounded Project Memory packet as the curator input.
- `project learn` may inspect the live repo directly, but durable writes require traceable evidence or explicit inference labels.
- Current Briefing, derived retrieval indexing, Practice Memory, and Personal Memory are outside this brainstorming scope.
- The current Step 3 brainstorming scope covers the parent `project learn` evolution only through the pre-write gate: packet input, curator proposal schema, and rejection before wiki writes.
- Design posture for this slice: because this is early foundational product work with no external deadline, prefer the strongest long-term product shape and clearest boundaries over minimizing implementation workload. The user clarified this as a general durable preference, not only a local project choice.
- ADR 0058 records the mode-scoped `project learn` curator-contract decision.
- Follow-up revision: there is no old Project Memory command surface to preserve. `project ingest` is obsolete in the target V2 model because authoritative `project learn` supersedes separate Project Memory source/inbox intake.
- Follow-up revision: `src/pipeline/runner.ts` should not remain a Project Memory product abstraction. Useful mechanics may be extracted into runtime helpers, but Project Memory semantics move to `ProjectMemoryCuratorService`.

## Questions

### Question 1: Proposal operation boundary

- Status: Answered
- Branch type: Initial
- Why it matters: This decides whether the first schema is a narrow pre-write eligibility contract or a broader write contract that includes page creation, structural rewrites, splits, and merges.
- Scenario probe: The curator sees one precise fact that belongs in an existing setup page, one missing page about architecture, and one request to reorganize all preexisting untrusted markdown pages. Which of these can be a valid proposal item in this first slice?
- Options:
  - A. Entry-level only - support `CREATE_ENTRY`, `PATCH_ENTRY`, evidence/lifecycle operations, and `NOOP`; page creation and broad rewrites become rejected/review items for later. This is safer and fits the pre-write gate, but does not fully create new Project Memory pages yet.
  - B. Entry plus explicit new-page requests - allow entry operations and narrowly bounded `CREATE_PAGE`; broad rewrites still rejected. This helps creation mode but increases validator complexity.
  - C. Full mutation vocabulary now - include page creation, split, merge, delete, broad rewrite, and lifecycle operations. This is comprehensive but risks designing the whole apply layer before the pre-write contract is stable.
- Recommendation: B. The contract should be mostly entry-level, but creation mode probably needs a way to propose a new canonical page without pretending it can already apply broad rewrites.
- Answer: Mode-scoped authority. `project learn` is authoritative, but its permissions depend on project state. In initial creation/onboarding mode, where the project has only a bootstrap shell and no Project Memory, the agent should have broad creative authority to create the first working brain/wiki using a powerful model. In self-maintenance mode, where Session Memory has produced project candidates/handoffs for review, the harness should constrain the curator more tightly around bounded proposals, deterministic validation, and code-owned checks.
- Answer impact: Changes model
- Spec impact: Updated the design from one operation boundary to mode-scoped authority: creation mode can propose broad first-brain structure, while maintenance mode uses tighter pre-write constraints.
- Context impact: Updated - added Project Memory Creation Mode and Project Memory Maintenance Mode to `CONTEXT.md`.
- ADR impact: Created - ADR 0058 records mode-scoped `project learn` curator contracts.
- Follow-ups: Add Question 1A on the exact mode permission tiers.

### Question 1A: Mode-scoped `project learn` authority

- Status: Answered
- Branch type: Follow-up
- Why it matters: The previous answer makes `project learn` authoritative, but the implementation needs a deterministic way to decide which authority profile applies and what the harness must enforce before invoking the agent.
- Scenario probe: A project has a bootstrap shell, preexisting wiki pages, no `project-memory.json`, and several Session Memory project handoffs. Is this initial creation or constrained maintenance?
- Options:
  - A. Two modes only: `create` when no curated Project Memory exists, `maintain` after `project-memory.json` exists. Clear and state-driven; preexisting wiki pages are untrusted context inside create mode.
  - B. Three modes: `create`, `adopt-existing`, and `maintain`. More explicit for projects with preexisting wiki pages, but risks making untrusted markdown look like its own product lifecycle.
  - C. One command mode with per-operation permissions inferred dynamically. Flexible, but makes the harness harder to reason about and test.
- Recommendation: A. The best boundary is not a third compatibility/migration mode; it is a strict trust distinction. Either trusted Project Memory exists or it does not.
- Answer: A. Use two deterministic state-derived modes. `create` applies when no trusted curated Project Memory exists, even if preexisting wiki markdown exists. `maintain` applies after trusted curated Project Memory state exists. Preexisting wiki markdown should be included as flagged untrusted context inside the `create` packet rather than becoming a separate lifecycle mode.
- Answer impact: Confirms branch
- Spec impact: Updated the mode-scoped authority section to define `create` and `maintain` as the initial mode set and to classify old wiki pages as untrusted context within `create`.
- Context impact: Updated - added Project Memory Creation Mode, Project Memory Maintenance Mode, and Untrusted Existing Markdown Context to `CONTEXT.md`.
- ADR impact: Created - ADR 0058 records mode-scoped `project learn` curator contracts.
- Follow-ups: Question 4 should be revised or marked obsolete because old markdown handling is now partly answered by this mode decision.

### Question 2: Validation outcome vocabulary

- Status: Answered
- Branch type: Initial
- Why it matters: The validator needs more than pass/fail if `project learn` is becoming an autonomous maintenance flow. Later apply/scheduling code will depend on these states.
- Scenario probe: A proposal has three items: one precise sourced setup update, one unsupported inference, and one broad architecture rewrite. Should the whole proposal fail, should valid items continue, or should items split into outcomes?
- Options:
  - A. Whole-proposal fail on any hard error - simplest and safest early behavior, but one bad item blocks unrelated good items.
  - B. Per-item outcomes with proposal-level eligibility - valid items can be eligible while rejected/quarantined items remain blocked; more complex but closer to autonomous maintenance.
  - C. Only boolean valid/invalid now - fastest, but loses information needed for run artifacts, retries, and candidate lifecycle.
- Recommendation: B. Use per-item outcomes, with the overall proposal eligible only when at least one item is eligible and no global hard error exists.
- Answer: B. The curator returns structured JSON items. The harness validates each item mechanically against the schema, mode permissions, target path, packet references, evidence references, risk flags, and degraded packet state. Good items can be marked eligible while malformed, unsupported, missing-evidence, broad, or risky items are rejected or quarantined. The harness is not judging arbitrary prose quality; it is checking whether each structured proposal item is safe enough to proceed.
- Answer impact: Confirms branch
- Spec impact: Updated validation contract to require per-item outcomes and to clarify that the harness validates structured fields mechanically.
- Context impact: Not needed
- ADR impact: Not needed - item outcome vocabulary is part of the curator contract captured in the spec and does not need a separate ADR.
- Follow-ups:

### Question 3: Provenance minimum for pre-write eligibility

- Status: Answered
- Branch type: Initial
- Why it matters: "Provenance or it did not happen" is already accepted, but the validator needs a concrete minimum it can enforce without semantic judgment.
- Scenario probe: The curator proposes "local Supabase must run through `scripts/supa.sh`." It cites a Session Memory row, a repo file path without line ranges, and says it inferred the rest from context. Is that enough to become eligible for markdown mutation later?
- Options:
  - A. Require at least one resolvable evidence reference from the packet for every durable claim; inference labels are allowed only for clearly marked synthesis. This is enforceable and preserves safety.
  - B. Require repo file citations with line ranges for every claim. Strongest evidence, but too strict for decisions, current state, and preserved source material.
  - C. Allow Session Memory/candidate references as sufficient evidence without repo or preserved-source support. This is flexible but risks promoting continuity notes into Project Memory too easily.
- Recommendation: A. Enforce packet-resolvable evidence for every proposal item, and require explicit inference labeling when evidence is indirect.
- Answer: A, with a practical repo-citation expectation. The schema floor is at least one packet-resolvable evidence reference for every proposal item, with explicit inference labeling when evidence is indirect. However, repo/file citations should be treated as practically required whenever the durable claim can be grounded in repo files. The schema should not require repo citations for every fact because some valid Project Memory facts are decisions, current state, source material, or synthesis rather than repo-line facts.
- Answer impact: Confirms branch
- Spec impact: Updated provenance guidance so packet-resolvable evidence is the mechanical minimum, while repo/file citations are an expected best-practice requirement whenever available.
- Context impact: Not needed
- ADR impact: Not needed
- Follow-ups:

### Question 4: Existing markdown without curated state

- Status: Answered
- Branch type: Initial
- Why it matters: The dogfood `llm-wiki` project has preexisting wiki pages but no `project-memory.json`. The contract must tell `project learn` whether to treat those pages as trusted Project Memory, untrusted context, or stale context.
- Scenario probe: A project has 20 preexisting wiki pages, `bootstrap-state.status = uncurated`, and no `project-memory.json`. A handoff asks whether the active-vs-legacy project policy is documented. Should lookup matches in those pages count as "already documented"?
- Options:
  - A. Treat preexisting markdown as context only until `project-memory.json` is curated - safest trust boundary, but may create duplicate adoption proposals.
  - B. Treat old markdown as trusted if it has page metadata/freshness state - pragmatic, but contradicts the missing curated state.
  - C. Introduce an explicit adoption status in the packet so the curator can propose adopting, updating, or quarantining preexisting pages before treating them as trusted.
- Recommendation: C. The packet should distinguish "markdown exists" from "trusted curated Project Memory exists" and let the proposal contract represent adoption intent without auto-trusting old pages.
- Answer: Resolved by Question 1A. Preexisting markdown without trusted `project-memory.json` does not create a separate mode and does not count as trusted Project Memory. It is flagged as untrusted context inside `create` mode. Lookup matches in untrusted markdown can inform the agent, but they should not by themselves count as "already documented" in trusted Project Memory.
- Answer impact: Resolves branch
- Spec impact: The mode-scoped authority section now states that old wiki markdown remains create-mode untrusted context until trusted Project Memory exists.
- Context impact: Updated - added Untrusted Existing Markdown Context to `CONTEXT.md`.
- ADR impact: Created - ADR 0058 includes the trust boundary for preexisting markdown.
- Follow-ups: None.

### Question 5: Pipeline artifact naming and stage boundary

- Status: Answered
- Branch type: Initial
- Why it matters: The current runner uses `03-propose`, `04-apply`, and `06-validate`, but the new behavior is a curator proposal pre-write gate. Naming affects future plans, tests, and operator/debugging output.
- Scenario probe: A future agent opens a failed run directory. Should they see generic `propose-result.json` and `apply-result.json`, or explicit mode-specific curator output such as `curator-maintenance-proposal.json` plus `curator-validation.json`?
- Options:
  - A. Keep existing stage names and generic artifacts - least disruptive, but preserves old mental models.
  - B. Keep stage IDs as wrappers but write curator-named artifacts inside the run - clearer artifacts, but still hides the product boundary behind old stage names.
  - C. Rename or reshape stages around curator-specific concepts - cleanest product and code boundary.
- Recommendation: C. Use curator-specific stage and artifact names because the clearest long-term product shape matters more than preserving historical scaffolding.
- Answer: C. Choose the clearest long-term product shape, not the smallest compatibility step. The concept of V1 migration should not drive design because V1 is discarded. Rename or reshape the relevant `project learn` stages around Project Memory Curator concepts rather than preserving generic Phase-0 stage names solely to reduce work.
- Answer impact: Changes model
- Spec impact: Updated the stage boundary guidance to prefer curator-specific stage and artifact naming for `project learn`, with any old generic pipeline naming treated as historical scaffolding rather than a compatibility constraint.
- Context impact: Not needed
- ADR impact: Not needed
- Follow-ups: Completed by Question 7. The design now removes `project ingest` from the target model and demotes `runner.ts` to extractable mechanics only.

### Question 6: Creation output contract versus maintenance proposal contract

- Status: Answered
- Branch type: Pressure-test
- Why it matters: The design now gives `create` mode broad first-brain authority and `maintain` mode constrained proposal authority. If both modes are forced through one proposal schema only for convenience, either creation becomes artificially cramped or maintenance becomes too permissive.
- Scenario probe: `bootstrap` is followed by `project learn` for a brand-new repo. The agent needs to create a whole first brain: root readme, wiki index, setup page, architecture page, and decisions page. Later, self-maintenance only needs to add one sourced setup entry and quarantine one risky architecture rewrite. Should both runs emit the same JSON contract?
- Options:
  - A. One shared schema with mode-specific operation allowlists - fewer concepts, but creation and maintenance may keep pulling the schema in opposite directions.
  - B. Two related contracts: a creation brain-draft contract and a maintenance mutation-proposal contract - clearer boundaries and stronger long-term shape, but more design and implementation work.
  - C. One generic "curator changeset" contract with many optional fields - flexible, but risks becoming vague and harder for the harness to validate.
- Recommendation: B. Creation and maintenance are different authority profiles and should have related but separate output contracts. They can share common evidence, path, and validation primitives, but the top-level contracts should make the lifecycle mode obvious.
- Answer: B. Use two related contracts: a creation brain-draft contract for first-brain creation and a maintenance mutation-proposal contract for ongoing constrained updates. They should share evidence, path, validation-finding, and risk primitives, but the top-level contracts should be separate.
- Answer impact: Confirms branch
- Spec impact: Updated the technical design and data/state contract surfaces to distinguish creation brain drafts from maintenance mutation proposals.
- Context impact: Updated - added Project Memory Creation Draft and Project Memory Maintenance Proposal to `CONTEXT.md`.
- ADR impact: Created - ADR 0058 records separate creation and maintenance curator contracts.
- Follow-ups:

### Question 7: Separate `project ingest` and runner preservation

- Status: Answered
- Branch type: Follow-up
- Why it matters: The earlier artifacts left room for `project ingest` and `src/pipeline/runner.ts` to survive as compatibility surfaces. That contradicts the ground-up V2 posture: there is no active old product surface to preserve, and preserving weak boundaries would make planning inherit old Phase-0 assumptions.
- Scenario probe: `project learn` has moved into `ProjectMemoryCuratorService`. There are queued Project Memory source/inbox items. Should the operator run a separate `project ingest`, should the old runner process them, or should `project learn` gather them into the curator packet?
- Options:
  - A. Preserve `project ingest` temporarily on `runner.ts`. This minimizes implementation work but keeps two Project Memory maintenance commands and old pipeline semantics alive.
  - B. Remove `project ingest` as a Project Memory command and fold source/inbox intake into authoritative `project learn`. Extract only mechanical helpers from `runner.ts` if useful.
  - C. Keep `project ingest` but rename it to a source-specific command. This clarifies naming but still splits Project Memory maintenance authority.
- Recommendation: B. This matches the strongest-boundary posture: one authoritative Project Memory maintenance command, one semantic service, no compatibility shell.
- Answer: B. `project ingest` is obsolete in the target V2 Project Memory model. `project learn` supersedes it by gathering source/inbox material into the Project Memory packet and sending it through the curator flow. `src/pipeline/runner.ts` should not remain as a semantic orchestrator; implementation may extract generic mechanics such as run directory creation, JSON artifact writing, provider invocation wrappers, summary writing, and schema freshness helpers.
- Answer impact: Changes model
- Spec impact: Updated current context, user-facing behavior, technical design, planning boundaries, and acceptance criteria to remove `project ingest` from the target model and demote `runner.ts` to optional mechanical helper extraction.
- Context impact: Updated - clarified `Learn Command` as the authoritative Project Memory command and marked `project ingest` as obsolete in the target V2 model.
- ADR impact: Updated ADR 0058 to include the command/boundary consequence.
- Follow-ups:

## Pressure-Test Result

- Status: Complete
- Checked categories: lifecycle and interruption; state persistence; handoff boundaries; verification evidence; scope control; recovery paths; sequencing; user review points.
- Result: Added Question 6 during pressure testing because the quality-first posture exposed that creation and maintenance should not be forced through one generic schema. The user resolved it by choosing separate related contracts.
- Remaining non-blocking risks:
  - Exact field-level schemas for Project Memory Creation Draft and Project Memory Maintenance Proposal still need pseudocode or implementation planning.
  - Exact validation blocking rules for creation publication versus maintenance eligibility still need implementation-level shaping.
  - Implementation planning must decide whether any mechanics should be extracted from `src/pipeline/runner.ts` before deleting or replacing it; no Project Memory semantics should remain there.
