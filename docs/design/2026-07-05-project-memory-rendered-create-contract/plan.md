# Project Memory Rendered Documentation And Create Contract Implementation Plan Set

**Spec:** `spec.md`
**Agenda:** `agenda.md`
**Pseudocode:** Not present
**Context:** `../../../CONTEXT.md`
**ADRs:** `../../adr/0063-use-answer-domain-project-memory-documentation-map.md`, `../../adr/0064-use-two-pass-project-memory-evidence-workflow.md`, `../../adr/0065-require-independent-first-create-usefulness-critique.md`, `../../adr/0066-allow-clean-project-shell-rebootstrap-reset.md`
**Status:** Chunk Plans Created

## Goal

Implement the Project Memory Step 5/6 redesign so first-create Project Memory is generated as rendered, queryable, repo-grounded documentation: sectioned markdown payloads, answer-domain coverage, a deterministic evidence-map pass before writing, independent usefulness critique, all-or-nothing promotion, compact failed-run state, and explicit clean project-shell reset that preserves root SQLite continuity.

## Source Artifacts

- `docs/design/2026-07-05-project-memory-rendered-create-contract/spec.md`
- `docs/design/2026-07-05-project-memory-rendered-create-contract/agenda.md`
- `MY_VISION.md`
- `docs/ROADMAP.md`
- `CONTEXT.md`
- `docs/adr/0063-use-answer-domain-project-memory-documentation-map.md`
- `docs/adr/0064-use-two-pass-project-memory-evidence-workflow.md`
- `docs/adr/0065-require-independent-first-create-usefulness-critique.md`
- `docs/adr/0066-allow-clean-project-shell-rebootstrap-reset.md`
- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/dogfood-validation.md`

Code paths inspected:

- `src/project/project-memory-apply-contracts.ts`
- `src/project/project-memory-markdown-renderer.ts`
- `src/project/project-memory-markdown-sections.ts`
- `src/project/project-memory-section-renderer.ts`
- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-output-schema.ts`
- `src/project/project-memory-curator-validator.ts`
- `src/project/project-memory-quality-contract.ts`
- `src/project/project-memory-prompt-budget.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-markdown-applier.ts`
- `src/project/project-memory-packet.ts`
- `src/query/project-memory-query-service.ts`
- `src/runtime/bootstrap.ts`
- `src/runtime/project-shell.ts`
- `src/memory/db.ts`
- `src/memory/migrations.ts`

Tests and verification commands discovered:

- `bun test`
- `bun run typecheck`
- `git diff --check`
- `tests/project/project-memory-markdown-renderer.test.ts`
- `tests/project/project-memory-markdown-sections.test.ts`
- `tests/project/project-memory-curator-output-schema.test.ts`
- `tests/project/project-memory-curator-validator.test.ts`
- `tests/project/project-memory-curator-service.test.ts`
- `tests/project/project-memory-markdown-applier.test.ts`
- `tests/query/project-memory-query-service.test.ts`
- `tests/memory/project-memory-retrieval-indexer.test.ts`
- `tests/commands/project.test.ts`

External design audit:

- Software Architect sub-agent audited the design/spec and returned `Ready for Development`.
- The audit blocker was resolved by reconciling `docs/ROADMAP.md` with answer-domain language and tightening evidence-map and critique-status semantics.

External plan-set audit:

- Software Architect sub-agent audited the full plan set and initially returned `Needs Refinement`.
- Critical findings were resolved by adding the execution continuation preflight, clarifying `required_topics` semantics, owning the `rg` runtime dependency/failure mode, refreshing stale spec status, and naming the usefulness-critique provider seam.

## Current Worktree Execution Preflight

This plan set may be executed in two modes:

- **Clean baseline mode:** start from a clean worktree before any chunk implementation.
- **Continuation mode:** continue from the current dirty worktree after reviewing `git status --short` and treating existing plan-related source/test changes as partially applied chunk work.

For the current repository state, use continuation mode. Before editing, an executor must:

