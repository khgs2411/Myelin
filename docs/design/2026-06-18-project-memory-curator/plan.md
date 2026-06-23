# Project Memory Curator Pre-Write Gate Implementation Plan Set

**Spec:** `spec.md`
**Agenda:** `agenda.md`
**Pseudocode:** `pseudocode/` loaded and used as strong shape guidance
**Context:** `CONTEXT.md` loaded
**ADRs:** `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`
**Status:** Chunk Plans Written

## Goal

Implement the first behavior-focused `project learn` slice: `project learn <key>` becomes the authoritative Project Memory curator command, builds a bounded Project Memory packet, invokes a mode-scoped curator contract, validates curator output deterministically, writes curator-specific pre-write artifacts, and stops before wiki mutation. The plan also removes separate Project Memory `project ingest` from the target command surface, deprecates `src/pipeline/runner.ts` early as legacy scaffolding for Project Memory, and deletes it late after replacement behavior and command cutover are in place.

## Source Artifacts

- `docs/design/2026-06-18-project-memory-curator/spec.md`
- `docs/design/2026-06-18-project-memory-curator/agenda.md`
- `docs/design/2026-06-18-project-memory-curator/pseudocode/README.md`
- `docs/design/2026-06-18-project-memory-curator/pseudocode/ProjectLearnCuratorFlow.md`
- `docs/design/2026-06-18-project-memory-curator/pseudocode/ProjectRunInfrastructureBoundary.md`
- `docs/design/2026-06-18-project-memory-curator/pseudocode/src/project/project-memory-curator-contracts.ts`
- `docs/design/2026-06-18-project-memory-curator/pseudocode/src/project/project-memory-curator-validator.ts`
- `docs/design/2026-06-18-project-memory-curator/pseudocode/src/project/project-memory-curator-service.ts`
- `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`
- `CONTEXT.md`

Code paths inspected:

- `src/commands/project.ts`
- `src/commands/ingest.ts`
- `src/commands/registry.ts`
- `src/cli.ts`
- `src/project/project-service.ts`
- `src/project/project-memory-packet.ts`
- `src/project/project-memory-lookup.ts`
- `src/pipeline/runner.ts`
- `src/runtime/artifacts.ts`
- `src/runtime/json.ts`
- `src/runtime/llm-client.ts`
- `src/runtime/project-shell.ts`
- `src/schema/compiler.ts`
- `Makefile`
- `package.json`

Tests inspected:

- `tests/commands/project.test.ts`
- `tests/commands/ingest.test.ts`
- `tests/project/project-memory-packet.test.ts`
- `tests/project/project-service.test.ts`
- `tests/pipeline/runner.test.ts`
- `tests/runtime/llm-client.test.ts`

Discovered verification commands:

- `bun test`
- `bun test tests/project/project-memory-packet.test.ts`
- `bun test tests/project/project-service.test.ts`
- `bun test tests/commands/project.test.ts`
- `bun test tests/commands/ingest.test.ts`
- `bun run typecheck`
- `git diff --check`

## Design Readiness Check

- Source artifact paths verified: Pass.
- Pseudocode artifacts: Loaded. All source-like pseudocode artifacts include the standard non-executable reference header.
- Pseudocode alignment: Pass. Proposed chunks preserve the `ProjectMemoryCuratorService`, separate curator contracts, validator boundary, `ProjectLearnCuratorFlow`, and `ProjectRunInfrastructureBoundary`.
- Missing or unavailable artifacts: None.
- Open agenda questions or risks: No blocking questions remain. Field-level schemas, creation-vs-maintenance validation strictness, and runner-mechanics extraction are implementation-level shaping items assigned below.
- Spec / agenda / context / ADR consistency: Pass. All agree that `project learn` is authoritative, `project ingest` is not a target Project Memory command, and `src/pipeline/runner.ts` is not the future Project Memory boundary.
- Parent / child spec consistency: Not applicable; no child spec exists.
- Accepted planning reconciliations:
  - The spec status line says "Final design for review. Not approved for implementation planning yet." The user's current instruction approves proceeding with `$pmp-writing-plans`, so planning can proceed without changing product behavior.
  - `src/schema/compiler.ts` still lists `project ingest` in generated schema context. This is current-code drift from the revised design, not a design conflict; Chunk 05 owns vocabulary cleanup.
  - `Makefile` still maps `make ingest` to `myelin project ingest`. This is current-code drift from the revised design, not a design conflict; Chunk 05 owns alias cleanup.
  - Runner sequencing is explicit: Chunk 03 deprecates `src/pipeline/runner.ts` as a Project Memory boundary and creates replacement mechanical run support, while Chunk 06 owns deletion only after `project learn` is cut over and `project ingest` is removed.
