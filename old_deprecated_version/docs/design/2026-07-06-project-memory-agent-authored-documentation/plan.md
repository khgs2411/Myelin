# Project Memory Agent-Authored Documentation Implementation Plan Set

**Spec:** `spec.md`
**Agenda:** `agenda.md`
**Pseudocode:** Absent
**Context:** Not available; explicitly not used by this design slice
**ADRs:** `docs/adr/0067-use-agent-authored-project-memory-documentation.md`
**Status:** Ready for Development

## Goal

Implement agent-authored Project Memory documentation for `project learn`: first curated Project Memory uses a planner/index agent plus bounded parallel subject writer agents to create a draft wiki, then runs candidate-guided maintenance before promotion; later ordinary runs use maintenance only. The implementation must remove schema-shaped documentation quality gates while preserving write safety, artifact auditability, candidate lifecycle, state metadata, journal-backed promotion, and derived retrieval indexing.

## Source Artifacts

- `docs/design/2026-07-06-project-memory-agent-authored-documentation/spec.md`
- `docs/design/2026-07-06-project-memory-agent-authored-documentation/agenda.md`
- `docs/adr/0067-use-agent-authored-project-memory-documentation.md`
- `docs/adr/0021-keep-curated-project-memory-in-markdown.md`
- `docs/adr/0060-use-apply-journal-for-project-memory-writes.md`
- `docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`
- `docs/adr/0066-allow-clean-project-shell-rebootstrap-reset.md`
- External design audit by Software Architect sub-agent `019f3706-b0a5-7541-b4ca-44f87d8f8249`: first verdict `Needs Refinement`, second verdict `Ready for Development`.

Code paths inspected:

- `src/commands/project.ts`
- `src/project/project-service.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-markdown-applier.ts`
- `src/project/project-memory-quality-contract.ts`
- `src/runtime/llm-client.ts`
- `src/runtime/project-run-infrastructure.ts`
- `src/memory/project-memory-retrieval-index-service.ts`
- `tests/runtime/llm-client.test.ts`
- `tests/project/project-memory-curator-service.test.ts`
- `tests/project/project-memory-markdown-applier.test.ts`
- `tests/project/project-memory-quality-contract.test.ts`
- `tests/commands/project.test.ts`

Validation commands discovered:

- `bun test`
- `bun run typecheck`
- `make learn PROJECT=<key> ARGS="--json"`
- `make query PROJECT=<key> QUESTION="..." ARGS="--json"`

## Design Readiness Check

- Source artifact paths verified: Pass.
- Pseudocode artifacts: Absent. Planning impact: none; file/flow shape comes from spec, agenda, ADR 0067, and current code.
- Pseudocode alignment: Not applicable.
- Missing or unavailable artifacts: local `CONTEXT.md`, pseudocode, and child specs are absent and explicitly marked unavailable in `spec.md`; planning impact is none.
- Open agenda questions or risks: no open agenda questions. Non-blocking risks are recorded below with owning chunks.
- Spec / agenda / context / ADR consistency: Pass after ADR 0067. ADR 0067 supersedes structured create/apply/validation behavior from ADR 0059, ADR 0063, ADR 0064, and ADR 0065, and partially supersedes ADR 0058.
- Parent / child spec consistency: Not applicable.
- Accepted planning reconciliations: JSON-only `invokeLlm` remains for read-only structured stages; agent-authored documentation uses the new file-authoring runner with a run-local writable workspace and target-repo snapshot.
- Blockers: None.

## Unresolved Decision Ownership

| Item | Type | Owning Chunk | Must Resolve Before | Notes |
| --- | --- | --- | --- | --- |
| File-authoring runner target-repo access | Reconciliation | `02-file-authoring-runner.md` | Implementation steps in owning chunk | Use a run-local target repo snapshot for reads and explicit output roots for writes. |
| New candidate disposition enum migration | Shared contract | `01-contracts-state-and-cli-surface.md` | Implementation steps in owning chunk | Existing `already_trusted` must be readable as `already_covered`; `blocked_by_quality` is not part of the new report contract. |
| New `project-memory.json` v2 state fields | Shared contract | `01-contracts-state-and-cli-surface.md` | Implementation steps in owning chunk | Preserve compatibility summary fields only where needed. |
| Runner write sandbox and output-root enforcement | Security / data integrity | `02-file-authoring-runner.md` | Implementation steps in owning chunk | Must be resolved before create or maintenance orchestration. |
| Two-layer create without synthesis may fragment docs | Non-blocking risk | `08-live-dogfood-and-acceptance.md` | Dogfood acceptance | Accepted product decision; add synthesis later only with evidence. |
| `--recreate` overlap with clean reset behavior | Reconciliation | `06-project-learn-composition-and-recreate.md` | Implementation steps in owning chunk | Explicit `project learn <key> --recreate` must remain opt-in and visible. |

## Approved Chunks