1. Run `git status --short`.
2. Identify existing changes related to this plan set, especially new or modified files under `src/project/`, `src/query/`, `tests/project/`, `tests/query/`, and this design folder.
3. Diff existing implementation before applying each chunk so already-applied work is audited or refined, not blindly replayed.
4. Preserve unrelated user changes and stop if an overlapping change cannot be reconciled safely.

Do not interpret pre-change failure expectations inside chunk files as required current failures when the chunk has already been partially or fully implemented.

## Design Readiness Check

- Source artifact paths verified: Pass.
- Pseudocode artifacts: Absent. No planning impact; this plan must preserve the final spec/agenda/ADR boundaries directly.
- Pseudocode alignment: Not applicable.
- Missing or unavailable artifacts: None.
- Open agenda questions or risks: No open agenda questions. One non-blocking planning risk remains: exact CLI spelling for clean reset/rebootstrap belongs to implementation planning.
- Spec / agenda / context / ADR consistency: Pass. All agree that answer-domain documentation replaces the six-role taxonomy as create-mode authority, the evidence map precedes writing, the independent critique gates first-create curated state, and clean rebootstrap preserves `state/memory.db`.
- Parent / child spec consistency: Pass. `docs/ROADMAP.md` Step 5/6 now matches the final answer-domain direction.
- Accepted planning reconciliations:
  - Old `PROJECT_MEMORY_DOCUMENTATION_ROLES`, `required_sections`, and role coverage remain in code only as implementation targets to retire for create mode.
  - Existing retrieval indexing and query hydration remain conceptually valid because they already derive from rendered markdown sections.
  - Clean reset is explicit operator-selected work; ordinary `project learn` must not become a destructive command.
- Blockers: None.

## Unresolved Decision Ownership

| Item | Type | Owning Chunk | Must Resolve Before | Notes |
| --- | --- | --- | --- | --- |
| Exact CLI spelling for clean reset/rebootstrap | Deferred implementation decision | `09-clean-rebootstrap-reset.md` | Implementation steps in owning chunk | Must choose explicit operator surface and preflight wording before any destructive behavior. |
| Retiring role coverage as create-mode authority while preserving maintain-mode compatibility as needed | Reconciliation | `02-answer-domain-contracts.md` | Implementation steps in owning chunk | Current code exposes `PROJECT_MEMORY_DOCUMENTATION_ROLES`, `ProjectMemoryDocumentationRole`, `role_coverage`, and `required_sections`. |
| Evidence-map stage must remain separate from writer prompt | Non-blocking risk | `04-evidence-map-builder.md` | Implementation steps in owning chunk | Prevents the redesign from collapsing into a looser prompt. |
| Evidence map must perform bounded repo-local search, not static path hints only | Non-blocking risk | `04-evidence-map-builder.md` | Implementation steps in owning chunk | Required to make candidates leads that drive real repo evidence discovery. |
| Deterministic validation must consume evidence-map support | Non-blocking risk | `05-create-mode-schema-validator.md` | Implementation steps in owning chunk | Prevents evidence grounding from being prompt-only. |
| Independent critique must be structured, not vague prose | Non-blocking risk | `07-independent-usefulness-critique.md` | Implementation steps in owning chunk | Verdict vocabulary is `pass`, `review_only`, `fail`; `blocked` is deterministic/infrastructure only. |

## Proposed Chunks

