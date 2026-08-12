# Chunk 05: Deterministic Evidence Selection And Batch Planning

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Immutable Job Manifest; Incremental Curation And Coverage
**Status:** Approved for Execution
**Depends on:** Chunk 04
**Enables:** Chunks 06–15

## Goal

Define deterministic, side-effect-free evidence selection, normalization, hashing, byte-aware batch
planning, and no-agent intent classification for Chunk 06's single atomic preparation transaction.

## Source Artifacts And Constraints

- `src/memory/experience.ts` owns valid-content selection, leases, tombstones, and source finalization.
- Valid content ordering is `inserted_at`, then stable event ID. `occurred_at` is provenance only.
- This chunk reads current rows to produce an in-memory preparation plan but does not lease,
  terminalize, delete, create a fence/job/manifest, or copy job-owned evidence.
- Full-queue selection is the normal contract. Deprecated `--limit` remains a compatibility boundary
  until Chunk 14 and cannot silently redefine internal batching.

## Relationships

- Requires active SMC authority from Chunk 04.
- Produces `SMCEvidencePreparationPlan`, normalized evidence values, deterministic `SMCWorkBatch`
  identities, and no-agent intent records.
- Chunk 06 re-reads/validates this plan inside one `BEGIN IMMEDIATE` and commits the complete
  evidence+memory/retrieval manifest atomically.

## File Responsibility Map

**Create:**
- `src/session-maintenance/evidence-selection.ts` — content/no-agent classification, normalized
  evidence hashes, deterministic ordering, and preparation-plan identity.
- `src/session-maintenance/evidence-batch-planner.ts` — pure item/byte limits and stable batch IDs.
- `tests/session-maintenance/evidence-selection.test.ts`
- `tests/session-maintenance/evidence-batch-planner.test.ts`

**Modify:**
- `src/memory/experience.ts` — expose a deterministic read projection and shared valid-content/
  legacy-no-agent predicates without changing lease/finalization behavior.
- `src/session-maintenance/identity.ts` — expose the SMC tool-protocol identity used in the plan hash.

**Test:**
- `tests/memory/experience.test.ts`
- `tests/ingest/ingest-service.test.ts` — only verifies compatibility selection semantics here;
  atomic preparation is owned by Chunk 06.

## Behavioral And Contract Changes

- The preparation plan contains exact selected content/provenance values and hashes, ordered source
  IDs, total encoded bytes, deterministic batches, and deterministic no-agent terminal intents.
- The plan is advisory input to Chunk 06. That transaction must re-read every source row, revalidate
  identity/hash/eligibility, and derive/persist the same result; no stale plan may claim a lease.
- Batch packing honors maximum item count, encoded bytes, and absolute single-item bytes. It never
  excerpts or splits evidence. Batch ID derives from job, ordinal, ordered IDs, and content hashes.
- An oversize item yields `evidence_item_too_large` before mutation and remains raw/eligible.
- Existing control/invalid/empty/unsupported rows receive deterministic `no_output` intent only.
  Chunk 12 is the sole authority that finalizes their tombstones/deletes raw rows; they never reach SMC.

## Implementation Tasks

- [ ] Implement exact valid-content/no-agent classification and normalized evidence hashing from
      durable fields. Keep ordering `inserted_at`, then event ID; retain `occurred_at` as provenance.
- [ ] Implement pure batch packing using configured item, encoded-byte, and absolute-item limits.
      Never excerpt/split; derive each batch ID from plan identity, ordinal, IDs, and hashes.
- [ ] Produce stable oversize/no-work/preparation-plan results without DB writes. Include resolved
      trigger, compatibility selection limit, governing identities, and budgets in the plan digest.
- [ ] Prove no-agent inputs are excluded from content batches and carry deterministic terminal intent
      for Chunk 12 without changing tombstones/raw rows in this chunk.

## Verification

- `bun test tests/session-maintenance/evidence-selection.test.ts tests/session-maintenance/evidence-batch-planner.test.ts tests/memory/experience.test.ts tests/ingest/ingest-service.test.ts`
  — deterministic order/hashes/batches, oversize/no-work results, content-predicate parity, and
  no-agent intent pass; DB bytes/tombstone states are unchanged by planning.
- `bun run typecheck` — exits 0.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- Deterministic complete evidence/batch input for the one atomic manifest transaction.
- Oversize/planning failure consumes nothing.
- Control/invalid rows never enter curator context and are not prematurely terminalized.

## Risks, Rollback, And Isolation

- The read plan can drift before Chunk 06 acquires the transaction; Chunk 06 must revalidate every
  value rather than trusting it.

## Non-Goals

- Database schema, leases, manifest persistence, active-memory snapshot, agent turns, or any
  tombstone/raw-row finalization.

## Consistency Check

- Confirm content predicates match threshold/status predicates and exclude control/invalid rows.
- Confirm the plan includes every frozen evidence field required by `SMCManifest` in `CONTEXT.md`.
- Confirm no function in the new modules performs SQL mutation or provider invocation.

## Execution Notes

### 2026-08-11: Chunk Accepted

- Independent review accepted deterministic read-only selection, normalization, hashing, batching,
  oversize/no-work results, and no-agent intent classification.
- Eligibility uses one explicit SPACE/TAB/LF/CR/NBSP boundary in both TypeScript and SQLite; required
  item/batch byte budgets fail closed when absent or malformed.
- Verification passed: 47 focused tests, `bun run typecheck`, and `git diff --check`.
