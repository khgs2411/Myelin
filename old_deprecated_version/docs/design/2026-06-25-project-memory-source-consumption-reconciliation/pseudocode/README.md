# Project Memory Source Consumption Reconciliation Pseudocode Artifacts

Status: Draft

## Source Artifacts

- `MYELIN.md`
- `CONTEXT.md`
- `docs/README.md`
- `docs/ROADMAP.md`
- `docs/IMPLEMENTATION_ALIGNMENT.md`
- `docs/design/2026-06-23-project-memory-markdown-apply/spec.md`
- `docs/design/2026-06-23-project-memory-markdown-apply/agenda.md`
- `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`
- `docs/adr/0059-use-structured-project-memory-apply-payloads.md`
- `docs/adr/0060-use-apply-journal-for-project-memory-writes.md`

Code context inspected:

- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-markdown-applier.ts`
- `src/project/project-memory-apply-contracts.ts`
- `src/project/project-memory-packet.ts`
- `src/project/project-service.ts`
- `src/memory/candidates.ts`
- `src/memory/handoffs.ts`
- `src/memory/migrations.ts`
- `src/memory/ingest-types.ts`
- `src/commands/project.ts`
- `tests/project/project-memory-markdown-applier.test.ts`
- `tests/project/project-memory-packet.test.ts`
- `tests/commands/project.test.ts`

## Draft Shape Summary

The next Step 3 slice closes the loop between Project Memory markdown apply and Project Memory candidate/handoff queues.

Markdown apply now writes Project Memory Source Consumption records to `projects/<key>/state/project-memory-source-consumptions.json`. Those records say a `project_candidate` or `project_handoff` ref has become terminal because an apply run wrote durable Project Memory output for it. The source queue rows still live in root SQLite, where `project packet` reads `pending` and `needs_review` rows as curator input.

This slice adds a deterministic reconciler that reads project-level source-consumption state and updates only matching queue rows in SQLite. It should mark consumed project candidates and project handoffs as `processed`, set `processed_at` and `updated_at`, and be safe to run repeatedly.

The important boundary is:

- apply owns canonical markdown/state writes and source-consumption evidence;
- reconciliation owns queue lifecycle mutation from that evidence;
- packet building remains read-only;
- the curator does not see refs already terminally consumed by prior apply runs.

## Assumptions Made

- No new public command is required for the first slice; `project learn` should run reconciliation before building a new packet.
- `project packet` stays read-only. It may still show stale pending queue rows if the operator runs it before reconciliation, but `project learn` should not feed those rows to the curator.
- Reconciliation should happen after incomplete apply-journal recovery and before the next Project Memory packet is built.
- Reconciliation mutates only root SQLite queue state. It does not edit wiki markdown, source-consumption state, run artifacts, Practice Memory, Personal Memory, or derived retrieval indexes.
- Missing queue rows are not fatal. A source-consumption record can outlive the SQLite row or refer to a row already processed.
- Non-project candidates and non-project handoff queues are out of scope for this slice.

## Non-Executable Rule

Every source-like file in this folder is pseudocode reference material, not implementation.

## Artifact Map

| Artifact | Type | Intended Destination | Responsibility |
| --- | --- | --- | --- |
| `ProjectMemorySourceConsumptionReconciler.ts` | File-shaped | `src/project/project-memory-source-consumption-reconciler.ts` | Owns deterministic reconciliation from `project-memory-source-consumptions.json` to SQLite queue lifecycle updates. |
| `MemoryQueueLifecycleHelpers.ts` | File-shaped | Existing `src/memory/candidates.ts` and `src/memory/handoffs.ts`, or a small shared helper if implementation needs one | Adds narrow status-transition helpers for memory candidates and handoff instructions. |
| `ProjectLearnReconciliationPreflightFlow.md` | Flow-shaped | `src/project/project-memory-curator-service.ts` and tests | Shows where reconciliation runs in `project learn` relative to apply recovery, packet building, and curator invocation. |
| `ReconciliationOwnershipBoundary.md` | Boundary-shaped | `src/project/*`, `src/memory/*`, `src/commands/project.ts` | Defines ownership and non-ownership so apply, packet, and queue lifecycle do not collapse into one module. |

## Cross-Artifact Relationships

- `ProjectMemorySourceConsumptionReconciler.ts` consumes the source-consumption state shape defined by `src/project/project-memory-apply-contracts.ts`.
- `ProjectMemorySourceConsumptionReconciler.ts` calls the status-transition helpers shaped in `MemoryQueueLifecycleHelpers.ts`.
- `ProjectLearnReconciliationPreflightFlow.md` places the reconciler before `buildProjectMemoryPacket`.
- `ReconciliationOwnershipBoundary.md` explains why `project-memory-markdown-applier.ts` should not update SQLite queue statuses directly.

## Libraries And Conventions To Preserve

- Use Bun/TypeScript modules and current `src/project/` service style.
- Use `openMemoryDb(root)` for root SQLite access and close the DB in the caller-owned scope.
- Use `readJsonIfExists` and `resolveInside` / `projectPath` style helpers for project state reads.
- Use stored lifecycle enum values: `pending`, `needs_review`, `processed`, `rejected`.
- Normalize human aliases like `needs-review` only at CLI boundaries; internal JSON/state should use stored enum values.
- Keep markdown Project Memory canonical; SQLite queue lifecycle is serving/evidence state, not Project Memory truth.

## Review Points

- Confirm that `project learn` preflight is enough for the first slice, without adding a public `project reconcile` command.
- Confirm whether `project packet` should stay purely read-only even if that means its standalone output can show stale consumed refs before `project learn` reconciles.
- Confirm whether reconciliation results should be surfaced in the human/JSON `project learn` result now, or kept internal until an operator-facing need appears.

## Open Risks Or Allowed Divergence

- If standalone `project packet` must guarantee no consumed refs appear, implementation may add read-only filtering from source-consumption state. That should not replace the lifecycle reconciler because the queue rows would still remain pending.
- If operator visibility becomes important, a narrow explicit command can be added later, but this draft assumes no new CLI surface for the first slice.
- Current DB rows have `processed_at` but no processed reason/output-ref columns. The source-consumption state file remains the audit evidence for why a row was processed.
- The reconciler can either update already `processed` rows as noops or skip them without touching timestamps. This draft prefers noops to preserve first-processed timing.
