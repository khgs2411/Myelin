# Runtime Durable Memory Candidate Inbox Implementation Plan Set

**Spec:** `spec.md`  
**Agenda:** `agenda.md`  
**Pseudocode:** `pseudocode/` loaded and treated as strong shaping artifacts  
**Context:** `../../../CONTEXT.md` loaded  
**ADRs:** `../../adr/0061-use-layer-shaped-runtime-inbox-with-implemented-consumers.md`  
**Status:** Chunk Plans Written

## Goal

Implement the V2 runtime durable-memory inbox foundation for Project Memory: explicit runtime inbox source creation, deterministic source-to-candidate intake, and `project learn` composition of that intake before packet construction. This plan does not implement gap/stale producer routing, Practice/Personal intake consumers, retrieval indexing, or direct curator ingestion of raw inbox files.

## Source Artifacts

- `docs/design/2026-06-25-project-memory-candidate-intake/spec.md`
- `docs/design/2026-06-25-project-memory-candidate-intake/agenda.md`
- `docs/design/2026-06-25-project-memory-candidate-intake/pseudocode/README.md`
- `docs/design/2026-06-25-project-memory-candidate-intake/pseudocode/RuntimeDurableMemoryInboxContract.md`
- `docs/design/2026-06-25-project-memory-candidate-intake/pseudocode/RuntimeInboxItemJsonFormat.md`
- `docs/design/2026-06-25-project-memory-candidate-intake/pseudocode/MemoryInboxCreateCommandShape.md`
- `docs/design/2026-06-25-project-memory-candidate-intake/pseudocode/ProjectMemoryCandidateIntakeService.ts`
- `docs/design/2026-06-25-project-memory-candidate-intake/pseudocode/CandidateIdAndDedupeContract.md`
- `docs/design/2026-06-25-project-memory-candidate-intake/pseudocode/ProjectLearnCandidateIntakeFlow.md`
- `docs/design/2026-06-25-project-memory-candidate-intake/pseudocode/CandidateIntakeReliabilityBoundary.md`
- `CONTEXT.md`
- `docs/ROADMAP.md`
- `docs/CLI.md`
- `docs/adr/0061-use-layer-shaped-runtime-inbox-with-implemented-consumers.md`
- External audit result from Maxwell (`019eff23-17cd-76c2-8af1-cf6554ae3dfb`): `Ready for Development`; not persisted as a repo artifact.

Code paths inspected:

- `src/commands/memory.ts`
- `src/commands/project.ts`
- `src/commands/registry.ts`
- `src/cli.ts`
- `src/inbox/items.ts`
- `src/memory/candidates.ts`
- `src/memory/db.ts`
- `src/memory/ingest-types.ts`
- `src/memory/memory-candidate-service.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-packet.ts`
- `src/project/project-memory-source-consumption-reconciler.ts`
- `src/project/project-service.ts`
- `src/runtime/fs.ts`
- `src/runtime/ids.ts`
- `src/runtime/json.ts`
- `src/runtime/project-shell.ts`

Tests and validation context inspected:

- `tests/commands/memory.test.ts`
- `tests/commands/project.test.ts`
- `tests/inbox/inbox.test.ts`
- `tests/memory/candidates.test.ts`
- `tests/project/project-memory-curator-service.test.ts`
- `tests/project/project-memory-source-consumption-reconciler.test.ts`
- `package.json`
- `Makefile`

Discovered repo-native verification commands:

- `bun test`
- `bun test tests/inbox/runtime-inbox-items.test.ts`
- `bun test tests/commands/memory.test.ts`
- `bun test tests/project/project-memory-candidate-intake-service.test.ts`
- `bun test tests/project/project-memory-curator-service.test.ts`
- `bun run typecheck`
- `rtk git diff --check`

## Design Readiness Check

