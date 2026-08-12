# Chunk 06: Atomic Complete Manifest And Frozen Retrieval Snapshot

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Immutable Job Manifest; Job-Scoped Memory View; Curator Retrieval Contract
**Status:** Approved for Execution
**Depends on:** Chunks 01, 03, 04, 05
**Enables:** Chunks 07–15

## Goal

In one admitted `BEGIN IMMEDIATE`, create the anchor/fence, lease and copy all planned evidence, persist its
batches/no-agent intents, copy every retrieval-affecting active-memory/vector row, prove complete
coverage, and commit one complete curator-ready manifest or nothing.

## Source Artifacts And Constraints

- Reuse firewall admission/revision identity from Chunk 01 and the evidence plan from Chunk 05.
- `src/session-maintenance/snapshot.ts` currently hashes all active memory in-process; it is a source
  for canonical state selection but not the scalable persisted target.
- `src/memory/session-memory-text.ts`, `session-memory-embeddings.ts`, and embedding contract stores
  own normalized text/vector identities.
- Snapshot creation occurs while the project fence excludes canonical writes and the global fence
  excludes contract changes.
- Missing or mismatched semantic coverage blocks before provider execution. No later live hydration
  is allowed.
- Any required derived indexing runs and succeeds before this transaction begins. The transaction
  rechecks the active embedding identity and full vector coverage while global/project admission is
  serialized; it never persists an incomplete manifest as a checkpoint.
- This chunk exposes preparation for direct deterministic tests and downstream trusted services but
  does not enable manual/automatic production starts or launch any worker. The stable
  `smc_preparation_not_available` entrypoint remains through Chunk 11.

## Relationships

- Produces the first ordinary new-format anchor: one `ingest_jobs` compatibility handle plus its
  authoritative companion `preparing` phase, complete `SMCManifest`, immutable evidence/batch/
  no-agent rows, project ownership, base rows, and `SMCRetrievalSnapshotIdentity`.
- Chunk 09 builds query receipts over these rows; Chunk 12 compares them to live canonical state.

## File Responsibility Map

**Create:**
- `src/session-maintenance/preparation-service.ts` — the sole complete-manifest immediate transaction.
- `src/session-maintenance/manifest.ts` — complete manifest schema, identities/digests, and reads;
  there is no durable incomplete/ready toggle.
- `src/session-maintenance/evidence-snapshot.ts` — revalidate/lease/copy the Chunk 05 evidence plan
  inside the preparation transaction.
- `src/session-maintenance/memory-snapshot.ts` — normalized snapshot copy, aggregate token, and live
  drift assertion.
- `src/session-maintenance/retrieval-snapshot.ts` — normalized text/vector copy and completeness proof.
- `tests/session-maintenance/preparation-service.test.ts`
- `tests/session-maintenance/manifest.test.ts`
- `tests/session-maintenance/evidence-snapshot.test.ts`
- `tests/session-maintenance/memory-snapshot.test.ts`
- `tests/session-maintenance/retrieval-snapshot.test.ts`

**Modify:**
- `src/memory/migrations.ts` — migration `20`: complete manifest, frozen evidence/batches/no-agent
  intents, and job-owned memory/context/link/search-text/vector/completeness tables/indexes.
- `src/session-maintenance/snapshot.ts` — become a compatibility facade over canonical snapshot
  identity or retire duplicate token logic without changing the old caller yet.
- `src/memory/session-memory-text.ts` — expose deterministic normalization/hash primitive.
- `src/memory/session-memory-embeddings.ts` — expose exact active-contract vector reads by memory and
  normalized-text hash.
- `src/ingest/jobs.ts` and `src/session-maintenance/job-lifecycle.ts` — create the legacy-compatible
  job handle and authoritative companion phase only inside the complete preparation transaction.
- `src/memory/experience.ts` — transaction-local claim/copy/final-intent persistence; no terminal
  tombstone/raw-row mutation.

**Test:**
- `tests/memory/session-memory-embeddings.test.ts`
- `tests/memory/session-memory-text.test.ts`
- `tests/ingest/ingest-service.test.ts`

## Behavioral And Contract Changes

- The one transaction validates project authority, mints exact preparation admission, creates
  `ingest_jobs.status = 'starting'` as a
  compatibility handle plus `session_memory_anchor_jobs.phase = 'preparing'` as authority, revalidates the
  evidence plan, claims tombstones, copies exact evidence/batches/no-agent intents, copies memory/
  retrieval state, proves completeness, and inserts the complete manifest/digests.
- Snapshot rows contain memory revision/digest, payload/lifecycle fields, every context/link,
  normalized search text/hash, embedding contract identity, dimensions, vector bytes, and stable
  ordering.
- The aggregate snapshot token covers normalized rows and the active embedding contract. It does
  not depend on query logs or mutable filesystem artifacts.
- Semantic completeness means every semantically eligible active memory has exactly one matching
  vector under the frozen contract and normalized-text hash with correct dimensions.
