# Chunk 10: Deterministic Proposal Validation And Projection

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Incremental Curation And Coverage; Deterministic Validation And Atomic Promotion
**Status:** Approved for Execution
**Depends on:** Chunks 07, 09
**Enables:** Chunks 11–15

## Goal

Each batch proposal and the final staged projection are validated read-only against frozen evidence,
affected work sets, receipts, and overlay revision, producing an exact digest without canonical writes.

## Source Artifacts And Constraints

- Reuse the strict Zod/JSON Schema and reference vocabulary in
  `src/session-maintenance/output-contract.ts` and `output-validator.ts`, but replace the old
  all-active-memory disposition requirement with selected-source/affected-work-set coverage.
- Lifecycle remains keep/supersede/retract; physical deletion is invalid.
- Every selected source has exactly one terminal-intent disposition. Every admitted memory has one
  current disposition or an explicit valid same-revision receipt reuse.
- Output IDs and final reference mapping are stable and collision-safe; validator must never rename.
- Tests build prepared/overlay/retrieval fixtures through trusted services; production ingest remains
  fail-closed without a coordinator through this chunk.

## Relationships

- Consumes overlay/journal state and complete curator work/query receipts.
- Produces versioned `SMCBatchProposal`, structured validation issues,
  `SessionMaintenanceProjection`, and accepted projection digest.
- Chunk 11 transports batch actions; Chunk 12 accepts only the exact final projection digest.

## File Responsibility Map

**Create:**
- `src/session-maintenance/proposal-contract.ts` — strict batch proposal action payload/schema.
- `src/session-maintenance/proposal-validator.ts` — batch coverage/reference/receipt validation.
- `src/session-maintenance/projection.ts` — deterministic fold of accepted overlay into final output.
- `tests/session-maintenance/proposal-validator.test.ts`
- `tests/session-maintenance/projection.test.ts`

**Modify:**
- `src/session-maintenance/output-contract.ts` — version the incremental final projection shape while
  retaining needed memory/candidate/handoff payload contracts.
- `src/session-maintenance/output-validator.ts` — validate affected sets and receipt reuse instead of
  enumerating untouched active memories.
- `src/session-maintenance/identity.ts` — advance output-contract identity/digest.
- `src/session-maintenance/overlay-store.ts` — stage only validated batch deltas and accepted digests.
- `src/session-maintenance/result.ts` — parse/resolve the new projection/reference vocabulary without
  claiming it canonical before Chunk 12.

**Test:**
- `tests/ingest/worker.test.ts` — stale old-output assumptions are updated only where authorized.

## Behavioral And Contract Changes

- A batch proposal includes work-batch ID, expected overlay revision, exact selected-source
  dispositions, exact affected-memory dispositions or receipt reuse, staged operations, and checked
  output references.
- Receipt reuse is valid only when memory ID, revision, state digest, overlay revision, governing
  identities, and prior accepted disposition digest match exactly.
- Validation rejects missing/duplicate/out-of-work-set IDs, stale revisions, incomplete channel
  receipts, source/output reference mismatch, active/new ID collisions, invalid lifecycle targets,
  and candidate/handoff provenance gaps.
- Every frozen audit member also requires an exact full-record fetch receipt for its admitted base
  revision. Policy v3's coordinator withholds `proposal_ready` until those receipts exist, while the
  validator retains this check as a fail-closed boundary.
- Accepted batch validation produces a deterministic delta digest for overlay CAS. Final projection
  folds every accepted batch and audit partition, proves complete selected-source coverage, and is
  hashed with its schema/identity.
- Validation and projection make no writes to canonical tables, leases, tombstones, or job terminal
  phase.

## Implementation Tasks

- [ ] Define strict proposal schema and stable issue codes with unknown-field rejection. Preserve
      output reference forms `session_memories/<id>`, `memory_candidates/<id>`,
      `handoff_instructions/<id>`, and `memory_dispositions/<memory_id>` under job-relative scope.
- [ ] Implement source/work-set exact coverage, revision/receipt reuse, query-receipt completeness,
      lifecycle closure, output/reference provenance, and stable-ID collision validation.
- [ ] Implement deterministic projection fold from accepted overlay revisions, including audit-only
      and no-output source paths, and bind the result to manifest/overlay/governing identities.
- [ ] Update legacy contract tests to the approved incremental semantics; add property-like ordering
      cases proving equivalent accepted state yields one digest and stale/missing data rejects.

## Verification

- `bun test tests/session-maintenance/proposal-validator.test.ts tests/session-maintenance/projection.test.ts tests/ingest/worker.test.ts`
  — exact coverage, receipt reuse, reference closure, deterministic digest, and read-only behavior pass.
- `bun test tests/ingest/ingest-service.test.ts tests/ingest/runtime.test.ts` — production
  start/resume remains blocked through Chunk 11; Chunk 12 alone replaces the blockers and owns first
  production launch/resume integration.
- `bun run typecheck` — exits 0.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- Every selected source and affected memory has an exact disposition.
- Missing pages, stale revisions, invalid references, or partial outputs cannot become accepted.
- Finalization input is one deterministic, digest-bound projection.

## Risks, Rollback, And Isolation

- Compatibility with stored historical accepted outputs must be read-versioned. Do not reinterpret
  old results as new projections.
- Contract identity changes make paused jobs nonresumable by design; Chunk 08 handles the blocked
  state rather than rebasing it.

## Non-Goals

- Provider invocation, canonical finalization, scheduling, or CLI exposure.

## Consistency Check

- Verify validator issue codes are stable machine strings and used consistently by Chunk 11/14.
- Verify all output references resolve either to staged outputs or explicit disposition receipts.
- Verify untouched active memories are not implicitly enumerated or prompted.

## Execution Notes

### 2026-08-11: Accepted Implementation

- Independent review accepted one public unknown-input proposal boundary that parses, canonicalizes,
  validates the prospective retained-plus-new overlay, revalidates immediately before CAS, and then
  stages; raw overlay mutation is private.
- Validation closes lifecycle and provenance references before staging, while deterministic
  projection folds accepted batches in order and retains the latest valid revision for each stable
  staged identity.
- Nested set-valued fields are canonicalized once for response, delta, overlay, and projection
  identities. Equivalent proposals therefore produce identical durable digests.
- Durable replay of an already accepted memory-bearing proposal reconstructs and verifies the
  persisted indexed revision before any embedding call. Exact replay is provider-independent;
  changed content conflicts before transport.
- Final independent gate passed 216 relevant tests, TypeScript typecheck, and `git diff --check`.
