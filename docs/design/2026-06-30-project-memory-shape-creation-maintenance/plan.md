# Project Memory Shape, Creation, And Maintenance Implementation Plan Set

**Spec:** `spec.md`
**Agenda:** `agenda.md`
**Pseudocode:** `pseudocode/` loaded; reference-ready shaping artifacts
**Context:** `../../../../CONTEXT.md` updated glossary and relationships
**ADRs:** `docs/adr/0018-project-learn-can-read-live-repo.md`, `docs/adr/0021-keep-curated-project-memory-in-markdown.md`, `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`, `docs/adr/0059-use-structured-project-memory-apply-payloads.md`, `docs/adr/0060-use-apply-journal-for-project-memory-writes.md`, `docs/adr/0061-use-layer-shaped-runtime-inbox-with-implemented-consumers.md`, `docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`
**Status:** Chunk Plans Written

## Goal

Implement Step 4 so Project Memory is curated markdown documentation with a machine-checkable quality bar, section-first maintenance, normalized producer leads, and markdown-backed Project Memory query returns. The plan preserves the existing structured curator, validator, markdown applier, apply journal, retrieval indexing, and Session Memory query boundaries while replacing shallow page-count trust with a role-based documentation contract.

## Source Artifacts

- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/spec.md`
- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/agenda.md`
- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/pseudocode/README.md`
- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/pseudocode/QualityContractAndRunStatus.md`
- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/pseudocode/CreationDocumentationFlow.md`
- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/pseudocode/MaintenanceSectionTargetingFlow.md`
- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/pseudocode/ProducerCandidateBoundary.md`
- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/pseudocode/ProjectMemoryMarkdownQueryBoundary.md`
- `CONTEXT.md`
- `docs/ROADMAP.md`
- `docs/adr/0018-project-learn-can-read-live-repo.md`
- `docs/adr/0021-keep-curated-project-memory-in-markdown.md`
- `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`
- `docs/adr/0059-use-structured-project-memory-apply-payloads.md`
- `docs/adr/0060-use-apply-journal-for-project-memory-writes.md`
- `docs/adr/0061-use-layer-shaped-runtime-inbox-with-implemented-consumers.md`
- `docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`
- External design audit recorded in `agenda.md`: Software Architect sub-agent `019f1862-8938-76c3-aec6-227fa20e543a`, verdict `Ready for Development`.
- External roadmap audit: Senior Project Manager sub-agent `019f186b-434d-7b80-9b3c-63b198519f21`, verdict `Ready for Development`, interpreted as ready for user approval and chunk-plan generation. Critical issues: none.
- Code paths inspected: `src/project/project-memory-curator-contracts.ts`, `src/project/project-memory-curator-validator.ts`, `src/project/project-memory-curator-service.ts`, `src/project/project-memory-curator-output-schema.ts`, `src/project/project-memory-prompt-budget.ts`, `src/project/project-memory-markdown-applier.ts`, `src/project/project-memory-packet.ts`, `src/project/project-memory-markdown-sections.ts`, `src/project/project-memory-candidate-intake-service.ts`, `src/memory/project-memory-retrieval-index-service.ts`, `src/memory/project-memory-retrieval-indexer.ts`, `src/memory/project-memory-retrieval-storage.ts`, `src/memory/candidates.ts`, `src/memory/handoffs.ts`, `src/ingest/worker.ts`, `src/query/engine.ts`, `src/query/memory-query-service.ts`, `src/commands/memory.ts`, `package.json`.
- Tests discovered: `tests/project/project-memory-curator-contracts.test.ts`, `tests/project/project-memory-curator-output-schema.test.ts`, `tests/project/project-memory-curator-validator.test.ts`, `tests/project/project-memory-curator-service.test.ts`, `tests/project/project-memory-markdown-applier.test.ts`, `tests/project/project-memory-markdown-sections.test.ts`, `tests/project/project-memory-packet.test.ts`, `tests/project/project-memory-candidate-intake-service.test.ts`, `tests/project/project-memory-source-consumption-reconciler.test.ts`, `tests/memory/project-memory-retrieval-indexer.test.ts`, `tests/memory/project-memory-retrieval-storage.test.ts`, `tests/memory/project-memory-retrieval-text.test.ts`, `tests/memory/project-memory-hint-jobs.test.ts`, `tests/memory/memory-candidate-service.test.ts`, `tests/memory/handoffs.test.ts`, `tests/query/memory-query-service.test.ts`, `tests/query/memory-quality-eval.test.ts`.
- Validation commands discovered: `bun test`, `bun run typecheck`, `git diff --check`, `bun src/cli.ts project learn <key>`, `bun src/cli.ts memory index project <key>`, `bun src/cli.ts memory query <key> "<question>"`.

## Design Readiness Check