| Check | Result |
| --- | --- |
| Source artifact paths verified | Pass |
| Pseudocode artifacts | Loaded; every source-like pseudocode file has the non-executable reference header or folder-level non-executable rule |
| Pseudocode alignment | Pass, with concrete file placement reconciliations below |
| Missing or unavailable artifacts | None |
| Open agenda questions or risks | None; agenda states remaining non-blocking risks: none |
| Spec / agenda / context / ADR consistency | Pass |
| Parent / child spec consistency | Not applicable; no child spec belongs to this slice |
| Accepted planning reconciliations | See table below |
| Blockers | None |

Accepted planning reconciliations:

| Item | Reconciliation | Impact |
| --- | --- | --- |
| Runtime inbox implementation file name | Use a new `src/inbox/runtime-inbox-items.ts` module for the V2 runtime inbox contract/writer instead of extending `src/inbox/items.ts`. | Preserves the spec and audit instruction that `src/inbox/items.ts` is non-authoritative existing producer-specific context. |
| Source record validation | Use one shared contract/parser in the runtime inbox module for write-time and intake-time validation. | Prevents drift between `memory inbox create` and intake. |
| Evidence refs | Treat `--evidence-ref` as repeatable optional metadata, with required `--rationale` carrying the explanation when evidence refs are empty. | Keeps the first CLI usable while preserving explicit rationale as required evidence posture. |
| CLI tests | Add focused tests to `tests/commands/memory.test.ts` unless implementation size makes a new `tests/commands/memory-inbox.test.ts` clearer. | Matches current command-test convention while allowing a split if the file becomes noisy. |
| Documentation | Update `docs/CLI.md` in the command chunks that introduce `memory inbox create` and `memory inbox intake`. | Keeps CLI reference current with operator-facing commands. |

Out-of-scope roadmap note:

- Gap/stale producer routing is the next roadmap item, not part of this plan. Any local draft artifacts for that topic are non-authoritative and must not be used as source artifacts for this runtime inbox/intake foundation.

## Unresolved Decision Ownership

| Item | Type | Owning Chunk | Must Resolve Before | Notes |
| --- | --- | --- | --- | --- |
| Final runtime inbox source id prefix/hash spelling | Deferred implementation decision | `01-runtime-inbox-contract-and-writer.md` | Implementation steps in owning chunk | Must be deterministic enough for safe file names and candidate id derivation, but exact prefix can follow `src/runtime/ids.ts` conventions. |
| Candidate id string spelling | Deferred implementation decision | `03-project-candidate-intake-service.md` | Implementation steps in owning chunk | Must derive from project key plus inbox item id and remain stable across repeated intake. |
| Human-readable command summaries | Deferred implementation decision | `02-memory-inbox-create-command.md` and `04-memory-inbox-intake-command.md` | Implementation steps in owning chunk | JSON output is the contract; text output should expose confidence/risk and summary counts without adding lifecycle semantics. |

## Approved Chunks

| Chunk | Purpose | Depends On | Enables | Status |
| --- | --- | --- | --- | --- |
| `plans/01-runtime-inbox-contract-and-writer.md` | Add the V2 runtime inbox item contract, validation, path helpers, atomic JSON writer, and lazy `sources/` index maintenance. | None | `plans/02-memory-inbox-create-command.md`, `plans/03-project-candidate-intake-service.md` | Ready For Implementation |
| `plans/02-memory-inbox-create-command.md` | Expose `myelin memory inbox create <project-key> --layer project --body ...` as the write-only source creation surface. | `plans/01-runtime-inbox-contract-and-writer.md` | Operator/tool proposal creation and end-to-end source fixtures for intake | Ready For Implementation |
| `plans/03-project-candidate-intake-service.md` | Add `ProjectMemoryCandidateIntakeService` to normalize valid project runtime inbox items into idempotent `project.inbox` candidates. | `plans/01-runtime-inbox-contract-and-writer.md` | `plans/04-memory-inbox-intake-command.md`, `plans/05-project-learn-intake-integration.md` | Ready For Implementation |
| `plans/04-memory-inbox-intake-command.md` | Expose `myelin memory inbox intake <project-key>` as a deterministic provider-free source-to-candidate command. | `plans/03-project-candidate-intake-service.md` | Operator/test visibility before curator runs | Ready For Implementation |
| `plans/05-project-learn-intake-integration.md` | Compose the same intake service inside `project learn` after source-consumption reconciliation and before packet construction. | `plans/03-project-candidate-intake-service.md` | Self-maintaining product loop and dogfood checkpoint | Ready For Implementation |

