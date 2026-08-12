# Agentic Ingest And Memory Candidate Queue Implementation Plan Set

**Spec:** `spec.md`
**Agenda:** `agenda.md`
**Context:** `../../../CONTEXT.md`
**ADRs:** `../../adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`
**Status:** Chunk Plans Written

## Goal

Implement top-level `myelin ingest <project-key>` as a detached, target-repo agentic workflow that turns Experience Log rows into trusted Session Memory, session candidates, and downstream layer handoff instructions while keeping capture non-agentic, preserving tombstone auditability, and keeping the existing `project ingest <key>` source/inbox pipeline separate.

## Source Artifacts

- `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/spec.md`
- `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/agenda.md`
- `CONTEXT.md`
- `MYELIN.md`
- `AGENTS.md`
- `docs/adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`
- Code paths inspected:
  - `src/cli.ts`
  - `src/commands/registry.ts`
  - `src/commands/project.ts`
  - `src/commands/memory.ts`
  - `src/commands/session.ts`
  - `src/commands/status.ts`
  - `src/inbox/auto-update.ts`
  - `src/memory/db.ts`
  - `src/memory/migrations.ts`
  - `src/memory/experience.ts`
  - `src/memory/sessions.ts`
  - `src/runtime/bootstrap.ts`
  - `src/runtime/projects.ts`
  - `src/runtime/llm-client.ts`
- Test/validation commands discovered:
  - `bun test`
  - `bun run typecheck`
  - `git diff --check`

## Design Readiness Check

- Source artifact paths verified: Pass.
- Missing or unavailable artifacts: None.
- Open agenda questions or risks: None that change roadmap chunk boundaries. The external re-audit recorded ADR 0056 inclusion as a non-blocking staging/source-set note.
- Spec / agenda / context / ADR consistency: Pass. External re-audit returned `Ready for Development`, interpreted as ready for `$pmp-writing-plans`.
- Parent / child spec consistency: Not applicable. No child specs or agendas exist in this design folder.
- Accepted planning reconciliations: None beyond the already-applied audit refinements recorded in `agenda.md`.
- Blockers: None.

## Unresolved Decision Ownership

| Item | Type | Owning Chunk | Must Resolve Before | Notes |
| --- | --- | --- | --- | --- |
| ADR 0056 must remain part of the implementation source set | Non-blocking source-set risk | `07-docs-validation-and-source-set.md` | Implementation steps in owning chunk | ADR 0056 exists but was untracked during audit; planning and execution must not omit it. |
| Full retry daemon, cancellation, scheduler, and multi-agent worker pool are deferred | Deferred implementation decision | `03-ingest-job-runtime.md` | Implementation steps in owning chunk | Chunk 03 must preserve the v1 one-worker default and avoid accidental scheduler scope. |
| SQLite VEC and embedding-backed Session Memory retrieval are deferred | Deferred implementation decision | `07-docs-validation-and-source-set.md` | Implementation steps in owning chunk | Ingest writes canonical `session_memories`; retrieval/indexing belongs to a later MCP/query slice. |
| Status/current-briefing integration with `session_memories` is deferred | Deferred implementation decision | `07-docs-validation-and-source-set.md` | Implementation steps in owning chunk | This plan writes trusted Session Memory and exposes ingest status, but does not redesign the existing `status` facade or current briefing surfaces to read `session_memories`. |
| Candidate provenance and tombstone finalization are first-class data-integrity contracts | Accepted audit refinement | `01-storage-schema-contracts.md`, `04-memory-output-repositories.md`, `05-ingest-agent-orchestration.md` | Implementation steps in owning chunks | Candidates store `source_event_refs_json`; provider candidate outputs include `source_event_refs`; one tombstone may reference multiple outputs but is finalized once with aggregate output references. |

## Approved Chunks