| Chunk | Purpose | Depends On | Enables | Status |
| --- | --- | --- | --- | --- |
| `plans/01-sectioned-page-payload-renderer.md` | Replace create-mode page body rendering with structured section payloads that render real markdown headings and section-level provenance. | None | `plans/02-answer-domain-contracts.md`, `plans/03-rendered-quality-evaluator.md` | Ready For Implementation |
| `plans/02-answer-domain-contracts.md` | Replace create-mode role taxonomy authority with answer-domain contracts across TypeScript types, JSON schema, prompt contract, and quality diagnostics shape. | `plans/01-sectioned-page-payload-renderer.md` | `plans/03-rendered-quality-evaluator.md`, `plans/04-evidence-map-builder.md`, `plans/05-create-mode-schema-validator.md` | Ready For Implementation |
| `plans/03-rendered-quality-evaluator.md` | Compute create-mode quality from rendered markdown sections, answer-domain coverage, section depth, citations, shallow findings, and deterministic answerability fixtures. | `plans/01-sectioned-page-payload-renderer.md`, `plans/02-answer-domain-contracts.md` | `plans/05-create-mode-schema-validator.md`, `plans/08-all-or-nothing-promotion-state.md` | Ready For Implementation |
| `plans/04-evidence-map-builder.md` | Add the deterministic two-pass evidence-map artifact builder for answer domains before curator writing. | `plans/02-answer-domain-contracts.md` | `plans/05-create-mode-schema-validator.md`, `plans/06-curator-writer-flow.md`, `plans/07-independent-usefulness-critique.md` | Ready For Implementation |
| `plans/05-create-mode-schema-validator.md` | Wire the new create-mode output schema and validator to require sectioned pages, answer-domain evidence, rendered quality, and failed-run diagnostics. | `plans/02-answer-domain-contracts.md`, `plans/03-rendered-quality-evaluator.md`, `plans/04-evidence-map-builder.md` | `plans/06-curator-writer-flow.md`, `plans/08-all-or-nothing-promotion-state.md` | Ready For Implementation |
| `plans/06-curator-writer-flow.md` | Update `project learn` create mode transport/prompt/service orchestration so the writer consumes the evidence map and cannot substitute generic prose for missing evidence. | `plans/04-evidence-map-builder.md`, `plans/05-create-mode-schema-validator.md` | `plans/07-independent-usefulness-critique.md`, `plans/10-dogfood-regression-slice.md` | Ready For Implementation |
| `plans/07-independent-usefulness-critique.md` | Add the independent model-backed usefulness critique artifact, structured verdict handling, and service gating before curated state. | `plans/04-evidence-map-builder.md`, `plans/05-create-mode-schema-validator.md`, `plans/06-curator-writer-flow.md` | `plans/08-all-or-nothing-promotion-state.md`, `plans/10-dogfood-regression-slice.md` | Ready For Implementation |
| `plans/08-all-or-nothing-promotion-state.md` | Enforce all-or-nothing first-create promotion and compact terminal project state for curated, shallow, blocked, and review-only outcomes. | `plans/03-rendered-quality-evaluator.md`, `plans/05-create-mode-schema-validator.md`, `plans/07-independent-usefulness-critique.md` | `plans/09-clean-rebootstrap-reset.md`, `plans/10-dogfood-regression-slice.md` | Ready For Implementation |
| `plans/09-clean-rebootstrap-reset.md` | Add explicit clean project-shell rebootstrap reset that deletes/recreates `projects/<key>/` material while preserving root `state/memory.db`. | `plans/08-all-or-nothing-promotion-state.md` | `plans/10-dogfood-regression-slice.md` | Ready For Implementation |
| `plans/10-dogfood-regression-slice.md` | Add end-to-end regression coverage and documented dogfood acceptance checks proving the June 30 shallow shape cannot pass and clean create preserves root memory continuity. | `plans/06-curator-writer-flow.md`, `plans/07-independent-usefulness-critique.md`, `plans/08-all-or-nothing-promotion-state.md`, `plans/09-clean-rebootstrap-reset.md` | Step 7 maintenance planning | Ready For Implementation |

## Dependency Order

1. `01-sectioned-page-payload-renderer.md`
2. `02-answer-domain-contracts.md`
3. `03-rendered-quality-evaluator.md`
4. `04-evidence-map-builder.md`
5. `05-create-mode-schema-validator.md`
6. `06-curator-writer-flow.md`
7. `07-independent-usefulness-critique.md`
8. `08-all-or-nothing-promotion-state.md`
9. `09-clean-rebootstrap-reset.md`
10. `10-dogfood-regression-slice.md`

Potential parallelism after roadmap approval:

- `03-rendered-quality-evaluator.md` and `04-evidence-map-builder.md` can be planned as separate chunks after `02-answer-domain-contracts.md`, but implementation should coordinate shared answer-domain types.
- `09-clean-rebootstrap-reset.md` can be implementation-independent from provider prompt details, but should wait for `08-all-or-nothing-promotion-state.md` so reset state semantics are settled.

