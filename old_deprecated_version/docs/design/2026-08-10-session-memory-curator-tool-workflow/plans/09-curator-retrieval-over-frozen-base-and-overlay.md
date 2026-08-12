# Chunk 09: Curator Retrieval Over Frozen Base And Overlay

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Job-Scoped Memory View; Curator Retrieval Contract
**Status:** Approved for Execution
**Depends on:** Chunks 03, 06, 07, 08
**Enables:** Chunks 10–15

## Goal

SMC can perform complete, bounded, high-recall searches over the immutable base plus latest overlay,
with persisted ordered receipts proving every applicable channel was exhausted without truncation.

## Source Artifacts And Constraints

- Do not reuse `src/memory/session-memory-query.ts` as the curator facade: it is live, top-k,
  answer-oriented, cached, and query-logged. Lower-level vector/text primitives may be shared.
- Applicable channels are coordinator-owned: lexical and semantic for textual evidence; exact and
  one-hop link only for evidence-explicit canonical references; overlay when nonempty. Repo/branch/
  commit metadata constrain candidates on one context row and never contribute union hits.
- Distance thresholds/result ceilings are frozen policy/config values, never agent-selected.
- Base queries read only job snapshot rows. Overlay query uses accepted revision rows, masks staged
  superseded/retracted base records, and requires synchronous matching-contract embeddings.
- Tests use directly prepared Chunk 06 fixtures; production starts remain fail-closed and no worker
  is launched until Chunk 12.

## Relationships

- Consumes frozen snapshot, overlay CAS state, and coverage receipt storage.
- Produces `CuratorQueryRequest`, persisted `CuratorQueryReceipt`, stable cursors, complete record
  fetches, and deterministic affected work sets.
- Chunk 10 requires complete receipts for proposal acceptance; Chunk 11 exposes them through typed
  provider actions.

## File Responsibility Map

**Create:**
- `src/session-maintenance/curator-channel-plan.ts` — trusted extraction, append-only plan
  generations, admitted selectors, and fixed-point coverage validation.
- `src/session-maintenance/curator-retrieval-types.ts` — request/result/channel/cursor/diagnostic types.
- `src/session-maintenance/curator-retrieval-service.ts` — channel planning, execution, materialized
  receipt pages, overlay union/masking, and work-set admission.
- `src/session-maintenance/curator-record-service.ts` — bounded full-record/source/context/link fetch.
- `src/session-maintenance/overlay-index-service.ts` — synchronous normalized text/vector derivation.
- `tests/session-maintenance/curator-retrieval-service.test.ts`
- `tests/session-maintenance/curator-record-service.test.ts`

**Modify:**
- `src/memory/migrations.ts` — extend unreleased migration `21` with dedicated overlay-search-index
  per-batch curator-channel-plan storage, and an append-only job-wide curator action-charge ledger.
  The only durable database remains at schema 15; migration `22` stays reserved for Chunk 12 audit
  receipts.
- `src/session-maintenance/coverage-receipts.ts` — persist channel plan, ordered hit sets, pages,
  diagnostics, completion, and digest.
- `src/session-maintenance/overlay-store.ts` — accept a revision only after searchable overlay state is
  complete under the frozen embedding contract.
- `src/memory/embedding-service.ts`, `src/memory/embedding-provider-factory.ts` — expose injected
  trusted-coordinator query/vector execution without changing consumer behavior.
- `src/memory/session-memory-text.ts` and `src/memory/sqlite-vec.ts` — share deterministic primitives,
  not consumer query policy.

**Test:**
- `tests/memory/session-memory-query.test.ts` — consumer contract remains unchanged.
- `tests/memory/embedding-provider.test.ts`

## Behavioral And Contract Changes

- Internal requests bind job, batch, snapshot, overlay, fixed plan, coordinator-selected obligation
  IDs, page limit, and opaque cursor. Provider protocol supplies only one trusted text-obligation ID
  and its nonempty formulation; it never owns channels, selectors, limits, or cursors.
- Before retrieval, Myelin persists plan revision 1 from frozen evidence seeds and accepted overlay
  identity. Text evidence creates paired lexical/semantic obligations; canonical
  `session_memories/<id>` references create evidence-scoped exact and one-hop link obligations;
  nonempty overlay requires overlay coverage. Repo/branch/commit scope is an AND constraint on one
  context row. Free prose/raw JSON and work-set membership never create structured selectors.
- Plan generations change only when the frozen seed/overlay identity changes. Query-admitted work-set
  values do not append obligations or invalidate complete receipts. Acceptance requires complete,
  untruncated, gap-free terminal receipts for the immutable plan's obligation/channel matrix.
- First query materializes each channel's stable ordered qualifying ID set using frozen thresholds,
  distance plus ID tie-breaks, and a digest. Pagination indexes that set; it never reruns against
  live vectors.
- A receipt is complete only when every applicable channel has no remaining page and no qualifying
  hit was truncated by its ceiling. Incomplete/truncated receipts cannot authorize proposal acceptance.
- Every returned memory becomes an affected work-set member with revision identity. Full record fetch
  is stable-ID and expected-revision scoped.
- Full-record fetches charge exact provider-visible result bytes to a durable job-wide ledger before
  return. Coordinator-owned query pages record zero provider-result bytes. Each distinct
  materialization consumes one query-count unit; coordinator cursor pages do
  not multiply it or consume provider turns. Exact action replay
  never double-charges; frozen limits plus validated additive grants are authoritative across all
  batches and both action kinds.