- Source artifact paths verified: Pass.
- Pseudocode artifacts: Loaded. All pseudocode files are non-executable reference artifacts; no missing planning-impact header was found.
- Pseudocode alignment: Pass. Proposed chunks preserve the five pseudocode boundaries: quality/status, creation flow, maintenance section targeting, producer candidate boundary, and markdown-backed query.
- Missing or unavailable artifacts: None.
- Open agenda questions or risks: No open design questions. Non-blocking planning risks remain for concrete quality metrics, section target identity, query size threshold/result shape, and dogfood validation criteria; each is assigned below.
- Spec / agenda / context / ADR consistency: Pass. The artifacts agree that Project Memory canonical truth remains markdown/state, candidates are leads, and retrieval rows are derived serving state.
- Parent / child spec consistency: Not applicable; no child specs are present.
- Accepted planning reconciliations: Query work is included as a separate late chunk rather than merged into creation or maintenance quality work. This preserves the audit recommendation while keeping the user-stated Project Memory query shape inside Step 4.
- Blockers: None.

## Resolved Execution Decisions

| Item | Type | Owning Chunk | Resolution | Notes |
| --- | --- | --- | --- | --- |
| Exact Project Memory Documentation Contract metrics | Resolved planning decision | `01-quality-contract-and-diagnostics.md` | Chunk 01 defines final thresholds: create mode requires all six roles, at least two sections per role, at least one direct repo citation per role, no deterministic shallow-summary findings, no missing coverage, and all project candidate/handoff leads disposed. Maintenance requires no shallow findings, supported candidate disposition, targeted section/page ownership, and no quality-regressing write. | These are implementation requirements, not executor policy choices. |
| Coverage-preserving role merge or split | Resolved reconciliation | `01-quality-contract-and-diagnostics.md` | No merge or split is allowed in Step 4. The six roles in `spec.md` are the contract for create mode. | Future changes require a design/spec update, not execution drift. |
| Quality diagnostics artifact placement | Resolved planning decision | `01-quality-contract-and-diagnostics.md` | Full diagnostics are stored in `curator-validation.json`; `curator-run-result.json` stores `content_quality_status`, `retrieval_readiness_status`, and `quality_diagnostics_ref`; trusted canonical state persists trusted content quality and retrieval readiness in `project-memory.json`. | Non-trusted diagnostics remain run artifacts only and never mark Project Memory curated. |
| Default creation orientation manifest | Resolved planning decision | `02-create-mode-documentation-contract.md` | The manifest is explicit in chunk 02. Missing default surfaces are allowed only when the file/path is absent and must be recorded in missing coverage diagnostics; present defaults must be inspected or validation fails. | Strong `llm-wiki` surfaces include `MYELIN.md`, `CONTEXT.md`, roadmap/design docs, relevant ADRs, and core `src/project`, `src/memory`, `src/query`, `src/commands`, and `src/runtime` surfaces. |
| Section identifier and marker strategy | Resolved planning decision | `03-section-targeting-foundation.md`, `05-maintain-mode-section-first-apply.md` | Use heading-derived `section_id` plus `section_hash`, `heading_path`, `start_line`, and `end_line`. Section writes patch by resolved section range and expected hash, not by heading text search. | Explicit markers are deferred; stale hash forces review. |
| Entry-block compatibility posture | Resolved planning decision | `03-section-targeting-foundation.md`, `05-maintain-mode-section-first-apply.md` | Existing entry-block rendering remains compatibility-only for legacy tests during chunk 05; new curator maintenance contract uses section operations. | Legacy entry operations must not remain the preferred provider contract after chunk 05. |
| Candidate weighting details | Resolved planning decision | `04-producer-boundary-and-packet-prioritization.md` | Candidate priority is diagnostic/prioritization-only. It can order curator attention but must never bypass evidence, target selection, validation, or quality gates. | `producer_kind` is diagnostic-only. |
| Project Memory query CLI shape and inline threshold | Resolved planning decision | `06-project-memory-markdown-query.md` | Add `--layer project` and `--max-inline-chars 4000`. Keep existing `matches` as Session Memory matches; add `project_memory_matches` for Project Memory. Default/auto preserves current Session Memory behavior in this slice. | Mixed Session+Project result synthesis is deferred. |
| Dogfood acceptance criteria and reset mechanics | Resolved planning decision | `07-dogfood-reset-and-validation.md` | Use a non-destructive baseline archive under `projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/`, move current `wiki/` and Project Memory state files there, prove packet mode is `create`, then run `project learn`. | Chunk 07 requires explicit execution confirmation before moving project memory files. |

## Proposed / Approved Chunks