## Shared Contracts

- Sectioned page apply payload:
  - create-mode page drafts include ordered sections with heading, body, evidence refs, repo citations, warnings, and optional inference.
  - renderer emits real markdown headings consumed by `extractProjectMemorySectionsFromMarkdown`.
- Answer-domain contract:
  - create-mode authority is answer-domain coverage, not `PROJECT_MEMORY_DOCUMENTATION_ROLES`.
  - initial required domains: product and memory model, storage and retrieval, command workflows, curation and apply lifecycle, evidence/provenance/candidate boundaries, current work/roadmap/decisions.
  - `required_topics` are coverage labels that describe what a page claims to cover; they are not exact strings that must appear verbatim in rendered body text. Deterministic trust comes from answer-domain coverage, evidence-map support, rendered section depth, citations, and answerability fixtures.
- Evidence-map artifact:
  - run artifact records required domains, representative questions, inspected paths/source refs, cited repo/docs/state/test/ADR evidence, candidate/session leads considered, evidence found/missing, and deterministic discovery steps.
  - discovery includes bounded repo-local `rg` searches with result caps, generated-path exclusions, and read-size caps; static path hints alone are insufficient.
  - deterministic validation consumes the evidence-map object before apply and rejects trusted create output when declared answer domains have no supporting evidence-map refs.
  - `rg` is an explicit Myelin runtime prerequisite for create-mode evidence discovery in this plan set. If `rg` is unavailable, create mode must fail before writes with a deterministic blocked/failed-run diagnostic and compact project-state artifact refs, rather than silently publishing incomplete documentation.
- Deterministic quality diagnostics:
  - content quality is separate from retrieval readiness.
  - `blocked` belongs to deterministic validation or infrastructure conditions.
- Independent usefulness critique:
  - structured verdict is `pass`, `review_only`, or `fail`.
  - critique reviews rendered markdown and evidence map, not hidden model reasoning.
- First-create promotion:
  - canonical wiki and `status: curated` state are all-or-nothing.
  - failed/shallow/review-only/blocked outputs remain in run artifacts plus compact project-state refs.
- Clean reset:
  - explicit operator-selected action can delete/recreate `projects/<key>/`.
  - root `state/memory.db` must be preserved unless an explicit memory wipe is requested.
- Retrieval/query boundary:
  - Project Memory retrieval rows remain derived pointers back to canonical rendered markdown sections.

## Spec Coverage Map

| Spec Requirement | Covered By | Notes |
| --- | --- | --- |
| Structured section payloads render real markdown headings | `01-sectioned-page-payload-renderer.md` | Foundation for rendered quality and retrieval. |
| Quality computed from rendered markdown sections | `03-rendered-quality-evaluator.md` | Uses same section extractor as retrieval. |
| Answer-domain documentation replaces six-role create taxonomy | `02-answer-domain-contracts.md`, `03-rendered-quality-evaluator.md` | Old roles become historical/non-authoritative for create mode. |
| Evidence map precedes curator writing | `04-evidence-map-builder.md`, `06-curator-writer-flow.md` | Must remain separate from writer prompt. |
| Curator output schema and deterministic validation match new contract | `05-create-mode-schema-validator.md` | Includes provider-safe schema updates. |
| Writer cannot paper over missing evidence | `04-evidence-map-builder.md`, `06-curator-writer-flow.md`, `05-create-mode-schema-validator.md` | Missing evidence becomes diagnostics, not generic prose. |
| Independent usefulness critique gates curated state | `07-independent-usefulness-critique.md`, `08-all-or-nothing-promotion-state.md` | Verdict vocabulary excludes `blocked`. |
| All-or-nothing first-create promotion | `08-all-or-nothing-promotion-state.md` | Partial output remains in artifacts. |
| Compact failed-run resume state | `08-all-or-nothing-promotion-state.md` | Project state points to detailed artifacts. |
| Clean rebootstrap reset preserves root memory DB | `09-clean-rebootstrap-reset.md`, `10-dogfood-regression-slice.md` | Destructive behavior requires explicit preflight. |
| June 30 shallow role-shaped output cannot pass | `03-rendered-quality-evaluator.md`, `05-create-mode-schema-validator.md`, `10-dogfood-regression-slice.md` | Regression target from dogfood validation. |
| Existing query hydration still returns canonical markdown content/refs | `01-sectioned-page-payload-renderer.md`, `03-rendered-quality-evaluator.md`, `10-dogfood-regression-slice.md` | Query service should not become source of truth. |