Chunk boundary rationale:

- Chunk 01 isolates the source contract and writer so CLI creation and intake cannot drift.
- Chunk 02 is the producer-facing operator API and should not create candidates.
- Chunk 03 is the core normalization/idempotency service and should not know command formatting or curator invocation.
- Chunk 04 is a thin deterministic command over the service for tests and operator visibility.
- Chunk 05 is orchestration-only composition inside `project learn`; it must not duplicate intake logic.

## Dependency Order

1. `plans/01-runtime-inbox-contract-and-writer.md`
2. `plans/02-memory-inbox-create-command.md`
3. `plans/03-project-candidate-intake-service.md`
4. `plans/04-memory-inbox-intake-command.md`
5. `plans/05-project-learn-intake-integration.md`

Potential parallelism after Chunk 01:

- Chunk 02 and Chunk 03 can be implemented in parallel if write scopes are kept separate: command parsing/output in `src/commands/memory.ts` versus intake service and project tests.
- Chunk 04 depends on Chunk 03 and should not start before the service result shape is stable.
- Chunk 05 depends on Chunk 03 and should wait until intake idempotency is tested.

## Shared Contracts

- Runtime inbox source path: `projects/<key>/sources/inbox/<id>.json`
- Source index files created by the writer: `projects/<key>/sources/index.md` and `projects/<key>/sources/inbox/index.md`
- Runtime inbox source ref: `inbox:<item-id>`
- Runtime inbox candidate type: `project.inbox`
- Runtime inbox item schema version: `1`
- Target layer enum: `project | practice | personal`
- First-slice accepted target layer: `project`
- Unsupported first-slice layers: `practice`, `personal`
- Confidence enum: `low | medium | high`
- Risk enum: `low | medium | high`
- Runtime inbox candidates created with `scope: "project"` and `status: "needs_review"`
- Runtime inbox files are immutable preserved source material; intake must not rewrite them
- CLI creation exposes no lifecycle status option
- `memory inbox intake` and `project learn` must call the same `ProjectMemoryCandidateIntakeService`
- `project learn` ordering: apply recovery, shell repair when applicable, schema preflight, source-consumption reconciliation, runtime inbox intake, packet construction, curator invocation, validation/apply

## Spec Coverage Map