| Chunk | Purpose | Depends On | Enables | Status |
| --- | --- | --- | --- | --- |
| [`01-storage-schema-contracts.md`](plans/01-storage-schema-contracts.md) | Add the SQLite schema contracts and low-level typed helpers for `ingest_jobs`, `session_memories`, `memory_candidates`, layer handoff queues, and revised tombstone fields. Boundary: storage only, no detached process orchestration. | None | [`02-experience-log-claim-finalize.md`](plans/02-experience-log-claim-finalize.md), [`03-ingest-job-runtime.md`](plans/03-ingest-job-runtime.md), [`04-memory-output-repositories.md`](plans/04-memory-output-repositories.md) | Written |
| [`02-experience-log-claim-finalize.md`](plans/02-experience-log-claim-finalize.md) | Replace terminal-only tombstoning with atomic pull/claim and job-completion finalization semantics while preserving dedupe and replay behavior. Boundary: Experience Log queue mechanics only. | [`01-storage-schema-contracts.md`](plans/01-storage-schema-contracts.md) | [`05-ingest-agent-orchestration.md`](plans/05-ingest-agent-orchestration.md) | Written |
| [`03-ingest-job-runtime.md`](plans/03-ingest-job-runtime.md) | Implement Myelin-owned ingest job lifecycle, target repo resolution, `master` branch preflight, detached provider launch, logging, and status transitions. Boundary: job/process runtime only; the agent contract remains separate. | [`01-storage-schema-contracts.md`](plans/01-storage-schema-contracts.md) | [`05-ingest-agent-orchestration.md`](plans/05-ingest-agent-orchestration.md), [`06-operator-cli-surfaces.md`](plans/06-operator-cli-surfaces.md) | Written |
| [`04-memory-output-repositories.md`](plans/04-memory-output-repositories.md) | Implement write/list helpers for trusted Session Memory, Memory Candidates, and Project/Practice/Personal handoff instructions, including candidate status normalization. Boundary: output repositories and validation, not provider execution. | [`01-storage-schema-contracts.md`](plans/01-storage-schema-contracts.md) | [`05-ingest-agent-orchestration.md`](plans/05-ingest-agent-orchestration.md), [`06-operator-cli-surfaces.md`](plans/06-operator-cli-surfaces.md) | Written |
| [`05-ingest-agent-orchestration.md`](plans/05-ingest-agent-orchestration.md) | Define the bounded ingest agent prompt/tool bridge and orchestration loop: pull batches, let the agent decide outputs, write via Myelin helpers, finalize tombstones, and stop when the queue is empty. Boundary: one detached ingest agent by default; no scheduler or multi-agent pool. | [`02-experience-log-claim-finalize.md`](plans/02-experience-log-claim-finalize.md), [`03-ingest-job-runtime.md`](plans/03-ingest-job-runtime.md), [`04-memory-output-repositories.md`](plans/04-memory-output-repositories.md) | [`06-operator-cli-surfaces.md`](plans/06-operator-cli-surfaces.md), [`07-docs-validation-and-source-set.md`](plans/07-docs-validation-and-source-set.md) | Written |
| [`06-operator-cli-surfaces.md`](plans/06-operator-cli-surfaces.md) | Add top-level `myelin ingest`, `myelin ingest status`, and candidate list/show commands without coupling them to `myelin project ingest`. Boundary: operator surfaces only. | [`03-ingest-job-runtime.md`](plans/03-ingest-job-runtime.md), [`04-memory-output-repositories.md`](plans/04-memory-output-repositories.md), [`05-ingest-agent-orchestration.md`](plans/05-ingest-agent-orchestration.md) | [`07-docs-validation-and-source-set.md`](plans/07-docs-validation-and-source-set.md) | Written |
| [`07-docs-validation-and-source-set.md`](plans/07-docs-validation-and-source-set.md) | Align docs/source artifacts, preserve ADR 0056 in the implementation source set, and run full repo verification. Boundary: docs, final validation, and source-set hygiene; no new product behavior. | [`01-storage-schema-contracts.md`](plans/01-storage-schema-contracts.md) through [`06-operator-cli-surfaces.md`](plans/06-operator-cli-surfaces.md) | Execution handoff | Written |

## Dependency Order

1. `01-storage-schema-contracts.md`
2. `02-experience-log-claim-finalize.md` and `04-memory-output-repositories.md` can proceed after Chunk 01 and are mostly parallel.
3. `03-ingest-job-runtime.md` can proceed after Chunk 01 and can run in parallel with Chunks 02 and 04.
4. `05-ingest-agent-orchestration.md` depends on Chunks 02, 03, and 04.
5. `06-operator-cli-surfaces.md` depends on Chunks 03, 04, and 05.
6. `07-docs-validation-and-source-set.md` runs last.

## Shared Contracts

- Public command split:
  - `myelin project ingest <key>` remains queued source/inbox processing.
  - `myelin ingest <project-key>` starts detached Experience Log to Session Memory processing.
  - `myelin ingest status <ingest-job-id>` reports durable job state.
- Storage contracts:
  - `ingest_jobs` owns detached lifecycle state and provider session metadata.
  - `session_memories` owns trusted agent-written Session Memory.
  - `memory_candidates` owns proposed review/processing outputs.
  - Memory Candidates store first-class `source_event_refs_json`; `evidence_json` carries bounded review evidence, not the only source-reference contract.
  - `project_handoff_instructions`, `practice_handoff_instructions`, and `personal_handoff_instructions` own downstream layer-agent inputs.
  - `experience_event_tombstones` must support pull/claim and finalization, not only terminal tombstones.
  - One tombstone may be referenced by multiple outputs from the same provider batch, but it is finalized once with an aggregate `output_references_json` list.
- Status values:
  - Stored candidate statuses use underscore enum values such as `needs_review`.
  - CLI filters may accept hyphenated aliases such as `needs-review`, but JSON/state output returns stored enum values.