- If any evidence identity/hash/eligibility, active memory, embedding contract/vector, or governing
  identity check fails, the transaction rolls back: no job, fence, lease, snapshot, batch, intent,
  or manifest remains. A hard kill immediately before commit has the same outcome.
- A permanently denied old job cannot prepare or own admission. Preparation may create only a new
  SMC anchor identity under current project authority.
- After commit, loss of the direct-service response leaves a complete `preparing` anchor owned by
  the fence; direct-service failure injection verifies the durable state here. Chunk 08 validates it
  but cannot production-resume it. Production start/resume remains blocked through Chunk 11;
  Chunk 12 alone replaces the blockers and owns first production launch/resume integration.
- Later canonical state is never substituted into this base. Finalization separately performs a
  live CAS/drift comparison.

## Implementation Tasks

- [ ] Add migration `20` for every complete-manifest/evidence/snapshot table with job-scoped foreign
      keys and uniqueness. No schema/state value may represent an accepted partial manifest.
- [ ] Implement `prepareSessionMaintenanceAnchor` as one immediate transaction covering job/fence,
      exact evidence-plan revalidation/lease/copy/batches/no-agent intents, all active memory/
      retrieval rows, completeness proof, governing identities, and aggregate digests.
- [ ] Bind that transaction to the exact project/owner/epoch `prepare_anchor` firewall admission;
      prove no denied old job, stale epoch, second connection, or global lifecycle owner can reuse it.
- [ ] Keep Chunk 04's `smc_preparation_not_available` public/manual/automatic start branch unchanged.
      Prove no production caller or detached runtime invokes preparation/launch in Chunks 06–10.
  Chunk 12 alone replaces the branch; no other service creates an ordinary companion phase.
- [ ] Implement a single consistent read/copy under the fence, deterministic aggregate hashing, and
      exact live-state drift assertion using `(id, revision, state_digest)` plus active ID set.
- [ ] Implement active-contract completeness proof over normalized-text hash, provider/model/
      dimensions, and vector presence. Return stable `session_retrieval_snapshot_incomplete` or typed
      provider-unavailability results without marking memory/evidence invalid.
- [ ] Add direct-service indexing-precondition and transaction failure injection immediately before
      commit and immediately after commit/return, plus 3,219-memory fixtures that inspect persisted
      rows without composing an all-memory provider envelope.

## Verification

- `bun test tests/session-maintenance/preparation-service.test.ts tests/session-maintenance/manifest.test.ts tests/session-maintenance/evidence-snapshot.test.ts tests/session-maintenance/memory-snapshot.test.ts tests/session-maintenance/retrieval-snapshot.test.ts tests/memory/session-memory-embeddings.test.ts tests/memory/session-memory-text.test.ts tests/ingest/ingest-service.test.ts tests/ingest/runtime.test.ts`
  — admission-bound preparation, denied/stale/cross-connection rejection, pre-commit zero-state
  rollback, post-commit same-job recovery state,
  complete snapshot, vector blockers, deterministic tokens, and no-live-hydration cases pass;
  production start remains `smc_preparation_not_available`, persists no anchor, and launches no PID.
- `bun test tests/memory/db.test.ts` — migration row `20` exists on success; injected migration failure
  leaves no version-20 row/new tables; foreign-key check is empty and integrity is `ok`.
- `bun run typecheck` — exits 0.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- Frozen job state is self-contained and reproducible.
- Fence, job, leases, evidence, memory/retrieval snapshot, and manifest commit atomically.
- Preparation succeeds only under new trusted project authority plus exact firewall admission.
- Required semantic coverage fails closed before curation.
- Large active corpora do not become provider prompt payloads.

## Risks, Rollback, And Isolation

- Snapshot storage is intentionally larger than prompt transport. It remains job-scoped forensic
  state and is deleted only under Chunk 08's receipt/retention rules.
- Vector serialization must preserve exact dimensions/bytes; conversion loss invalidates retrieval
  reproducibility.

## Non-Goals

- Production ingest enablement, detached worker/automatic resume launch, query ranking, overlay
  vectors, or canonical promotion. Chunk 12 owns production enablement and launch.

## Consistency Check

- Verify copied fields cover every field in Chunk 01 canonical digest plus retrieval-only vector
  identity fields.
- Verify no durable incomplete manifest exists and complete manifest insertion is impossible with
  zero/multiple matching vectors for an eligible memory.
- Verify consumer query logging is not called by snapshot creation.

## Execution Notes

### 2026-08-11: Chunk Accepted

- Independent review accepted the migration-20 schema and sole atomic preparation service after the
  manifest gained a strict eight-field frozen workflow/retrieval-control contract.
- Complete evidence, active-memory, normalized-text, exact-vector, and retrieval-coverage state is
  committed with the manifest last; production start remains `smc_preparation_not_available`.
- Verification passed: 64 focused tests, 15 migration tests, the 3,219-memory bounded-transport
  fixture, `bun run typecheck`, and `git diff --check`.
