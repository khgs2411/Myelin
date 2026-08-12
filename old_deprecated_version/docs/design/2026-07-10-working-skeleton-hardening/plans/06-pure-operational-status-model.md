# Chunk 06: Pure Operational Status Model

**Plan Set:** ../plan.md
**Approved Source:** ../spec.md
**Status:** Ready for Review
**Depends on:** Chunks 02 and 04
**Enables:** Chunk 07

## Goal

Build a compositional, strictly read-only operational status model for installation, Session Memory, and Project Memory. Centralize lifecycle normalization, exact severity rules, lock coherence/liveness, warnings/actions/evidence, and overall aggregation without invoking any mutating refresh, cleanup, retry, or scheduler path.

## Source Artifacts And Constraints

- Implement every row of the source-to-severity table in `../spec.md`.
- Operational states are exactly `healthy`, `attention`, and `blocked`; source-specific lifecycle strings remain separate.
- Section-level unknown facts remain visible and aggregate according to whether they are required.
- Lock staleness is coherence/liveness-based, not age-based.
- Use only read-only SQLite queries, file reads/stats, and PID probes.
- Do not call mutating `IngestService.status()`, detached-job refresh, lock cleanup, maintenance scheduling, or index repair.
- Content/hash comparison is authoritative purity evidence; mtime is secondary.
- Chunk 07 owns CLI rendering and exact public serialization.

## Relationships

- Uses authoritative root/project resolution from Chunk 02 and locator/provider ownership facts from Chunk 04.
- Runs safely in parallel with Chunk 05 because it does not modify worker or scheduler files.
- Hands one normalized result model to Chunk 07 for human and JSON parity.

## File Responsibility Map

### Create

- `src/status/contracts.ts` — internal normalized section, warning, action, evidence, lifecycle, and severity types.
- `src/status/installation-inspector.ts` — pure locator/root/launcher/provider ownership observation.
- `src/status/session-memory-inspector.ts` — pure queue/job/maintenance/lock/retrieval observation.
- `src/status/project-memory-inspector.ts` — pure inbox/candidate/maintenance/curation/retrieval observation.
- `src/status/lock-inspector.ts` — shared ownership-coherence and PID-liveness classification.
- `src/status/severity.ts` — source-specific normalization and deterministic section/overall aggregation.
- `tests/status/status-inspectors.test.ts`
- `tests/status/operational-status-service.test.ts`

### Modify

- `src/status/status-service.ts` — replace shallow facade assembly with pure inspector composition and normalized result construction.
- `tests/status/status-service.test.ts` — retain project identity coverage and remove assumptions tied to shallow fields.

### Inspect And Consume

- `src/ingest/status.ts` and `src/ingest/jobs.ts` — queue/job/tombstone facts and stored process metadata.
- `src/memory/experience.ts` and `src/memory/candidates.ts` — leased/unleased Experience Log rows and project candidate states.
- `src/maintenance/auto-memory-maintenance.ts` and `src/maintenance/auto-project-memory-maintenance.ts` — persisted state/lock shapes only; never scheduling or write methods.
- `src/project/project-memory-agent-contracts.ts` and `projects/<key>/state/project-memory.json` — curation-state contract and on-disk evidence.
- `src/memory/session-memory-embeddings.ts`, `src/memory/project-memory-retrieval-storage.ts`, and `src/memory/project-memory-retrieval-index-service.ts` — retrieval storage/count semantics without retry/index mutation.
- `src/memory/db.ts` and current migrations — read-only database opening and required-table verification.

### Test

- `tests/status/status-inspectors.test.ts`
- `tests/status/operational-status-service.test.ts`
- `tests/status/status-service.test.ts`
- Relevant pure readers under `tests/ingest/status.test.ts`.

## Behavioral And Contract Changes

- Installation inspection validates locator schema/root, launcher existence/hash, and recorded provider paths without repair.
- Session inspection reports queued/unleased/leased events, running/failed jobs, terminal tombstones, latest log, automation configuration/state/lock, and indexed/pending/failed retrieval counts.
- Project inspection reports inbox pressure, pending/needs-review candidates, automation configuration/state/lock, curation agreement with canonical wiki/state, latest run, and retrieval counts.
- Running job with live PID is active; missing PID is `running_unverifiable`/attention; dead PID severity depends on stranded leased events and is not persisted.
- Lock is active only when owner run id equals state run id, state is scheduled/running, PID exists, and PID is alive. Any incoherence is stale/blocked; elapsed age is evidence only.
- Missing referenced logs are attention only; absent optional history is `never_run`/unknown as appropriate and never blocks alone.
- `needs_review > 0` is attention even below maintenance threshold.
- Warnings use stable codes and response-local evidence ids; deterministic remedies become exact actions.
- Overall state is blocked if any required section blocks, else attention if any section needs attention, else healthy.