- Typed provider/transport unavailability leaves the overlay and receipts unaccepted/retryable; it
  does not mark evidence or embeddings invalid and never claims lexical fallback completeness.

## Implementation Tasks

- [ ] Define strict request/result/cursor schemas and freeze coordinator retrieval controls into the
      manifest/query digest. Cursors must be opaque, job/receipt scoped, and tamper-evident.
- [ ] Persist the coordinator-owned batch channel plan before querying. Remove agent authority over
      channel lists, raw IDs, filters, link seeds, limits, and cursors; provider actions formulate
      one selected text obligation. Query/cursor materialization identity
      excludes attempt/epoch, while each call still requires the current attempt/epoch authority.
- [ ] Implement lexical, semantic, exact, evidence-scoped one-hop link, and overlay channels against snapshot tables.
      Materialize channel/obligation-specific ordered hit sets and persist each returned page/result
      before exposing it. Repo/branch/commit constraints must all match one context row.
- [ ] Implement synchronous overlay normalization/embedding before overlay revision acceptance;
      mask base rows with staged lifecycle effects and union staged active records. Keep domain
      payload/digest separate from dedicated derived search-index rows, while binding both into the
      overlay revision identity. There is one public overlay-acceptance path; unindexed memory
      upserts cannot commit.
- [ ] Build complete-record fetch and work-set admission. Add 3,219-memory fixtures, stable pagination,
      duplicate-overlay retrieval, truncation, missing-page, stale-cursor, stale-revision, and injected
      provider-failure tests.
- [ ] Require a discriminated exact memory revision or source content hash for full-record fetch;
      paginate every persisted hit even when the qualifying universe was ceiling-truncated; measure
      exact provider-visible fetch envelopes for per-result and cumulative byte budgets while
      recording coordinator-owned query pages as zero provider-result bytes.
- [ ] Enforce `max_queries`, `max_provider_envelope_bytes`, and
      `max_cumulative_returned_result_bytes` at the durable logical-action boundary. Persist an
      attempt-independent idempotent action charge atomically with each query page or fetch result;
      charge query count only on materialization roots, sum usage job-wide, and include additive
      grants without double-charging replay. Query pages charge zero returned-result bytes.

## Verification

- `bun test tests/session-maintenance/curator-retrieval-service.test.ts tests/session-maintenance/curator-record-service.test.ts tests/memory/session-memory-query.test.ts tests/memory/embedding-provider.test.ts`
  — channel completeness, persisted order, cursors, overlay masking, fail-closed degradation, and
  consumer-query separation pass.
- `bun test tests/ingest/ingest-service.test.ts tests/ingest/runtime.test.ts` — production start still
  persists no anchor and launches no PID before full coordinator/finalizer integration.
- `bun run typecheck` — exits 0.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- Curator retrieval is high-recall, paginated, inspectable, and distinct from consumer query.
- Required semantic coverage fails closed.
- Later batches retrieve staged results and normal prompt size is not corpus-proportional.

## Risks, Rollback, And Isolation

- Semantic result materialization can be large; enforce configured qualifying ceilings and fail
  closed on truncation rather than silently lowering recall.
- Never write `session_memory_query_logs`; curator receipts are job-scoped forensic state.

## Non-Goals

- Agent orchestration, proposal validation, or canonical mutation.

## Consistency Check

- Confirm every applicable-channel rule in the spec maps to one code/test branch.
- Confirm no retrieval read touches live canonical tables after manifest readiness.
- Confirm returned IDs/revisions match the validator contract in Chunk 10.

## Execution Notes

### 2026-08-11: Coordinator-Owned Channel Plan Correction

- Independent review rejected request-derived channel applicability as circular authority.
- A focused retrieval pressure test selected a dedicated append-only per-batch plan with monotonic
  obligation generations and channel/obligation-specific exhaustion receipts. Exact references use
  canonical `session_memories/<id>` syntax; topics/entities come only from typed admitted-memory
  fields until frozen evidence gains a typed schema.

### 2026-08-11: Accepted Implementation

- Independent review accepted the coordinator-owned monotonic channel plan, gap-free per-obligation
  coverage receipts, frozen-base plus indexed-overlay retrieval, recovery-stable cursors, strict
  record identities, and exact job-wide query/fetch budget accounting.
- Migration 21 now retains attempt-independent append-only fetch-result receipts beside action
  charges. Receipt and charge commit atomically; one-sided or conflicting replay fails closed, and
  forensic cleanup removes both only after the terminal retention gate.
- Duplicate obligations preserve the sorted union of all evidence and affected-work-set provenance
  while rejecting any kind, channel, or selector identity mismatch.
- Final independent gates passed: 50 focused retrieval/record/cleanup/consumer tests, 22 production
  start-regression tests, TypeScript typecheck, and `git diff --check`.

### 2026-08-12: Chunk 15 fixed-seed correction

- Source dogfood proved recursive affected-work expansion was not scalable. The approved correction
  makes plan identity evidence/overlay-seed only, uses repo/branch/commit as same-row constraints,
  and keeps work-set growth solely as proposal-disposition authority.
- Coordinator owns every non-text query and cursor page. Query allowance is charged once per
  materialization, not once per page.