## Verification Strategy

Repo-native verification should remain Bun/TypeScript based:

- Focused unit tests for each affected module, especially:
  - `tests/project/project-memory-markdown-renderer.test.ts`
  - `tests/project/project-memory-markdown-sections.test.ts`
  - `tests/project/project-memory-curator-output-schema.test.ts`
  - `tests/project/project-memory-curator-validator.test.ts`
  - `tests/project/project-memory-curator-service.test.ts`
  - `tests/project/project-memory-markdown-applier.test.ts`
  - `tests/query/project-memory-query-service.test.ts`
  - `tests/commands/project.test.ts`
- Full verification after integrated chunks:
  - `bun test` should exit 0.
  - `bun run typecheck` should exit 0.
  - `git diff --check` should report no whitespace errors.
- Dogfood/regression slice should include command-level JSON contract checks for:
  - shallow/role-shaped create output rejected before canonical wiki/state promotion;
  - trusted content with pending retrieval remains separate from retrieval readiness;
  - clean reset preserves `state/memory.db`.

## Risks And Sequencing Notes

- Role taxonomy removal is high-touch: `PROJECT_MEMORY_DOCUMENTATION_ROLES`, `ProjectMemoryDocumentationRole`, `role_coverage`, and `required_sections` are referenced across contracts, schema, validator, prompt, and tests. Retire create-mode authority early before downstream chunks build on it.
- Provider structured-output schemas are strict. Schema changes must preserve provider-safe JSON Schema patterns already learned in this repo.
- Evidence-map work can degrade into a prompt-only change. Keep it a deterministic artifact builder with explicit missing-evidence output.
- Evidence-map search must stay bounded and deterministic. Use capped `rg` results, generated/runtime path exclusions, and explicit missing-evidence diagnostics instead of exhaustive repository crawling.
- `rg` is an accepted runtime dependency for this create-mode slice. If future packaging wants zero external binary assumptions, that is a separate fallback task; this plan owns the current dependency by documenting and failing closed when it is unavailable.
- The current workspace may already contain uncommitted implementation changes for this design. `$pmp-executing-plans` must either start from a clean pre-implementation baseline or explicitly continue from the existing dirty implementation after reviewing `git status`; it must not assume an empty workspace.
- Independent critique can degrade into vague model prose. Keep a structured contract and cited weak-section refs.
- Clean rebootstrap is destructive. Keep it explicit, preflighted, and tested for `state/memory.db` preservation.
- Query/retrieval should remain derived from markdown sections. Do not make SQLite/vector rows canonical Project Memory while adding richer section metadata.

## Execution Handoff

Recommended next skill after chunk plans are approved: `$pmp-executing-plans`.

Execution should load:

- `docs/design/2026-07-05-project-memory-rendered-create-contract/plan.md`
- selected chunk plan files under `docs/design/2026-07-05-project-memory-rendered-create-contract/plans/`
- `spec.md`
- `agenda.md`
- `CONTEXT.md`
- ADR 0063, 0064, 0065, and 0066
- `docs/ROADMAP.md`

Execution should stop on unclear plan steps, failed verification, code/spec conflict, missing dependencies, unsafe reset ambiguity, user-requested changes, or overlapping uncommitted implementation changes without explicit continuation instructions.

## User Approval

The roadmap was approved for chunk creation. Chunk plan files now exist under `plans/`.

Before implementation starts, run the full external plan-set audit workflow and treat `Ready for Development` as ready for `$pmp-executing-plans`.