| Chunk | Purpose | Depends On | Enables | Status |
| --- | --- | --- | --- | --- |
| [`01-quality-contract-and-diagnostics.md`](plans/01-quality-contract-and-diagnostics.md) | Add the shared Project Memory Documentation Contract, content-quality/retrieval-readiness vocabulary, deterministic diagnostics, and run/state status mapping. This boundary exists first because every later chunk needs the same quality result language. | None | `02-create-mode-documentation-contract.md`, `03-section-targeting-foundation.md`, `04-producer-boundary-and-packet-prioritization.md`, `05-maintain-mode-section-first-apply.md`, `07-dogfood-reset-and-validation.md` | Ready For Implementation |
| [`02-create-mode-documentation-contract.md`](plans/02-create-mode-documentation-contract.md) | Wire creation mode to the role-based documentation contract: prompt orientation, output schema, validator checks, shallow-content rejection, and curated-state gating. This is separate from chunk 01 because it changes create-mode provider contract and apply eligibility. | `01-quality-contract-and-diagnostics.md` | `07-dogfood-reset-and-validation.md` | Ready For Implementation |
| [`03-section-targeting-foundation.md`](plans/03-section-targeting-foundation.md) | Establish stable section identity and packet-visible wiki structure for bounded section updates. This is split from maintenance apply so the section strategy is resolved before write operations depend on it. | `01-quality-contract-and-diagnostics.md` | `05-maintain-mode-section-first-apply.md`, `06-project-memory-markdown-query.md` | Ready For Implementation |
| [`04-producer-boundary-and-packet-prioritization.md`](plans/04-producer-boundary-and-packet-prioritization.md) | Normalize and prioritize Project Memory leads across Session Memory, runtime inbox, handoffs, and future producer shapes without producer-specific lanes leaking into `project learn`. This is its own chunk because it is an intake/packet boundary, not markdown writing. | `01-quality-contract-and-diagnostics.md` | `05-maintain-mode-section-first-apply.md`, `07-dogfood-reset-and-validation.md` | Ready For Implementation |
| [`05-maintain-mode-section-first-apply.md`](plans/05-maintain-mode-section-first-apply.md) | Evolve maintain mode from entry-first operations to section-first documentation updates, explicit no-op/missing-coverage diagnostics, candidate disposition, validator checks, and bounded markdown apply. This follows chunks 03 and 04 because it depends on section identity and producer disposition inputs. | `01-quality-contract-and-diagnostics.md`, `03-section-targeting-foundation.md`, `04-producer-boundary-and-packet-prioritization.md` | `07-dogfood-reset-and-validation.md` | Ready For Implementation |
| [`06-project-memory-markdown-query.md`](plans/06-project-memory-markdown-query.md) | Add the Project Memory query layer that resolves derived SQLite/vector hits back to canonical markdown sections/pages and returns inline content or refs. This remains separate and late so Session Memory row retrieval and Project Memory markdown retrieval do not blur. | `03-section-targeting-foundation.md` | `07-dogfood-reset-and-validation.md` | Ready For Implementation |
| [`07-dogfood-reset-and-validation.md`](plans/07-dogfood-reset-and-validation.md) | Recreate and maintain the `llm-wiki` Project Memory using the new contract, then validate docs usefulness, retrieval readiness, Project Memory query behavior, and run diagnostics. This is last because it is the acceptance proof for the whole Step 4 shape. | `02-create-mode-documentation-contract.md`, `05-maintain-mode-section-first-apply.md`, `06-project-memory-markdown-query.md` | None | Ready For Implementation |

## Dependency Order

1. `01-quality-contract-and-diagnostics.md`
2. `02-create-mode-documentation-contract.md` and `03-section-targeting-foundation.md` can proceed after chunk 01, but should not be implemented in parallel by agents unless their shared quality result types are already stable.
3. `04-producer-boundary-and-packet-prioritization.md` can proceed after chunk 01 and can run before or alongside chunk 03 if packet shape conflicts are coordinated.
4. `05-maintain-mode-section-first-apply.md`
5. `06-project-memory-markdown-query.md`
6. `07-dogfood-reset-and-validation.md`

## Shared Contracts

- `ProjectMemoryCuratorOutput`, `ProjectMemoryCreationDraft`, `ProjectMemoryMaintenanceProposal`, and mode-specific output schemas must remain provider-facing structured-output contracts.
- Project Memory content quality and retrieval readiness are separate axes. `completed_with_pending_index` may only describe trusted content with pending/degraded retrieval readiness.
- Project Memory canonical truth remains `projects/<key>/wiki/*.md` plus project state. SQLite/vector rows are derived pointers.
- Memory Candidates and Layer Handoff Instructions remain leads. They require target-repo evidence exploration before Project Memory writes.
- Creation mode uses the six first-create roles from `spec.md` as the default contract: orientation index, product and memory model, runtime and command workflows, architecture and data flow, current work and roadmap state, and decision and terminology map.
- Maintenance mode is section-first. New pages are allowed only when no existing page owns the concept.
- `ProjectMemoryPacket` remains the curator input boundary and must expose enough wiki, pending input, session context, lookup, and quality metadata for bounded decisions.
- Query work must preserve distinct truth sources: Session Memory returns trusted SQLite rows; Project Memory returns canonical markdown content or references resolved from derived retrieval rows.