| Chunk | Purpose | Depends On | Enables | Status |
| --- | --- | --- | --- | --- |
| `plans/01-contracts-state-and-cli-surface.md` | Define shared TypeScript contracts for agent-authored state, subject manifests, subject reports, maintenance dispositions, run artifacts, result fields, and `--recreate` CLI parsing. | None | `02`, `03`, `04`, `05`, `06` | Written |
| `plans/02-file-authoring-runner.md` | Build the new file-authoring runner and deterministic fixture path separate from JSON-only `invokeLlm`, including writable run-local cwd, allowed output roots, provider/stub metadata, and path-escape failure behavior. | `01` | `04`, `05` | Written |
| `plans/03-draft-wiki-promotion.md` | Add filesystem draft-wiki promotion helpers that stage generated markdown/state writes through the existing apply journal, including v2 `project-memory.json` writing and destructive-change guards. | `01` | `04`, `05`, `06`, `07` | Written |
| `plans/04-agent-authored-create-mode.md` | Replace first-create JSON curator generation with planner/index plus bounded parallel subject writer orchestration, manifest validation, retries, reports, and `pre-maintenance-wiki/` snapshot artifacts. | `01`, `02`, `03` | `06`, `08` | Written |
| `plans/05-agent-authored-maintenance-mode.md` | Implement single-agent candidate-guided maintenance against an existing draft/canonical wiki, with direct markdown updates, disposition report reconciliation, candidate lifecycle updates, and index changes. | `01`, `02`, `03` | `06`, `08` | Written |
| `plans/06-project-learn-composition-and-recreate.md` | Compose first-run create plus maintenance before promotion, later maintenance-only runs, candidate-specific maintenance failure fallback, CLI `--recreate`, and human/JSON result output updates. | `04`, `05` | `07`, `08` | Written |
| `plans/07-retrieval-and-legacy-curator-cleanup.md` | Reconnect post-promotion retrieval indexing to promoted markdown, remove or bypass obsolete create validation/usefulness/evidence-map gates, and update old tests/contracts to the new path. | `06` | `08` | Written |
| `plans/08-live-dogfood-and-acceptance.md` | Run the redesigned flow on `llm-wiki` with a live provider, verify documentation usefulness through representative queries, and capture acceptance artifacts without schema-quality gates. | `07` | None | Written |

## Dependency Order

1. `plans/01-contracts-state-and-cli-surface.md`
2. `plans/02-file-authoring-runner.md`
3. `plans/03-draft-wiki-promotion.md`
4. `plans/04-agent-authored-create-mode.md`
5. `plans/05-agent-authored-maintenance-mode.md`
6. `plans/06-project-learn-composition-and-recreate.md`
7. `plans/07-retrieval-and-legacy-curator-cleanup.md`
8. `plans/08-live-dogfood-and-acceptance.md`

Chunks `02` and `03` can be developed after `01` with limited overlap if their file ownership stays separate. Chunks `04` and `05` both depend on `01` through `03`; they may proceed in parallel only after the runner and promotion contracts are stable.

## Shared Contracts

- File-authoring runner contract: run-local writable agent workspace, explicit allowed output roots, filesystem output discovery, provider/model/sandbox/cwd artifact metadata, no canonical writes by agents.
- Project Memory state v2: `schema_version`, `status`, `provider_mode`, `curation_kind`, `run_kind`, `create`, `maintenance`, `retrieval_readiness`, compatibility `content_quality`.
- Subject manifest contract: subject id, draft wiki path, title, purpose, suggested repo areas; no section schemas or coverage scores.
- Subject report contract: subject id, assigned path, status, touched path, evidence paths inspected, known gaps.
- Maintenance disposition contract: `applied_to_project_memory`, `already_covered`, `insufficient_evidence`, `not_durable`, `belongs_to_other_layer`, `deferred_unsafe_change`, `blocked_by_runner_failure`.
- Default subject writer concurrency: `4`, bounded by override validation.
- Default subject writer retry count: one retry after initial mechanical failure.
- Explicit recreate surface: `myelin project learn <key> --recreate`.
- Promotion contract: existing journal-backed staged writes remain the only path to canonical `projects/<key>/wiki/` and `projects/<key>/state/`.
- Retrieval contract: derived from promoted markdown; pending index remains reportable as `completed_with_pending_index`.

## Spec Coverage Map

| Spec Requirement | Covered By | Notes |
| --- | --- | --- |
| New file-authoring runner separate from JSON-only `invokeLlm` | `02-file-authoring-runner.md` | Includes stub/test mode and artifact metadata. |
| Planner owns documentation shape and writes subject manifest/placeholders | `04-agent-authored-create-mode.md` | Depends on manifest contract from `01`. |
| Per-subject writers run with bounded parallelism and one retry | `04-agent-authored-create-mode.md` | Depends on runner from `02`. |
| No final synthesis agent by default | `04-agent-authored-create-mode.md`, `08-live-dogfood-and-acceptance.md` | Dogfood validates accepted risk. |
| Maintenance is one candidate-guided agent | `05-agent-authored-maintenance-mode.md` | Includes direct markdown updates and index updates. |
| Candidate disposition report drives lifecycle | `01-contracts-state-and-cli-surface.md`, `05-agent-authored-maintenance-mode.md` | Includes enum migration. |
| First run is create plus maintenance before promotion | `06-project-learn-composition-and-recreate.md` | Includes candidate-specific fallback. |
| Later runs are maintenance-only | `06-project-learn-composition-and-recreate.md` | Uses curated state check. |
| Explicit recreate only | `01-contracts-state-and-cli-surface.md`, `06-project-learn-composition-and-recreate.md` | CLI parser and orchestration. |
| Remove schema/content-quality gates | `07-retrieval-and-legacy-curator-cleanup.md` | Must not reintroduce section/body/citation scoring. |
| Journal-backed canonical promotion | `03-draft-wiki-promotion.md` | Preserves ADR 0060. |
| Retrieval indexing derives from promoted markdown | `07-retrieval-and-legacy-curator-cleanup.md` | Preserves ADR 0062. |
| Live dogfood acceptance on `llm-wiki` | `08-live-dogfood-and-acceptance.md` | Product usefulness and query answerability, not schema validity. |