| Spec Requirement | Covered By | Notes |
| --- | --- | --- |
| Explicit project-scoped runtime inbox proposal creation | `plans/02-memory-inbox-create-command.md` | Depends on writer from Chunk 01 |
| Creation command is `memory inbox create`, not candidate creation | `plans/02-memory-inbox-create-command.md` | Command must not call `createMemoryCandidate` |
| Runtime inbox item files are preserved without lifecycle rewrites | `plans/01-runtime-inbox-contract-and-writer.md`, `plans/03-project-candidate-intake-service.md` | Writer creates; intake reads only |
| Pretty JSON under `sources/inbox/<id>.json` | `plans/01-runtime-inbox-contract-and-writer.md` | Use repo JSON conventions from `src/runtime/json.ts` where applicable |
| Lazy `sources/index.md` and `sources/inbox/index.md` creation | `plans/01-runtime-inbox-contract-and-writer.md` | Bootstrap remains unchanged |
| Required confidence/risk enums | `plans/01-runtime-inbox-contract-and-writer.md`, `plans/02-memory-inbox-create-command.md`, `plans/03-project-candidate-intake-service.md` | Shared validation prevents drift |
| Inline `--body`; no first-slice `--file` | `plans/02-memory-inbox-create-command.md` | Reject unknown `--file` as unsupported/unknown in this slice |
| `memory inbox intake <project-key>` deterministic command | `plans/04-memory-inbox-intake-command.md` | Provider-free command wrapper |
| Intake creates exactly one `needs_review` Project Memory candidate | `plans/03-project-candidate-intake-service.md` | Uses deterministic id and `project.inbox` |
| Repeated intake and repeated learn do not duplicate candidates | `plans/03-project-candidate-intake-service.md`, `plans/05-project-learn-intake-integration.md` | Existing/terminal duplicate states tested |
| Existing terminal candidates are not recreated | `plans/03-project-candidate-intake-service.md` | Report terminal duplicate |
| Malformed item degrades/skips without curator visibility | `plans/03-project-candidate-intake-service.md`, `plans/05-project-learn-intake-integration.md` | Blocking only for unsafe ownership/path |
| `project learn` runs intake before packet construction | `plans/05-project-learn-intake-integration.md` | Test packet includes normalized candidate |
| Curator sees normalized candidates, not raw inbox files | `plans/05-project-learn-intake-integration.md` | Packet builder remains read-only |
| Session Memory remains separate | `plans/05-project-learn-intake-integration.md` | No changes to Session Memory ingest/indexing |
| Practice/Personal named but unsupported until consumers exist | `plans/01-runtime-inbox-contract-and-writer.md`, `plans/02-memory-inbox-create-command.md`, `plans/03-project-candidate-intake-service.md` | Explicit unsupported-layer result |

## Verification Strategy

Use test-first implementation where practical because this slice has clear behavior boundaries.

Chunk-level verification should include focused tests first, then broader checks:

- `bun test tests/inbox/runtime-inbox-items.test.ts`
- `bun test tests/commands/memory.test.ts`
- `bun test tests/project/project-memory-candidate-intake-service.test.ts`
- `bun test tests/project/project-memory-curator-service.test.ts`
- `bun test`
- `bun run typecheck`
- `rtk git diff --check`

Behavioral verification targets:

- creating a runtime inbox item writes only preserved source JSON and source indexes;
- invalid creation input writes nothing;
- unsupported layers fail explicitly;
- intake creates one `needs_review` `project.inbox` candidate with `source_event_refs_json` containing `inbox:<id>`;
- repeated intake reports existing or terminal duplicate without insertions;
- malformed individual source files are skipped/degraded and not present in packet input;
- `project learn` packet construction observes candidates created by intake in the same run.

## Risks And Sequencing Notes

- The existing `src/inbox/items.ts` uses a top-level `projects/<key>/inbox/` path and producer-specific fields. Do not reuse that module as the V2 runtime inbox boundary.
- `memory_candidates.source_event_refs_json` is Experience Log-oriented by name, but the approved design uses `inbox:<id>` refs through that existing field for this slice.
- Keep lifecycle out of source files. If implementation wants easier source inspection, defer a derived inspection/index surface instead of mutating preserved JSON.
- `project learn --dry-run` currently skips project shell repair but still performs schema/reconciliation work. Chunk 05 must preserve existing dry-run semantics and only add intake where it is safe and deterministic.
- The future gap/stale routing roadmap item must remain out of scope until this foundation is implemented and dogfooded.

## Execution Handoff

Recommended next skill after chunk plans are written: `$pmp-executing-plans`.

Execution should load:

- `docs/design/2026-06-25-project-memory-candidate-intake/plan.md`
- selected files under `docs/design/2026-06-25-project-memory-candidate-intake/plans/`
- all source artifacts listed above

Recommended execution modes:

- execute one chunk;
- execute selected chunks in dependency order;
- execute all chunks in dependency order after reviewing the generated chunk plans.

Execution must stop on unclear plan steps, failed verification, code/spec conflict, missing dependencies, or user-requested changes.

## User Approval

Roadmap approved by the user on 2026-06-25 after external roadmap audit returned `Ready for Development`. Chunk plan files have been generated under `plans/`.