## Implementation Tasks

- [ ] Inventory current SQLite tables and state-file shapes used by ingest, candidates, maintenance, curation, and retrieval; encode strict read-only adapters rather than tolerant mutating helpers.
  - Decision rule: consume the named read contracts above when pure; otherwise issue dedicated read-only SQL/file reads. Any helper that writes, reconciles, retries, schedules, or tolerantly repairs state is excluded.
- [ ] Add table-driven tests for every healthy/attention/blocked cell in the approved source-to-severity matrix.
- [ ] Add lock matrix tests for absent/idle, coherent live, malformed owner, mismatched run id, missing PID, dead PID, non-active state, and active state without lock.
- [ ] Add job tests for live PID, no PID, dead PID with and without leased events, failed job with and without leased events, and unreadable tables.
- [ ] Add Session and Project retrieval cases for not applicable/no active memory, usable plus pending/failed, no usable index, and unreadable storage.
- [ ] Add curation cases for uncurated registered project, coherent curated state, and contradictory/missing canonical wiki/state.
- [ ] Implement deterministic evidence registration and machine-absolute versus checkout-relative path normalization.
- [ ] Implement warning/action generation without secrets and without attempting remediation.
- [ ] Inject clock and PID probe for deterministic output; the production probe may call the exported pure `isProcessAlive` from `src/ingest/runtime.ts` but this chunk must not modify that Chunk 05-owned file or import its mutating refresh path.
- [ ] Capture database and inspected-file content hashes before and after status construction; assert unchanged contents and use mtime only as additional evidence.
- [ ] Assert status observation creates no new SQLite `-wal`, `-shm`, or `-journal` sidecar files in the fixture directory.
- [ ] Add a guard test or dependency shape proving status cannot reach job refresh, lock removal, index retry, or maintenance scheduling.

## Verification

- `bun test tests/status/status-inspectors.test.ts tests/status/operational-status-service.test.ts tests/status/status-service.test.ts tests/ingest/status.test.ts`
  - Expected: every severity/lock/job/retrieval/curation matrix case passes.
- `rg -n "refreshDetachedIngestJobStatus|IngestService|unlink|rm\(|writeFile|rename|schedule|retry" src/status`
  - Expected: no mutating production dependency is reachable from status; incidental words in diagnostics are reviewed.
- Inspect the status fixture directory before and after the focused suite.
  - Expected: database/state contents and hashes are unchanged and no SQLite sidecar file is newly created.
- `bun run typecheck`
  - Expected: lifecycle and severity mappings are exhaustive.
- `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- One read-only view covers installation, Session Memory, Project Memory, maintenance, queues, jobs, locks, curation, logs, and retrieval.
- Exact source-to-severity and lock-liveness rules are deterministic.
- Dead processes and unreadable sources are observed without persistence.
- Status leaves SQLite and inspected file contents unchanged.

## Risks, Rollback, And Isolation

- Risk: reusing a convenient current service may mutate job state. Prefer small raw readers and dependency guards.
- Risk: lifecycle strings drift. Centralize them in `severity.ts` before public fixtures freeze them.
- Risk: broad unknown handling can hide required failures. Each inspector must label the missing fact and its required/optional role.
- Rollback removes only read-model code; no state migration or write occurs.

## Non-Goals

- Human formatting, public JSON serialization, or CLI exit behavior.
- Repair, scheduling, retries, or lock cleanup.
- Current Briefing, semantic query routing, or MCP exposure.
- Background invocation changes owned by Chunk 05.

## Consistency Check

- Covers the complete approved severity matrix and read-only boundary.
- Preserves parallel isolation from Chunk 05 and sequential handoff to Chunk 07.
- Creates no cached health database or second operational truth.

## Execution Notes

### 2026-07-10: Accepted Local Drift

- **Planned shape:** Open the root SQLite file directly through a dedicated read-only connection.
- **Current repository evidence:** Bun's configured SQLite runtime creates `-wal`/`-shm` sidecars for a direct read-only file open, while `Database.deserialize(..., { readonly: true })` fails with `unable to open database file`.
- **Why equivalent:** Status needs the latest committed database plus any existing WAL state without writing beside the source database. A temporary snapshot of the database and existing WAL/SHM files preserves query semantics while all SQLite lock/sidecar activity stays outside the checkout.
- **Implementation used:** Copy source database bytes and existing WAL/SHM files into an isolated temporary directory, open that snapshot read-only with `PRAGMA query_only=ON`, validate required tables, then close and remove the snapshot.
- **Verification:** Focused status/ingest suites passed; source database hash and state-file contents remain unchanged; no new source `-wal`, `-shm`, or `-journal` files are created; typecheck passed.