- Runtime contracts:
  - The target repo must be on `master` before provider launch or row claim.
  - Non-`master` creates or updates a failed `ingest_jobs` record and pulls no rows.
  - V1 runs one detached ingest agent by default.
  - `--limit N` limits claimed Experience Log rows, not batches or outputs.
  - `provider_session_id` stores provider metadata only. Local process ids and log paths belong in `followup_state_json`.

## Spec Coverage Map

| Spec Requirement | Covered By | Notes |
| --- | --- | --- |
| Detached top-level `myelin ingest <project-key>` with durable handle | `03-ingest-job-runtime.md`, `06-operator-cli-surfaces.md` | Runtime owns job state; CLI exposes it. |
| Keep `project ingest <key>` separate from top-level `ingest` | `06-operator-cli-surfaces.md`, `07-docs-validation-and-source-set.md` | Command registry and docs must preserve the split. |
| Run ingest agent from target repo cwd on `master` | `03-ingest-job-runtime.md`, `05-ingest-agent-orchestration.md` | Branch failure happens before provider launch or row claim. |
| Atomic pull-to-tombstone queue drain | `01-storage-schema-contracts.md`, `02-experience-log-claim-finalize.md` | Includes failed/unfinished finalization semantics. |
| Trusted Session Memory in `session_memories` | `01-storage-schema-contracts.md`, `04-memory-output-repositories.md` | Existing `sessions` / `session_events` remain manual surface. |
| Memory Candidate queue, first-class source refs, and status normalization | `01-storage-schema-contracts.md`, `04-memory-output-repositories.md`, `05-ingest-agent-orchestration.md`, `06-operator-cli-surfaces.md` | Includes CLI alias behavior and tombstone provenance. |
| Separate Project/Practice/Personal handoff queues | `01-storage-schema-contracts.md`, `04-memory-output-repositories.md`, `05-ingest-agent-orchestration.md` | No first-slice handoff CLI unless required by implementation feedback. |
| Agent decides output shape and granularity | `05-ingest-agent-orchestration.md` | Myelin provides tools and constraints, not fixed memory counts. |
| One-hop ingest only; no recursive higher-layer agents | `05-ingest-agent-orchestration.md` | Handoff instructions only. |
| Candidate list/show review commands | `06-operator-cli-surfaces.md` | `reject` may be included only if required by helper lifecycle; list/show are required by spec. |
| Privacy and bounded raw retention | `02-experience-log-claim-finalize.md`, `04-memory-output-repositories.md`, `05-ingest-agent-orchestration.md` | Avoid complete raw transcript duplication by default. |
| Repo-native validation and tests | `01-storage-schema-contracts.md` through `07-docs-validation-and-source-set.md` | Each chunk must include targeted Bun tests plus typecheck where relevant. |

## Verification Strategy

- Use `bun test` as the broad behavioral test suite.
- Use targeted Bun tests during chunk execution:
  - `src/memory/db.test.ts` for migrations.
  - `src/memory/experience.test.ts` for claim/finalize and dedupe behavior.
  - new memory repository tests for jobs, candidates, handoffs, and session memories.
  - command tests under `src/commands/*.test.ts` for top-level `ingest`, status, and candidate surfaces.
  - runtime/provider tests around detached spawn and branch preflight.
- Use `bun run typecheck` after code-changing chunks.
- Use `git diff --check` after doc and code edits.
- Provider execution tests should use stubs/fakes; the first implementation plan must not require a live Codex or Claude session in CI.

## Risks And Sequencing Notes

- Tombstone lifecycle is the highest data-integrity risk. It must be schema- and transaction-tested before agent orchestration exists, and Chunk 05 must apply provider outputs plus tombstone finalization in one transaction.
- Detached provider execution is the highest runtime risk. Keep job lifecycle and detached spawn behavior isolated before adding agent prompt/tool behavior.
- The CLI split is subtle. Tests must prove `project ingest` still routes to the existing pipeline while top-level `ingest` uses the new detached workflow.
- Handoff queues should stay internal/facade-facing in this slice unless implementation reveals a concrete inspection need.
- SQLite VEC, embeddings, Practice/Personal canonical homes, full retry daemon, cancellation, and multi-agent worker pool remain out of scope.

## Execution Handoff

Recommended next skill: `$pmp-executing-plans`.

Execution should load:

- `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plan.md`
- selected chunk plan files under `docs/design/2026-06-12-experience-log-drain-memory-candidate-queue/plans/`
- source artifacts listed above

Recommended execution modes:

- execute one chunk
- execute selected chunks
- execute all chunks in dependency order

Execution must stop on unclear plan steps, failed verification, code/spec conflict, missing dependencies, or user-requested changes.

## User Approval

Roadmap was approved by the user before chunk plan generation. Chunk plan files are written and ready for review or execution selection.
