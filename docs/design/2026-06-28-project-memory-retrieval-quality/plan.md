# Project Memory Retrieval Quality Implementation Plan Set

**Spec:** `spec.md`  
**Agenda:** `agenda.md`  
**Pseudocode:** `pseudocode/` loaded and used as strong shaping artifacts  
**Context:** `../../../CONTEXT.md` loaded  
**ADRs:** `0021`, `0057`, `0058`, `0059`, `0060`, `0061`, `0062`  
**Status:** Ready For Execution

## Goal

Implement Step 3.5 Project Memory retrieval quality so `project learn <key>` can look up existing Project Memory through markdown-backed section retrieval, distinguish fallback lookup quality from unsafe packet state, apply scoped evidence-aware gating, and derive queryable retrieval state from canonical wiki markdown without making SQLite/vector rows canonical memory.

## Source Artifacts

Design artifacts:

- `docs/design/2026-06-28-project-memory-retrieval-quality/spec.md`
- `docs/design/2026-06-28-project-memory-retrieval-quality/agenda.md`
- `docs/design/2026-06-28-project-memory-retrieval-quality/pseudocode/README.md`
- `docs/design/2026-06-28-project-memory-retrieval-quality/pseudocode/ProjectMemoryRetrievalContracts.ts`
- `docs/design/2026-06-28-project-memory-retrieval-quality/pseudocode/ProjectMemoryMarkdownSections.ts`
- `docs/design/2026-06-28-project-memory-retrieval-quality/pseudocode/ProjectMemoryRetrievalStateFiles.md`
- `docs/design/2026-06-28-project-memory-retrieval-quality/pseudocode/ProjectMemoryHintGenerationFlow.md`
- `docs/design/2026-06-28-project-memory-retrieval-quality/pseudocode/ProjectMemoryRetrievalStorage.ts`
- `docs/design/2026-06-28-project-memory-retrieval-quality/pseudocode/ProjectMemoryRetrievalIndexerFlow.md`
- `docs/design/2026-06-28-project-memory-retrieval-quality/pseudocode/ProjectMemoryLookupIntegration.ts`
- `docs/design/2026-06-28-project-memory-retrieval-quality/pseudocode/ProjectMemoryCuratorEvidenceContract.md`
- `docs/design/2026-06-28-project-memory-retrieval-quality/pseudocode/RetrievalMaintenanceQueue.ts`
- `docs/design/2026-06-28-project-memory-retrieval-quality/pseudocode/ProjectLearnRetrievalLifecycle.md`
- `CONTEXT.md`
- `docs/ROADMAP.md`
- `MYELIN.md`

Decision records:

- `docs/adr/0021-keep-curated-project-memory-in-markdown.md`
- `docs/adr/0057-vendor-sqlite-runtime-for-vector-extensions.md`
- `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`
- `docs/adr/0059-use-structured-project-memory-apply-payloads.md`
- `docs/adr/0060-use-apply-journal-for-project-memory-writes.md`
- `docs/adr/0061-use-layer-shaped-runtime-inbox-with-implemented-consumers.md`
- `docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`

Code paths inspected:

