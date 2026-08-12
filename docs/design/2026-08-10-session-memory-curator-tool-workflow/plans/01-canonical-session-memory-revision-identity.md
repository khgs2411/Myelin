# Chunk 01: Pre-Migration Firewall And Canonical Revision Identity

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Rolling Global Audit, Data And State, Migration And Compatibility
**Status:** Approved for Execution
**Depends on:** None
**Enables:** Chunks 02–15

## Goal

Migration 16 atomically installs and closes a SQLite-enforced legacy-write firewall before any
incompatible Session schema change, then backfills authoritative `(id, revision, state_digest)`
identity. Every permitted current-runtime write carries a narrow transaction-scoped admission.

## Source Artifacts And Constraints

- ADR 0070 requires revision/digest identity for snapshot, resume, audit, and finalization.
- `src/memory/migrations.ts` owns root SQLite migrations. Firewall schema, closed state, final-table
  triggers, revision rebuild/backfill, and version 16 are one transaction.
- `src/memory/session-memories.ts`, `session-memory-contexts.ts`, `session-memory-links.ts`, and
  `session-memory-repair-service.ts` are current canonical writers.
- `src/session-maintenance/commit.ts` is a current writer that must preserve the invariant until its
  production ownership is retired in Chunk 15.
- The firewall protects old `ingest_jobs` lifecycle/PID DML, tombstone lease/reassign/finalize, raw
  evidence deletion, canonical memory/context/link DML, and initial Session embedding registration.
  Experience Log capture inserts remain allowed.
- Trusted admission is uncommitted state on the same SQLite connection/transaction, bound to exact
  operation, project-or-scope, owner, and epoch. It has no public/CLI/provider/hook mint.
- Migration 16 uses a private migration-only admission in its own transaction after closure; that
  authority cannot be constructed or reused by runtime code.
- Derived embedding rebuilds do not change canonical revision identity.
- Tests are authorized for this approved workflow. No installation, Git history, or Project Memory
  behavior is in scope.

## Relationships

- Produces `SessionMemoryLegacyWriteFirewall`, `SessionMemoryWriteAdmission`, the protected-operation
  matrix, and `SessionMemoryRevisionIdentity`.
- Chunk 02 binds project ownership to the admission; Chunk 03 binds global embedding ownership.
- Chunk 12 reuses the same mutation primitive inside atomic promotion.

## File Responsibility Map

**Create:**
- `src/memory/session-memory-write-firewall.ts` — internal admission mint/assert/revoke, protected
  operation vocabulary, and migration/runtime probes.
- `src/memory/session-memory-revisions.ts` — canonical serialization, digest calculation, revision
  reads, and transaction-local revision advancement.
- `tests/memory/session-memory-write-firewall.test.ts` — exact old/current runtime and connection
  isolation coverage.
- `tests/memory/session-memory-revisions.test.ts` — canonicalization and mutation-invariant coverage.

**Modify:**
- `src/memory/migrations.ts` — migration 16 installs/closes firewall first, rebuilds protected tables
  as required, reinstalls final-schema triggers, backfills identity, and rejects incomplete state.
- `src/memory/ingest-types.ts` — expose the two authoritative columns on `SessionMemoryRow`.
- `src/memory/session-memories.ts` — create and lifecycle mutations use the revision helper.
- `src/memory/session-memory-contexts.ts` — context-set mutation advances the owning memory once.
- `src/memory/session-memory-links.ts` — link-set mutation advances each affected memory once.
- `src/memory/session-memory-repair-service.ts` — repair is transactionally revision-aware.
- `src/session-maintenance/commit.ts` — current compatibility writer maintains the identity.
- `src/ingest/jobs.ts`, `src/memory/experience.ts`, and Session embedding-contract registration —
  current-runtime compatibility writes acquire the narrow operation-specific admission.
- `src/memory/embedding-contract-store.ts` — guard Session-scoped insert/update/delete through
  `register_session_embedding_contract` or `session_embedding_lifecycle`; Project rows are unchanged.

**Test:**
- `tests/memory/session-memories.test.ts`
- `tests/memory/session-memory-repair-service.test.ts`
- `tests/ingest/worker.test.ts`
- `tests/memory/db.test.ts`

## Behavioral And Contract Changes

- `session_memories.revision` is a positive monotonic integer; existing rows backfill to `1`.
- `session_memories.state_digest` is `sha256:<hex>` over canonical JSON schema version `1` with this
  exact shape:
  - `memory`: `memory_kind`, nullable `title`, `summary`, recursively key-sorted parsed `payload_json`,
    `confidence`, and `risk`;
  - `provenance`: nullable `provider`, `provider_session_id`, and `ingest_job_id`, plus a sorted unique
    array parsed from `source_event_refs_json`;
  - `lifecycle`: `status`, nullable `superseded_by`, `lifecycle_reason`, `superseded_at`, and
    `retracted_at`;
  - `contexts`: all rows as `{repo_path, git_branch, git_commit, git_worktree_id,
    source_event_ref}`, with explicit nulls, sorted by the canonical tuple of those five fields;
  - `links`: every incoming and outgoing incident link as `{direction, other_memory_id,
    relationship, reason, source_event_refs}`, with explicit nulls/sorted unique source refs, sorted
    by the canonical tuple of those fields.