- Blockers: None.

## Unresolved Decision Ownership

| Item                                                                                    | Type                             | Owning Chunk                           | Must Resolve Before                  | Notes                                                                                                                             |
| --------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Exact field-level TypeScript shape for creation and maintenance contracts               | Deferred implementation decision | `01-curator-contracts.md`              | Implementation steps in owning chunk | Must preserve the pseudocode contract split unless tests reveal a clearer equivalent shape.                                       |
| Exact validation blocking rules for creation publication versus maintenance eligibility | Deferred implementation decision | `02-curator-validator.md`              | Implementation steps in owning chunk | Creation can begin with structural checks; maintenance must be itemized and stricter.                                             |
| Whether to extract runner mechanics or rewrite small mechanics directly                 | Deferred implementation decision | `03-project-run-infrastructure.md`     | Implementation steps in owning chunk | Extraction is allowed only for mechanical helpers under `src/runtime/`; no Project Memory semantics may remain in infrastructure. This chunk deprecates `runner.ts` as a Project Memory boundary but must not delete it. |
| Schema and Makefile still mention `project ingest`                                      | Reconciliation                   | `05-command-surface-and-vocabulary.md` | Implementation steps in owning chunk | Top-level `ingest <key>` must remain intact; only `project ingest` is removed.                                                    |
| Phase-0 runner tests assert old `learn` and `ingest` stage behavior                     | Reconciliation                   | `06-phase-0-runner-retirement.md`      | Implementation steps in owning chunk | Delete the runner only after replacement command behavior exists; replace old runner assertions with curator-flow tests instead of preserving them. |

## Proposed Chunks

| Chunk                                  | Purpose                                                                                                                                                                               | Depends On                                                                               | Enables                                                                   | Status   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| [`01-curator-contracts.md`](plans/01-curator-contracts.md)              | Add Project Memory Curator shared primitives and separate creation/maintenance output contracts under `src/project/`.                                                                 | None                                                                                     | `02-curator-validator.md`, `04-curator-service-prewrite-flow.md`          | Ready For Implementation |
| [`02-curator-validator.md`](plans/02-curator-validator.md)              | Add deterministic curator-output validation with global errors, per-item outcomes, packet-ref resolution, target path checks, and repo-citation expectations.                         | `01-curator-contracts.md`                                                                | `04-curator-service-prewrite-flow.md`                                     | Ready For Implementation |
| [`03-project-run-infrastructure.md`](plans/03-project-run-infrastructure.md)     | Create or extract mechanical run helpers for curator runs and explicitly deprecate `runner.ts` as legacy Project Memory scaffolding without deleting it. Helpers cover run directory, JSON artifacts, generic markdown artifact writing, provider invocation wrapper, and schema-context freshness. | None                                                                                     | `04-curator-service-prewrite-flow.md`, `06-phase-0-runner-retirement.md`  | Ready For Implementation |
| [`04-curator-service-prewrite-flow.md`](plans/04-curator-service-prewrite-flow.md)  | Add `ProjectMemoryCuratorService.runProjectLearn`: shell/schema checks, packet construction, mode-specific prompt invocation, curator artifacts, validation, and no-write result.     | `01-curator-contracts.md`, `02-curator-validator.md`, `03-project-run-infrastructure.md` | `05-command-surface-and-vocabulary.md`, `06-phase-0-runner-retirement.md` | Ready For Implementation |
| [`05-command-surface-and-vocabulary.md`](plans/05-command-surface-and-vocabulary.md) | Wire `project learn` through the curator service, remove `project ingest` from the Project command surface, and clean schema/Makefile vocabulary while preserving top-level `ingest`. | `04-curator-service-prewrite-flow.md`                                                    | `06-phase-0-runner-retirement.md`                                         | Ready For Implementation |
| [`06-phase-0-runner-retirement.md`](plans/06-phase-0-runner-retirement.md)      | Delete `src/pipeline/runner.ts` and obsolete `stages/*` for Project Memory after command cutover, replacing Phase-0 runner tests with curator-flow and command-surface coverage. | `04-curator-service-prewrite-flow.md`, `05-command-surface-and-vocabulary.md`            | Future bounded markdown apply planning                                    | Ready For Implementation |