## Spec Coverage Map

| Spec Requirement | Covered By | Notes |
| --- | --- | --- |
| Replace page-count trust with role-based Project Memory documentation quality | `01-quality-contract-and-diagnostics.md`, `02-create-mode-documentation-contract.md` | Page count may remain a lower-level guard, not the publication bar. |
| Separate content quality from retrieval readiness | `01-quality-contract-and-diagnostics.md`, `02-create-mode-documentation-contract.md`, `05-maintain-mode-section-first-apply.md` | Prevents shallow content from becoming curated or pending-index. |
| Creation uses bounded hybrid repo orientation | `02-create-mode-documentation-contract.md` | Includes deterministic defaults plus justified curator-added surfaces. |
| Candidates are leads only and require durable repo evidence | `02-create-mode-documentation-contract.md`, `04-producer-boundary-and-packet-prioritization.md`, `05-maintain-mode-section-first-apply.md` | Applies to Session Memory, runtime inbox, and future producers. |
| Producers normalize into one Project Memory intake boundary | `04-producer-boundary-and-packet-prioritization.md` | Producer-specific collection may exist upstream, but not downstream in `project learn`. |
| Maintenance is section-first and improves existing docs | `03-section-targeting-foundation.md`, `05-maintain-mode-section-first-apply.md` | Section identity is planned before write behavior. |
| Missing coverage and explicit no-op diagnostics | `01-quality-contract-and-diagnostics.md`, `05-maintain-mode-section-first-apply.md` | Source terminal state depends on applied or supported no-op dispositions. |
| Project Memory query returns markdown content or refs from derived hits | `06-project-memory-markdown-query.md` | Answer synthesis remains out of scope. |
| Dogfood reset/recreate/review of `llm-wiki` Project Memory | `07-dogfood-reset-and-validation.md` | Final acceptance chunk after contract, maintenance, and query behavior exist. |

## Verification Strategy

Verification should stay repo-native and test-first where targeted test surfaces already exist.

- Contract/schema/validator chunks: focused `bun test` files under `tests/project/*curator*`, `tests/project/project-memory-markdown-applier.test.ts`, and `tests/project/project-memory-markdown-sections.test.ts`, followed by `bun run typecheck`.
- Producer/intake chunk: `tests/project/project-memory-candidate-intake-service.test.ts`, `tests/project/project-memory-packet.test.ts`, `tests/project/project-memory-source-consumption-reconciler.test.ts`, `tests/memory/memory-candidate-service.test.ts`, and `tests/memory/handoffs.test.ts`.
- Query chunk: `tests/query/memory-query-service.test.ts`, `tests/query/memory-quality-eval.test.ts`, `tests/memory/project-memory-retrieval-indexer.test.ts`, `tests/memory/project-memory-retrieval-storage.test.ts`, and `tests/memory/project-memory-retrieval-text.test.ts`.
- Full validation after approved chunks: `bun test`, `bun run typecheck`, and `git diff --check`.
- Dogfood validation: run `bun src/cli.ts project learn <project>` for the dogfood project, run `bun src/cli.ts memory index project <project>`, then run Project Memory query cases once chunk 06 provides the command shape. The dogfood chunk must record the exact project key and expected operator-visible diagnostics before execution.

## Risks And Sequencing Notes

- The biggest implementation risk is making quality diagnostics too subjective. Chunk 01 must define deterministic checks before creation or maintenance relies on them.
- Section-first maintenance must not become broad page rewriting. Chunk 03 must choose stable target identity before chunk 05 writes canonical markdown.
- Query work should not be used as proof that content is trusted. Query reads derived retrieval state; creation and maintenance quality gates own trust.
- The current shallow `projects/llm-wiki/wiki/` dogfood set is gap evidence, not a structure to preserve.
- The external audit is `Ready for Development`, so no re-audit is required before writing chunk plans unless this roadmap changes product behavior or drops a required design boundary.

## Execution Handoff

Recommended next skill after chunk plans are written: `$pmp-executing-plans`.

Execution should load:

- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/plan.md`
- selected chunk plans under `docs/design/2026-06-30-project-memory-shape-creation-maintenance/plans/`
- all source artifacts listed in this file

Recommended execution modes:

- execute one chunk;
- execute selected chunks;
- execute all chunks in dependency order.

Execution must stop on unclear plan steps, failed verification, code/spec conflict, missing dependencies, or user-requested changes.

## User Approval

Roadmap approved for chunk creation by the user. Chunk plan files have been created under `plans/` and are ready for review or execution planning.