- The digest excludes memory/project IDs (already carried by the external identity), `revision`,
  `state_digest`, `created_at`, `updated_at`, generated context/link row IDs and timestamps,
  embeddings, index state, and query logs. JSON normalization preserves array order inside payloads,
  represents missing optional canonical fields as explicit nulls, and rejects non-JSON/non-finite
  values rather than stringifying them differently.
- One logical mutation transaction advances an affected memory once, even when it changes several
  canonical tables. A failed transaction changes neither canonical data nor identity.
- New memory creation stores revision `1`. When the same logical create operation also creates
  contexts/links, it writes the complete graph in one transaction and computes the final digest
  once before commit; it does not increment to revision 2. Context/link changes in later logical
  operations increment normally.
- An embedding row, query log, or indexing-status change is explicitly excluded from the digest.
- Closed firewall is the default after migration 16. A protected statement succeeds only when its
  connection has an exact uncommitted admission for that operation/scope/owner/epoch. Committed,
  cloned, cross-connection, stale, broader, or mismatched admissions fail.
- The protected matrix is exhaustive and test-owned: old capture `INSERT experience_events` is
  allowed; old raw evidence `DELETE`, lifecycle/PID/job DML, lease/tombstone DML, canonical DML, and
  initial Session contract registration are denied. If old apply writes outputs before its terminal
  tombstone mutation, that denial rolls the whole transaction back.
- Exact matrix:

| Table | Verb / predicate | Runtime admission operation(s) |
| --- | --- | --- |
| `ingest_jobs` | `INSERT` | `compat_job_create`, `anchor_prepare` |
| `ingest_jobs` | `UPDATE` | `compat_job_transition`, `migrate_legacy_anchor`, `anchor_resume`, `anchor_finalize`, `anchor_abandon` |
| `ingest_jobs` | `DELETE` | none; reject and retain compact job audit identity |
| `experience_event_tombstones` | `INSERT` | `compat_event_lease`, `anchor_prepare` |
| `experience_event_tombstones` | `UPDATE` | `compat_event_lease`, `migrate_legacy_anchor`, `anchor_resume`, `anchor_finalize`, `anchor_abandon` |
| `experience_event_tombstones` | `DELETE` | none; reject and retain terminal/forensic tombstones |
| `experience_events` | `INSERT` | always allowed for capture |
| `experience_events` | all `UPDATE` | none; reject |
| `experience_events` | all `DELETE` | `compat_event_finalize`, `anchor_finalize` |
| `session_memories`, `session_memory_contexts`, `session_memory_links` | all `INSERT/UPDATE/DELETE` | `compat_canonical_apply`, `repair_session_memory`, `anchor_finalize` |
| `embedding_contracts` | `INSERT` with `NEW.scope='session_memory'` | `register_session_embedding_contract`, `session_embedding_lifecycle` |
| `embedding_contracts` | `UPDATE` touching old or new Session scope; `DELETE` of Session scope | `session_embedding_lifecycle` |

  Every operation also requires its exact project/scope, owner, epoch, and phase. Project embedding
  rows are outside this Session slice. Migration-only admission is valid solely in migration 16.
- A denied legacy job may later be the target of quarantine/abandonment under a different trusted
  admitted authority; it can never supply its own authority.

## Implementation Tasks

- [ ] Verify the frozen matrix above against exact pre-firewall SQL and current trusted callers;
      changes require design review, not executor invention. Install admission state and
      connection-local enforcement before protected DML can succeed. Prove another SQLite
      connection cannot observe or piggyback admission.
- [ ] Implement migration 16 in this order inside one transaction: create admission/firewall state;
      close legacy writes; mint private migration-only admission; install guards on pre-rebuild
      tables; rebuild/backfill revision identity;
      install guards on final table names/shapes; probe every protected operation; record version.
      Any failure leaves the version-15 schema and no partially authoritative firewall.
- [ ] Define `SessionMemoryRevisionIdentity`, canonical state version `1`, deterministic JSON
      normalization, `readSessionMemoryCanonicalState`, and `advanceSessionMemoryRevisionInOpenTransaction`
      in `session-memory-revisions.ts`. Require callers to provide an open transaction and deduplicate
      affected IDs before recomputation.
- [ ] Route current-runtime job/lease/evidence/canonical/initial-Session-contract compatibility writes
      through internal operation-specific admissions. Route create, supersede, retract, context,
      link, repair, and compatibility commit through the revision accumulator. Do not expose a
      generic admission token or relax capture inserts.