## Dependency Order

Recommended order:

1. `01-curator-contracts.md`
2. `02-curator-validator.md`
3. `03-project-run-infrastructure.md`
4. `04-curator-service-prewrite-flow.md`
5. `05-command-surface-and-vocabulary.md`
6. `06-phase-0-runner-retirement.md`

Parallel-safe work:

- `01-curator-contracts.md` and `03-project-run-infrastructure.md` can be implemented in parallel if both preserve the pseudocode boundary.
- `02-curator-validator.md` can start after the contract exports are stable.
- `05-command-surface-and-vocabulary.md` should wait for the curator service to exist so `project learn` does not lose its implementation path.
- `06-phase-0-runner-retirement.md` should be last because it removes old scaffolding only after replacement behavior is covered.
- The deprecated-but-present runner phase is intentional. Chunk 03 freezes `runner.ts` as legacy scaffolding; Chunk 06 removes it after no supported Project Memory command depends on it.

## Shared Contracts

- `ProjectMemoryCuratorMode = "create" | "maintain"`
- `ProjectMemoryEvidenceRef`
- `ProjectMemoryRepoCitation`
- `ProjectMemoryPathRef`
- `ProjectMemoryRisk`
- `ProjectMemoryValidationFinding`
- `ProjectMemoryCreationDraft`
- `ProjectMemoryCreationPageDraft`
- `ProjectMemoryMaintenanceProposal`
- `ProjectMemoryMaintenanceProposalItem`
- `ProjectMemoryCuratorOutput`
- `ProjectMemoryValidationOutcome = "eligible" | "rejected" | "quarantined" | "noop"`
- `ProjectMemoryCuratorValidationResult`
- `RunProjectMemoryCuratorInput`
- `ProjectMemoryCuratorRunResult`

Flow and boundary contracts:

- `project learn` routes to `ProjectMemoryCuratorService.runProjectLearn`, not `runProjectPipeline`.
- `project ingest` is not registered as a Project Memory command.
- Top-level `ingest <key>` remains the Session Memory / Experience Log ingest command.
- `src/pipeline/runner.ts` is deprecated for Project Memory in Chunk 03. New curator behavior must not depend on `runProjectPipeline`.
- `src/pipeline/runner.ts` deletion waits for Chunk 06, after `project learn` no longer uses it and `project ingest` has been removed.
- `ProjectMemoryPacket` remains the authoritative curator input boundary.
- Project Memory source/inbox material is gathered into packet construction, not processed by a separate Project Memory command.
- Curator run artifacts use curator-specific names: `input-packet.json`, `curator-creation-draft.json` or `curator-maintenance-proposal.json`, `curator-validation.json`, `curator-run-result.json`, and `summary.md`.
- This plan set stops before canonical wiki markdown mutation.

## Spec Coverage Map