- `src/project/project-memory-lookup.ts`
- `src/project/project-memory-packet.ts`
- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-validator.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-markdown-applier.ts`
- `src/project/project-memory-prompt-budget.ts`
- `src/project/project-memory-candidate-intake-service.ts`
- `src/memory/db.ts`
- `src/memory/migrations.ts`
- `src/memory/session-memory-embeddings.ts`
- `src/memory/session-memory-indexer.ts`
- `src/memory/session-memory-query.ts`
- `src/memory/embedding-provider.ts`
- `src/memory/sqlite-vec.ts`
- `src/commands/memory.ts`

Tests and verification surfaces inspected:

- `tests/project/project-memory-packet.test.ts`
- `tests/project/project-memory-curator-validator.test.ts`
- `tests/project/project-memory-curator-service.test.ts`
- `tests/project/project-memory-prompt-budget.test.ts`
- `tests/project/project-service.test.ts`
- `tests/commands/project.test.ts`
- `tests/commands/memory.test.ts`
- `tests/memory/session-memory-embeddings.test.ts`
- `tests/memory/session-memory-indexer.test.ts`
- `tests/memory/session-memory-query.test.ts`
- `tests/memory/sqlite-vec.test.ts`
- `package.json`

Discovered repo-native verification commands:

- `rtk bun test <targeted test files>`
- `rtk bun test`
- `rtk bun run typecheck`
- `rtk bun src/cli.ts project learn llm-wiki --json` for final dogfood, with provider/stub setup recorded by the executing chunk.

## Design Readiness Check

- Source artifact paths verified: Pass. All listed spec, agenda, pseudocode, context, roadmap, MYELIN, and ADR paths were read or listed successfully.
- Pseudocode artifacts: Loaded. Source-like `.ts` files contain the standard non-executable pseudocode header. Markdown flow/boundary artifacts contain the same non-executable statement after the title. `README.md` is an index, not a source-like artifact.
- Pseudocode alignment: Pass. Proposed chunks preserve the pseudocode-defined contracts, section extraction, state-file ownership, storage/indexing, lookup integration, evidence contract, retrieval-maintenance queue, and lifecycle boundaries.
- Missing or unavailable artifacts: None.
- Open agenda questions or risks: No behavior-changing open agenda questions remain. Non-blocking implementation choices are assigned below.
- Spec / agenda / context / ADR consistency: Pass. All agree that markdown is canonical, SQLite/vector state is derived, fallback-dependent maintenance writes require review, hint generation is separate from the curator, and retrieval maintenance is not a Project Memory candidate path.
- Parent / child spec consistency: Not applicable. No child specs are present.
- Accepted planning reconciliations: Exact table names, command names, provider profile names, and whether the first status surface is read-only are implementation naming choices. They do not change approved product behavior and are assigned to owning chunks below.
- Blockers: None.

Roadmap audit:

- External audit agent: `019f0ef4-4d91-74d1-91f6-b932495d4de3`
- Result: Ready for Development, interpreted as roadmap ready for user approval and chunk-plan generation.
- User approval: Approved by "proceed" after audit result.

Full plan-set audit:

- External audit agent: `019f0ee3-d070-76c1-ab5a-e0439b61e849`
- First result: Needs Refinement. Required fixes were chunk-local repo-root path correction and creation-mode explicit no-op coverage.
- Refinements applied: chunk source artifact paths now resolve from `plans/`; `explicit_noop_decisions` belongs to the common curator envelope; chunk 07 covers creation and maintenance fallback no-op tests.
- Re-audit result: Ready for Development, interpreted as ready for `$pmp-executing-plans`.

## Unresolved Decision Ownership

| Item | Type | Owning Chunk | Must Resolve Before | Notes |
| --- | --- | --- | --- | --- |
| Exact SQLite table and vector table names | Naming | `03-retrieval-storage-and-vector-state.md` | Implementation steps in owning chunk | Names must clearly separate Project Memory retrieval state from Session Memory tables. |
| Exact CLI command for Project Memory retrieval indexing/status | Naming | `05-indexer-and-status-command.md` | Implementation steps in owning chunk | Must fit V2 vocabulary and avoid reintroducing V1 command names. |
| Hint-generation provider/profile configuration | Deferred implementation decision | `08-hint-generation-flow.md` | Implementation steps in owning chunk | Must reuse existing provider abstraction patterns and keep the Project Memory curator out of hint authoring. |
| First implementation may expose queue/status before full queue processing | Non-blocking risk | `04-retrieval-maintenance-queue.md` | Implementation steps in owning chunk | Queue ownership must remain separate from Project Memory candidates either way. |
| Final dogfood environment and provider/stub setup | Verification decision | `09-project-learn-lifecycle-and-dogfood.md` | Verification in owning chunk | Must prove the latest degraded-fallback dogfood path no longer stops solely because fallback lookup exists. |

## Approved Chunks

| Chunk | Purpose | Category | Depends On | Enables | Status |
| --- | --- | --- | --- | --- | --- |
| `plans/01-retrieval-contracts-and-run-status.md` | Add shared Project Memory retrieval vocabulary, quality summary shape, explicit evidence/no-op types, and `completed_with_pending_index` result vocabulary while preserving compatibility fields. Boundary exists because every later chunk depends on these contracts. | Contracts | None | `02`, `03`, `06`, `07`, `09` | Ready |
| `plans/02-markdown-section-manifest.md` | Implement deterministic markdown page/section extraction plus project-local `state/project-memory-retrieval/sections.json` and hint-status validation helpers. Boundary exists because canonical section refs and hashes must be stable before storage or lookup can trust them. | Deterministic state | `01` | `03`, `05`, `06`, `08` | Ready |
| `plans/03-retrieval-storage-and-vector-state.md` | Add Project Memory retrieval SQLite metadata tables, vector adapter support, row id/hash semantics, and storage tests. Boundary exists because storage must be testable before indexing and lookup rely on it. | Storage | `01`, `02` | `05`, `06`, `09` | Ready |
| `plans/04-retrieval-maintenance-queue.md` | Add the dedicated retrieval-maintenance queue schema/service for hint refresh, index repair, and poor-retrieval feedback without creating Project Memory candidates. Boundary exists to keep serving-state repair separate from canonical memory curation. | Storage/service | `03` | `08`, `09` | Ready |
| `plans/05-indexer-and-status-command.md` | Build the deterministic Project Memory retrieval indexer over sections plus valid hints, including embedding/index status output and a repo-native operator command. Boundary exists because index creation and status must be verifiable before packet lookup switches to it. | Indexing | `02`, `03`, `04` | `06`, `09` | Ready |
| `plans/06-lookup-and-packet-quality.md` | Replace the current page-only lookup degradation path with indexed section lookup, markdown fallback quality metadata, packet lookup quality summary, and compatibility degraded fields. Boundary exists because this changes packet construction but not curator validation/apply rules yet. | Packet/retrieval | `01`, `02`, `03`, `05` | `07`, `09` | Ready |
| `plans/07-curator-evidence-and-scoped-gating.md` | Extend curator contracts/prompts and validator behavior for evidence dependencies, explicit no-op decisions, fallback no-op completion, and scoped apply gating. Boundary exists because canonical write authorization must be reviewed independently from storage/indexing. | Validation/apply gate | `01`, `06` | `09` | Ready |
| `plans/08-hint-generation-flow.md` | Implement separate model-backed hint generation over completed markdown/structural metadata, with run artifacts, SQLite job/status rows, conservative replacement policy, and maintenance queue integration. Boundary exists because this is the only agentic retrieval-serving-state flow and must not leak into curator ownership. | Provider flow | `02`, `03`, `04`, `05` | `09` | Ready |
| `plans/09-project-learn-lifecycle-and-dogfood.md` | Integrate post-apply indexing/hint-generation status into `project learn`, surface `completed_with_pending_index`, update CLI/reporting/tests, and rerun the dogfood scenario. Boundary exists because it composes all prior chunks into the product loop and final verification. | Integration/dogfood | `05`, `06`, `07`, `08` | Next roadmap item | Ready |

## Dependency Order

Recommended implementation order:

1. `01-retrieval-contracts-and-run-status.md`
2. `02-markdown-section-manifest.md`
3. `03-retrieval-storage-and-vector-state.md`
4. `04-retrieval-maintenance-queue.md`
5. `05-indexer-and-status-command.md`
6. `06-lookup-and-packet-quality.md`
7. `07-curator-evidence-and-scoped-gating.md`
8. `08-hint-generation-flow.md`
9. `09-project-learn-lifecycle-and-dogfood.md`

Possible parallel work after chunk 3:

- `04-retrieval-maintenance-queue.md` can proceed in parallel with parts of `05-indexer-and-status-command.md` if the queue table names are agreed first.
- `08-hint-generation-flow.md` can start after chunks 2 through 5 define sections, state files, storage, and indexer result contracts; it does not need chunk 6 or 7 except for final service integration.

Do not run chunk 9 before chunks 6, 7, and 8 are complete, because lifecycle status and dogfood behavior depend on lookup quality, scoped gating, and post-write indexing/hint generation.

## Shared Contracts

- `ProjectMemoryRetrievalMethod`, `ProjectMemoryLookupQuality`, `ProjectMemoryLookupFreshness`, and `ProjectMemoryApplySeverity` define lookup quality and gating vocabulary.
- `ProjectMemoryCanonicalSectionRef` is the cross-chunk pointer back to canonical markdown. It must include project key, wiki path, category, page title, section id, heading path, and section hash.
- `ProjectMemoryLookupResult` and `ProjectMemoryLookupQualitySummary` are produced by lookup/packet construction and consumed by validator/apply gating.
- `ProjectMemoryEvidenceDependency` links curator proposals or explicit no-op decisions to lookup results, canonical sections, candidates, handoffs, Session Memory, or repo citations.
- `ExplicitNoOpDecision` is required for any non-empty fallback-lookup packet with zero write proposals to complete as no-op.
- `ProjectMemorySectionManifest`, `sections.json`, `hints/<category>.json`, and `hint-status.json` are project-local derived state. They never become canonical Project Memory.
- Project Memory retrieval SQLite rows and vector rows are rebuildable serving state under root `state/memory.db`.
- Retrieval maintenance queue rows are serving-state work items, not `memory_candidates`.
- `completed_with_pending_index` means canonical markdown/state writes succeeded but required hint generation, embedding, or index refresh remains pending, failed, or queued.
- Packet-level `degraded` and `degraded_reasons` may remain compatibility fields, but fallback markdown lookup alone must not be the only packet-wide apply blocker.

## Spec Coverage Map

| Spec Requirement | Covered By | Notes |
| --- | --- | --- |
| Keep Project Memory markdown canonical and SQLite/vector rows derived | `02`, `03`, `05`, `09` | Section refs hydrate from markdown; storage/indexer rows remain rebuildable. |
| Distinguish fallback lookup quality from unsafe packet state | `01`, `06`, `07` | Quality summary replaces packet-wide fallback degradation as sole gate. |
| Use section-level retrieval rather than whole-page-only lookup | `02`, `03`, `05`, `06` | Section ids/hashes are the canonical retrieval unit. |
| Store hints outside `wiki/` under state-side hierarchy | `02`, `08` | `hints/<category>.json` and `hint-status.json` live under `state/project-memory-retrieval/`. |
| Make hint generation separate from Project Memory curator | `08`, `09` | Hint flow runs after markdown/structural metadata exists. |
| Mandatory hints for new entries/pages, optional refresh for valid existing hints | `05`, `08`, `09` | Indexer and lifecycle status must show missing mandatory hints. |
| Structural freshness, embedding freshness, usage-driven semantic usefulness | `02`, `03`, `04`, `05`, `08` | Structural/hash checks are deterministic; usage feedback goes to the queue. |
| Dedicated retrieval-maintenance queue | `04`, `08` | Queue does not create Project Memory candidates. |
| Curator proposal evidence dependencies | `01`, `07` | Validator gates by declared dependency graph. |
| Fallback no-op requires explicit no-op decision | `01`, `06`, `07`, `09` | Applies to non-empty creation and maintenance packets. |
| Maintenance fallback-dependent writes require review | `07`, `09` | Creation fallback remains allowed as bootstrap context with direct evidence. |
| Dogfood no longer stops solely because markdown fallback exists | `06`, `07`, `09` | Final verification owns latest `llm-wiki` scenario. |

## Verification Strategy

Use focused Bun tests per chunk, then typecheck and broader suite near integration:

- Contract/validator/packet chunks: `rtk bun test tests/project/project-memory-curator-contracts.test.ts tests/project/project-memory-curator-validator.test.ts tests/project/project-memory-packet.test.ts`
- Storage/indexing chunks: `rtk bun test tests/memory/session-memory-embeddings.test.ts tests/memory/session-memory-indexer.test.ts tests/memory/sqlite-vec.test.ts` plus new Project Memory retrieval storage/indexer tests.
- Service/CLI chunks: `rtk bun test tests/project/project-memory-curator-service.test.ts tests/project/project-service.test.ts tests/commands/project.test.ts tests/commands/memory.test.ts`
- Final checks: `rtk bun run typecheck` and `rtk bun test`
- Dogfood: `rtk bun src/cli.ts project learn llm-wiki --json`, with the chunk plan specifying whether it uses live provider credentials, stubs, or dry-run/review mode.

Each chunk plan should use test-first edits when modifying existing behavior captured by current tests, especially packet degradation, validator quarantine, service status, and CLI output.

## Risks And Sequencing Notes

- Lifecycle/status drift is the highest sequencing risk. `completed_with_pending_index` touches result types, service output, run artifacts, summaries, CLI messages, and dogfood expectations, so chunk 1 should introduce vocabulary and chunk 9 should integrate behavior.
- Existing tests intentionally assert old packet-wide degraded behavior. Chunks 6 and 7 must rewrite those tests around typed lookup quality and scoped gating rather than deleting safety coverage.
- Storage and vector indexing can be implemented before hint generation by indexing deterministic section text and treating missing mandatory hints as pending/degraded status.
- The hint-generation provider flow is agentic and should stay separate from the Project Memory curator. If provider invocation is too large for one slice, chunk 8 may land the job/status/run-artifact contract before full automated processing, but must not collapse hints into curator output.
- `project learn` should not roll back successful canonical markdown/state writes just because post-write retrieval indexing fails; chunk 9 must surface that as `completed_with_pending_index`.
- The worktree contains other modified/untracked files outside this planning artifact. Executors must inspect their target files before editing and must not revert unrelated work.

## Execution Handoff

Recommended next skill: `$pmp-executing-plans`.

Execution should load:

- `docs/design/2026-06-28-project-memory-retrieval-quality/plan.md`
- selected files under `docs/design/2026-06-28-project-memory-retrieval-quality/plans/` after chunk files are generated
- source artifacts listed in this roadmap
- current code and tests for the selected chunk

Recommended execution modes:

- execute one chunk for contract/status foundation first;
- execute selected chunks in dependency order when dependencies are already complete;
- execute all chunks only after the full plan set is written and reviewed.

Execution must stop on unclear plan steps, failed verification, code/spec conflict, missing dependencies, or user-requested changes.

## User Approval

Approved. Chunk plan files have been generated under `plans/`.