- [ ] Add populated-database and writer-class tests proving stable digest calculation, exact revision
      increments, rollback isolation, embedding non-effects, and final trigger presence.
- [ ] Add deterministic barriers around exact old-runtime execution: held-open pre-migration
      connection; launcher paused pre-spawn; child spawned pre-PID; leased worker returning from the
      provider. In every case protected mutation is denied and the old apply transaction rolls back.

## Verification

- `bun test tests/memory/session-memory-write-firewall.test.ts tests/memory/session-memory-revisions.test.ts tests/memory/session-memories.test.ts tests/memory/session-memory-repair-service.test.ts tests/ingest/worker.test.ts`
  — protected-operation matrix, connection isolation, exact old-runtime barriers, old-apply rollback,
  and canonical revision invariants pass.
- `bun test tests/memory/db.test.ts`
  — passes against a populated version-15 fixture; schema migration row `16` exists after success,
  `PRAGMA foreign_key_check` returns no rows, and `PRAGMA integrity_check` returns `ok`. Final-schema
  guard triggers exist after rebuild. Injected failure leaves no version-16 row, firewall residue, or
  partially authoritative table rebuild.
- `bun run typecheck` — exits 0 with the additive row contract.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- Old Session mutation is DB-denied before incompatible migration begins; capture append remains live.
- Trusted current-runtime writes require exact transaction-bound admission.
- Authoritative memory revision is `(memory_id, revision, state_digest)`.
- Payload, lifecycle, context, and link changes invalidate prior audit coverage.
- Populated migration is deterministic, atomic, and integrity-checked.

## Risks, Rollback, And Isolation

- Trigger loss during SQLite table rename/rebuild would reopen old writes. Reinstall and probe guards
  against final table identities before recording migration 16.
- Canonicalization drift would invalidate receipts unpredictably. Freeze the version and test
  equivalent JSON/order variants.
- A migration failure must roll back the migration transaction and leave the prior schema/version
  authoritative. No later chunk may assume the columns until this chunk passes.

## Non-Goals

- Project/global ownership policy, authority activation/quarantine, audit receipts, or SMC orchestration.

## Consistency Check

- Confirm the new migration version follows the current highest version in `migrations.ts`.
- Confirm schema version `1` fixtures cover explicit nulls, parsed-object key order, preserved payload
  array order, sorted source refs, both link directions, generated-row-ID/timestamp exclusion, and
  create-with-context/link revision `1`.
- Confirm every direct write to `session_memories`, `session_memory_contexts`, and
  `session_memory_links` is either routed through the helper or migration-only.
- Confirm every protected old SQL statement and current admitted equivalent appears in the matrix;
  confirm no public export can mint admission.
- Confirm `SessionMemoryRow` consumers compile with required `revision` and `state_digest` fields.

## Execution Notes

### 2026-08-11: Reopened Chunk Accepted

- Migration 16 now installs, closes, and probes the frozen firewall matrix before final schema
  replacement and version commit. Admissions are transaction-local, non-committable, and
  semantically validated against durable project/global authority as later migrations add it.
- A frozen version-15 harness proves pre-spawn, post-spawn/pre-PID, PID-null child, and provider-
  return denial, including rollback of an earlier unguarded candidate write.
- Independent review accepted the chunk after verifying that anchor canonical writes require the
  durable `finalizing` phase. Focused acceptance: 84 tests, 458 assertions, zero failures;
  `git diff --check` passed. Remaining worker/typecheck failures belong to partial Chunk 04.

### 2026-08-11: Reopened By Approved Migration Correction

- The original revision implementation and review remain useful evidence but are not sufficient.
  Migration 16 must be revised so the firewall closes before its table rebuild/backfill, and every
  protected current-runtime compatibility writer must acquire a narrow SQLite admission.
- Preserve accepted revision/digest behavior while implementing and re-reviewing this expanded
  chunk; do not treat the prior acceptance as authorization to skip the new barrier matrix.

### 2026-08-11: Accepted Local Drift

- **Planned shape:** The file map names `src/session-maintenance/commit.ts` as the compatibility
  writer and includes `tests/ingest/worker.test.ts` in verification, but does not name
  `src/ingest/worker.ts` as a modified file.
- **Current repository evidence:** Exported compiled compatibility writer
  `applyIngestWorkerOutput` in `src/ingest/worker.ts` performs create-plus-context and
  lifecycle-plus-link logical mutations directly through the canonical helpers.
- **Why equivalent:** Passing the shared transaction-local affected-memory accumulator through this
  existing writer is required to preserve the approved exactly-once revision invariant; it does not
  change product behavior, public contracts, chunk boundaries, or later cutover ownership.
- **Implementation used:** Modify only the canonical mutation calls inside
  `applyIngestWorkerOutput` while preserving all existing dirty-worktree changes.
- **Verification:** Run the approved `tests/ingest/worker.test.ts` slice and confirm create-with-context
  remains revision 1 while lifecycle-plus-link advances the affected existing memory once.