| Spec Requirement                                                                       | Covered By                                                                                  | Notes                                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Separate creation and maintenance curator output contracts                             | `01-curator-contracts.md`                                                                   | Preserves ADR 0058 and pseudocode contract split.                                                   |
| Deterministic validation before wiki writes                                            | `02-curator-validator.md`, `04-curator-service-prewrite-flow.md`                            | Validator produces global findings and per-item outcomes; service stops before writes.              |
| `project learn` uses Project Memory packet as curator input                            | `04-curator-service-prewrite-flow.md`                                                       | Uses existing `buildProjectMemoryPacket` and adds source/inbox packet input boundary as needed.     |
| `project learn` supersedes Project Memory `project ingest`                             | `05-command-surface-and-vocabulary.md`                                                      | Removes Project command route and cleans schema/Make vocabulary.                                    |
| `src/pipeline/runner.ts` is not the future Project Memory boundary                     | `03-project-run-infrastructure.md`, `06-phase-0-runner-retirement.md`                       | Chunk 03 deprecates the runner boundary and supplies replacement mechanics; Chunk 06 deletes it after command cutover. |
| Existing markdown without `project-memory.json` is untrusted context                   | `01-curator-contracts.md`, `02-curator-validator.md`, `04-curator-service-prewrite-flow.md` | Creation draft carries policy for untrusted existing markdown; validator checks mode.               |
| Rejected, quarantined, eligible, and noop outcomes                                     | `02-curator-validator.md`                                                                   | Outcome vocabulary belongs to validation result and maintenance item checks.                        |
| Markdown remains canonical and SQLite/vector state remains non-canonical               | `02-curator-validator.md`, `04-curator-service-prewrite-flow.md`                            | No wiki mutation in this slice; packet refs and citations point back to canonical/project evidence. |
| Defers page mutation, indexing, scheduling, Practice/Personal Memory, Current Briefing | `04-curator-service-prewrite-flow.md`, `06-phase-0-runner-retirement.md`                    | Service writes pre-write artifacts only; no derived retrieval or scheduling changes.                |

## Verification Strategy

Repo-native verification for the full plan set:

```bash
bun test
bun run typecheck
git diff --check
```

Focused verification expected across chunks:

- `bun test tests/project/project-memory-packet.test.ts`
- `bun test tests/project/project-service.test.ts`
- `bun test tests/commands/project.test.ts`
- `bun test tests/commands/ingest.test.ts`
- New curator contract and validator tests under `tests/project/`.
- Replacement curator-service tests under `tests/project/` or `tests/project/project-memory-curator-service.test.ts`.

Expected signals:

- Contract and validator tests reject malformed curator output, missing provenance, unknown packet refs, out-of-wiki paths, unsupported broad operations, illegal lifecycle transitions, degraded-packet normal eligibility, protected state assignment, missing repo citations for repo-groundable claims, and wrong mode output.
- Curator service tests prove artifacts are written, provider/JSON failures still leave failure artifacts, and wiki markdown is not mutated.
- Command tests prove `project learn` routes through the curator service and `project ingest` is not a registered Project command.
- Ingest command tests prove top-level `ingest <key>` still works.

## Risks And Sequencing Notes

- The current `src/pipeline/runner.ts` owns both old behavior and useful mechanics. Chunk 03 must be strict: extract only mechanical helpers or rewrite them directly, and explicitly deprecate the runner as legacy Project Memory scaffolding. Runtime helpers must not own Project Memory mode, validation, or stopped-before-writes product semantics.
- Removing `project ingest` affects command help, schema context command vocabulary, Makefile aliases, and tests. Chunk 05 owns all operator-facing vocabulary cleanup.
- Deleting `runner.ts` before `ProjectMemoryCuratorService` and command cutover would break the current `project learn` path. Keeping it as an active boundary after cutover would preserve obsolete semantics. The planned sequence is therefore deprecate early, delete late.
- Creation validation is intentionally less strict than maintenance validation in the first slice, but it must still guard paths, project key, schema version, provenance floor, and protected state assignment.
- Provider invocation should keep the existing read-only Codex sandbox behavior from `src/runtime/llm-client.ts`; no chunk should weaken that.
- The full plan does not implement markdown apply. Any executor that starts mutating wiki files for curator output has crossed the approved scope.

## Execution Handoff

Recommended next skill: `$pmp-executing-plans`.

Execution should load:

- `docs/design/2026-06-18-project-memory-curator/plan.md`
- selected approved chunk plans under `docs/design/2026-06-18-project-memory-curator/plans/`
- source artifacts listed above

Recommended execution modes:

- execute one chunk
- execute selected chunks
- execute all chunks in dependency order

Execution must stop on unclear plan steps, failed verification, code/spec conflict, missing dependencies, or user-requested changes.

## User Approval

Roadmap approved by user instruction on 2026-06-23. Chunk plans have been generated under `docs/design/2026-06-18-project-memory-curator/plans/`.