## Verification Strategy

Verification is test-first where existing tests already cover the touched surface.

- Contract and runner chunks should add focused Bun tests under `tests/runtime/` and `tests/project/`, then run targeted `bun test <test-file>`.
- CLI changes should update `tests/commands/project.test.ts`.
- Orchestration changes should update or replace `tests/project/project-memory-curator-service.test.ts` with agent-authored create/maintenance expectations.
- Promotion changes should update `tests/project/project-memory-markdown-applier.test.ts` or introduce a filesystem draft promotion test.
- Retrieval integration should run targeted memory/project retrieval tests plus `bun run typecheck`.
- Final verification before dogfood should run `bun test` and `bun run typecheck`.
- Live dogfood should run `make learn PROJECT=llm-wiki ARGS="--json"` with a live provider profile and then representative `make query PROJECT=llm-wiki QUESTION="..." ARGS="--json"` checks.

## Risks And Sequencing Notes

- The file-authoring runner is the highest-risk foundation. It must land before create/maintenance orchestration so later chunks do not invent security behavior.
- Existing tests assert curator JSON artifacts, usefulness critique, and answer-domain validation. The cleanup chunk must deliberately replace these expectations rather than preserve compatibility that contradicts ADR 0067.
- The `project-memory-quality-contract.ts` constants currently encode old answer-domain and candidate disposition vocabulary. The first chunk must decide whether to replace or isolate these exports before later chunks depend on them.
- The roadmap audit found additional enum consumers in `src/project/project-memory-apply-contracts.ts` and `src/project/project-memory-source-consumption-reconciler.ts`; chunk `01` must carry the disposition migration through those sites, not only `project-memory-quality-contract.ts`.
- `ProjectMemoryMarkdownApplier` currently combines structured rendering and journal promotion. The promotion chunk should preserve journal behavior while separating it from structured page payload rendering.
- Chunk `04` may need to split planner/manifest orchestration from writer-pool execution during chunk-plan generation if the detailed executor plan becomes too broad.
- Live dogfood may expose documentation fragmentation from the no-synthesis decision. That is accepted as a product risk for dogfood, not a reason to add a third agent layer during implementation planning.
- The current worktree is dirty and the design files are untracked. Execution agents must not treat unrelated dirty files as disposable.

## Roadmap Audit

- Auditor: Senior Project Manager sub-agent `019f3712-28c3-7df1-8bfa-a91803a6e569`.
- Verdict: Ready for Development, interpreted as ready for user approval and chunk-plan generation.
- Critical issues: none.
- Recommendations carried into chunk generation:
  - Keep `04-agent-authored-create-mode.md` tightly scoped; split planner/manifest from writer-pool execution if needed for executor readiness.
  - In chunk `01`, migrate disposition vocabulary through `project-memory-quality-contract.ts`, `project-memory-apply-contracts.ts`, and `project-memory-source-consumption-reconciler.ts`.
  - In chunk `02`, make runner safety tests mandatory for allowed output roots, path escapes, run-local cwd, provider/stub metadata, and filesystem output discovery.
  - In chunk `07`, deliberately delete or isolate old content-quality gates such as trusted quality diagnostics in `ProjectMemoryMarkdownApplier.applyCreationDraft`.

## Full Plan-Set Audit

- Auditor: Software Architect sub-agent `019f3706-b0a5-7541-b4ca-44f87d8f8249`.
- Verdict: Ready for Development, interpreted as ready for `$pmp-executing-plans`.
- Critical issues: none.
- Non-blocking recommendation addressed after final audit:
  - Updated stale audit/status wording in `plan.md` and `agenda.md`.

## Execution Handoff

Recommended next skill after chunk plans are approved and audited: `$pmp-executing-plans`.

Execution should load:

- `docs/design/2026-07-06-project-memory-agent-authored-documentation/plan.md`
- the selected `plans/NN-*.md` chunk files after they exist
- `spec.md`
- `agenda.md`
- `docs/adr/0067-use-agent-authored-project-memory-documentation.md`
- the code paths listed in Source Artifacts

Execution must stop on unclear plan steps, failed verification, code/spec conflict, missing dependencies, or user-requested changes.

## User Approval

The user approved chunk-plan generation after the Senior Project Manager roadmap audit returned `Ready for Development`.
