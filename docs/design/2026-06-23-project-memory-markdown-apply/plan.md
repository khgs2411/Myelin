# Project Memory Markdown Apply Implementation Plan Set

**Spec:** `spec.md`
**Agenda:** `agenda.md`
**Pseudocode:** `pseudocode/` loaded and treated as strong shaping artifacts
**Context:** `CONTEXT.md` loaded
**ADRs:** `0018`, `0019`, `0020`, `0058`, `0059`, `0060`
**Status:** Chunk Plans Written

## Goal

Implement the Step 3 Project Memory markdown-apply slice so `myelin project learn <key>` can turn validated curator output into bounded, provenance-backed canonical wiki/state writes for both creation and maintenance modes, while preserving stopped-before-writes behavior for unsafe, review, dry-run, invalid, or unsupported runs.

## Source Artifacts

Design artifacts:

- `docs/design/2026-06-23-project-memory-markdown-apply/spec.md`
- `docs/design/2026-06-23-project-memory-markdown-apply/agenda.md`
- `docs/design/2026-06-23-project-memory-markdown-apply/pseudocode/README.md`
- `docs/design/2026-06-23-project-memory-markdown-apply/pseudocode/ProjectApplyGateBoundary.md`
- `docs/design/2026-06-23-project-memory-markdown-apply/pseudocode/ProjectLearnMarkdownApplyFlow.md`
- `docs/design/2026-06-23-project-memory-markdown-apply/pseudocode/ProjectMemoryEntryBlockFormat.md`
- `docs/design/2026-06-23-project-memory-markdown-apply/pseudocode/src/project/project-memory-apply-contracts.ts`
- `docs/design/2026-06-23-project-memory-markdown-apply/pseudocode/src/project/project-memory-markdown-applier.ts`
- `docs/design/2026-06-23-project-memory-markdown-apply/pseudocode/src/project/project-memory-curator-service.ts`
- `CONTEXT.md`
- `docs/adr/0018-project-learn-can-read-live-repo.md`
- `docs/adr/0019-project-learn-auto-applies-by-default.md`
- `docs/adr/0020-gate-risky-project-learn-changes.md`
- `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`
- `docs/adr/0059-use-structured-project-memory-apply-payloads.md`
- `docs/adr/0060-use-apply-journal-for-project-memory-writes.md`
- Prior context: `docs/design/2026-06-18-project-memory-curator/spec.md`, `agenda.md`, `plan.md`, and `pseudocode/`

Code paths inspected:

- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-validator.ts`
- `src/project/project-memory-curator-service.ts`
- `src/project/project-memory-packet.ts`
- `src/project/project-memory-lookup.ts`
- `src/project/project-service.ts`
- `src/commands/project.ts`
- `src/runtime/project-run-infrastructure.ts`
- `src/runtime/fs.ts`
- `src/runtime/json.ts`
- `src/runtime/project-shell.ts`

Tests inspected:

- `tests/project/project-memory-curator-contracts.test.ts`
- `tests/project/project-memory-curator-service.test.ts`
- `tests/project/project-memory-curator-validator.test.ts`
- `tests/project/project-memory-packet.test.ts`
- `tests/project/project-service.test.ts`
- `tests/commands/project.test.ts`

Validation commands discovered:

- `bun test`
- `bun run typecheck`
- `git diff --check`

## Design Readiness Check

- Source artifact paths verified: Pass.
- Pseudocode artifacts: Loaded. All source-like pseudocode artifacts include the standard non-executable reference header.
- Pseudocode alignment: Pass. Proposed chunks preserve the pseudocode-defined `ProjectMemoryApplyPayload`, `ProjectMemoryMarkdownApplier`, service orchestration, apply gate, journaled recovery, source-consumption state, and stable markdown entry-block boundary.
- Missing or unavailable artifacts: None.
- Open agenda questions or risks: No blocking questions. Non-blocking implementation-level risks are assigned below.
- Spec / agenda / context / ADR consistency: Pass. The external audit loop returned `Ready for Development`, and the final cleanup kept the same status.
- Parent / child spec consistency: Pass. The current plan follows the Project Memory Curator direction from `2026-06-18-project-memory-curator` while extending the current pre-write curator flow into deterministic apply.
- Accepted planning reconciliations:
  - The spec allows `project-memory-source-consumptions.json` or an equivalent state file. Planning will use `projects/<key>/state/project-memory-source-consumptions.json` as the concrete default; any later divergence must be recorded in the owning chunk.
  - Pseudocode allows `project-memory-apply-contracts.ts` to merge into curator contracts. Planning will prefer a focused new `src/project/project-memory-apply-contracts.ts` unless implementation finds a TypeScript cycle or export problem.
  - Current `packetMode` treats `bootstrap-state.status === "curated"` as maintenance-capable. Planning keeps packet construction compatibility but makes apply authority explicitly depend on `state/project-memory.json.status === "curated"`.
- Blockers: None.

## Unresolved Decision Ownership

| Item | Type | Owning Chunk | Must Resolve Before | Notes |
| --- | --- | --- | --- | --- |
| Exact apply payload field names and export placement | Implementation detail | `01-apply-payload-contracts-and-validation.md` | Implementation steps in owning chunk | Preserve structured page/entry payload semantics. |
| Stable markdown marker attribute details | Implementation detail | `02-markdown-entry-renderer-and-safe-mutation.md` | Implementation steps in owning chunk | Preserve exact block targeting, visible provenance, and lifecycle rendering. |
| Apply journal JSON field names and terminal statuses | Implementation detail | `03-apply-journal-staging-and-recovery.md` | Implementation steps in owning chunk | Preserve staged outputs, observed promotions, state-last writes, and recovery preflight. |
| Page manifest and changelog update policy | Implementation detail | `04-creation-apply.md` | Implementation steps in owning chunk | Use existing `pages.json` and `log/changelog.md` conventions when concrete implementation support is present. |
| Concrete source-consumption state filename | Reconciliation | `06-source-consumption-and-changeset-evidence.md` | Implementation steps in owning chunk | Default to `projects/<key>/state/project-memory-source-consumptions.json`. |
| Trusted-state predicate conflict with current packet mode | Reconciliation | `07-project-learn-service-integration.md` | Implementation steps in owning chunk | Apply authority requires `project-memory.json.status === "curated"` even if packet construction remains compatibility-oriented. |
| Existing tests assert all successful curator runs stop before writes | Test drift | `07-project-learn-service-integration.md` | Implementation steps in owning chunk | Update expectations only after apply behavior exists. |

## Proposed Chunks

| Chunk | Purpose | Depends On | Enables | Status |
| --- | --- | --- | --- | --- |
| `plans/01-apply-payload-contracts-and-validation.md` | Add concrete structured apply payload contracts and validator checks for creation and maintenance applyability. | None | `02`, `03`, `04`, `05` | Ready For Implementation |
| `plans/02-markdown-entry-renderer-and-safe-mutation.md` | Build deterministic markdown rendering, entry-block parsing/replacement, provenance rendering, snippet extraction, and wiki path safety helpers. | `01` | `03`, `04`, `05` | Ready For Implementation |
| `plans/03-apply-journal-staging-and-recovery.md` | Implement staged output planning, apply journal persistence, canonical promotion order, and deterministic recovery from incomplete journals. | `01`, `02` | `04`, `05`, `07` | Ready For Implementation |
| `plans/04-creation-apply.md` | Publish valid creation drafts as trusted initial Project Memory pages and curated `project-memory.json` state. | `01`, `02`, `03` | `07`, final creation-mode acceptance | Ready For Implementation |
| `plans/05-maintenance-apply.md` | Apply eligible maintenance items to existing wiki entry blocks with lifecycle/provenance semantics. | `01`, `02`, `03` | `06`, `07`, final maintenance-mode acceptance | Ready For Implementation |
| `plans/06-source-consumption-and-changeset-evidence.md` | Write bounded changesets and Project Memory Source Consumption records to project state and run artifacts without mutating candidate/handoff statuses. | `03`, `04`, `05` | `07`, later candidate/handoff reconciler | Ready For Implementation |
| `plans/07-project-learn-service-integration.md` | Wire recovery preflight, apply decisions, trusted-state gating, run results, artifacts, summary, and CLI output into `project learn`. | `04`, `05`, `06` | End-to-end behavior and test drift cleanup | Ready For Implementation |
| `plans/08-docs-roadmap-and-final-verification.md` | Update roadmap/docs and run final repo-native verification across the full plan set. | `07` | Execution handoff completion | Ready For Implementation |

## Dependency Order

Implement in this order:

1. `01-apply-payload-contracts-and-validation.md`
2. `02-markdown-entry-renderer-and-safe-mutation.md`
3. `03-apply-journal-staging-and-recovery.md`
4. `04-creation-apply.md`
5. `05-maintenance-apply.md`
6. `06-source-consumption-and-changeset-evidence.md`
7. `07-project-learn-service-integration.md`
8. `08-docs-roadmap-and-final-verification.md`

Potential parallelism after dependencies are satisfied:

- `04-creation-apply.md` and `05-maintenance-apply.md` can be implemented in parallel after `03`, if their tests use disjoint fixtures and both preserve the same applier contract.
- `08` must stay last.

## Shared Contracts

- `src/project/project-memory-apply-contracts.ts` owns apply payload, apply input/result, journal, changeset, bounded snippet, and source-consumption types.
- `src/project/project-memory-curator-contracts.ts` remains the curator output contract owner. It may import or re-export apply payload types, but `content_intent` must not be the write authority.
- `src/project/project-memory-curator-validator.ts` owns deterministic validation of concrete apply payloads, provenance, path safety, lifecycle legality, creation publication minimum, and unsupported operations.
- `src/project/project-memory-markdown-applier.ts` owns provider-free deterministic markdown rendering, safe file mutation, staged outputs, journaled promotion, recovery, changesets, and source-consumption state writes.
- `src/project/project-memory-curator-service.ts` owns `project learn` orchestration, recovery preflight before new curator work, apply decision, terminal run result, and summary.
- `src/runtime/project-run-infrastructure.ts` remains a mechanical helper layer for run directories and artifacts. It must not own Project Memory apply semantics.
- `projects/<key>/state/project-memory.json.status === "curated"` is the trusted apply authority predicate for maintenance writes.
- `projects/<key>/state/project-memory-source-consumptions.json` is the planned source-consumption state surface.
- Run artifacts for applied runs are `project-memory-apply-journal.json`, `project-memory-apply-result.json`, and `project-memory-changeset.json`.
- CLI-visible `stopped_before_writes` must become `false` only when canonical markdown/state writes occurred.

## Spec Coverage Map

| Spec Requirement | Covered By | Notes |
| --- | --- | --- |
| Structured apply payloads replace `content_intent` as write authority | `01`, `02` | Contract plus deterministic renderer. |
| Validation consumes curator artifacts and rejects malformed/missing concrete payloads | `01` | Includes creation and maintenance checks. |
| Stable human-readable markdown entry blocks with visible provenance | `02` | Includes lifecycle markers and exact block replacement. |
| Safe wiki path resolution and no non-wiki canonical writes | `02`, `03`, `04`, `05` | Recheck paths at validation and apply. |
| All-or-nothing staged writes with apply journal and state-last promotion | `03` | Required before mode-specific apply. |
| Interrupted journals are recovered before new curator invocation | `03`, `07` | Core recovery in `03`, service preflight in `07`. |
| Creation drafts publish first trusted pages and curated state | `04`, `07` | Includes index plus domain-page/rationale minimum. |
| Maintenance proposals update only targeted existing pages | `05`, `07` | Includes all initial operation types and NOOP behavior. |
| Changesets include bounded snippets, hashes, ids, provenance, and risk | `06` | Avoid full-page duplication by default. |
| Source-consumption records are project state and run evidence only | `06` | No candidate/handoff status mutation. |
| Dry-run, review, invalid, rejected, quarantined, degraded, unsupported outputs stop before writes | `01`, `03`, `07` | Validation and service integration both enforce. |
| Run result/artifact/summary semantics distinguish stopped vs applied | `07` | Includes CLI JSON and human output tests. |
| Existing test drift around `stopped_before_writes` is corrected | `07`, `08` | Updated after behavior exists. |
| Documentation and roadmap reflect apply behavior | `08` | Final docs-only alignment. |

## Verification Strategy

Each chunk should use targeted Bun tests first, then broaden verification as integration expands.

Core commands:

```bash
bun test tests/project/project-memory-curator-validator.test.ts
bun test tests/project/project-memory-curator-service.test.ts
bun test tests/commands/project.test.ts
bun test
bun run typecheck
git diff --check
```

Expected pass signals:

- Targeted `bun test ...` exits `0`.
- Full `bun test` exits `0`.
- `bun run typecheck` exits `0`.
- `git diff --check` prints no whitespace errors.

New or expanded tests should live primarily in:

- `tests/project/project-memory-curator-validator.test.ts`
- `tests/project/project-memory-markdown-applier.test.ts`
- `tests/project/project-memory-curator-service.test.ts`
- `tests/project/project-memory-packet.test.ts`
- `tests/commands/project.test.ts`

## Risks And Sequencing Notes

- The trusted-state predicate is the main live-code conflict. Do not let `bootstrap-state.status === "curated"` alone authorize maintenance apply.
- Journal/recovery must be implemented before creation and maintenance apply are wired into `project learn`; otherwise partial writes become normal implementation debt.
- Creation and maintenance can share helpers, but neither mode should be deferred solely to reduce workload.
- Source-consumption records are intentionally not candidate/handoff status updates. Over-expanding this into queue lifecycle work violates the approved boundary.
- `ProjectMemoryCuratorRunResult` currently types `stopped_before_writes` as literal `true`; integration must widen that contract only when applied runs exist.
- Current creation test fixtures publish only an index page. Creation apply tests must add either a meaningful domain page or an explicit no-domain-pages rationale.

## Execution Handoff

Recommended next skill: `$pmp-executing-plans`.

Execution should load:

- `docs/design/2026-06-23-project-memory-markdown-apply/plan.md`
- the selected chunk plan files after they are written
- `docs/design/2026-06-23-project-memory-markdown-apply/spec.md`
- `docs/design/2026-06-23-project-memory-markdown-apply/agenda.md`
- `docs/design/2026-06-23-project-memory-markdown-apply/pseudocode/`
- `CONTEXT.md`
- ADRs `0018`, `0019`, `0020`, `0058`, `0059`, and `0060`

Recommended execution modes:

- execute one chunk
- execute selected chunks
- execute all chunks in dependency order

Execution must stop on unclear plan steps, failed verification, code/spec conflict, missing dependencies, or user-requested changes.

## User Approval

Roadmap approved by the user. Chunk plan files have been written and are ready for implementation.
