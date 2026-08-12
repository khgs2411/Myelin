# Chunk 11: Provider-Neutral SMC Coordinator Loop

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Dedicated SMC Surface; Proposal-Only Agent Authority
**Status:** Approved for Execution
**Depends on:** Chunks 07–10
**Enables:** Chunks 12–15

## Goal

Codex and Claude can perform the same bounded, journaled SMC query/fetch/proposal/blocker protocol
from the target repository while trusted Myelin alone executes tools and stages accepted proposals.

## Source Artifacts And Constraints

- `src/agents/` already separates provider invocation and keeps Codex `--sandbox read-only`; preserve
  target cwd, resolved provider/model/reasoning provenance, timeout, JSON output, and stubs.
- Provider output is untrusted and must pass strict action schema before dispatch. Evidence/tool
  results cannot create action types or override policy.
- The child process never executes Myelin mutation/query commands as a correctness dependency.
- Every action/result is journaled before its result is returned. Provider-native session resume is
  optional transport optimization, never state authority.
- Preparation proves the frozen minimum turn/query/envelope/work-set controls are feasible before
  writing state. Runtime turn reserve exhaustion becomes `needs_followup` and requires an explicit
  additive grant; no grant is automatic.
- Minimum turns equal the number of evidence text formulations plus one proposal for every frozen
  work batch plus one exact full-record fetch for every frozen audit member. Coordinator-owned
  retrieval and page continuation add no provider turns.
- Policy v3 adds trusted `audit_fetch` between coverage completion and audit proposal. Its envelope
  exposes exactly one required batch/memory/expected-revision/max-byte fetch, and only the matching
  successful durable receipt advances the coordinator.
- This chunk exposes the coordinator as a trusted direct service and verifies it over prepared jobs,
  but production ingest/resume stays blocked. Chunk 12 enables production only when coordinator and
  finalizer can complete the entire workflow.

## Relationships

- Consumes action journal, curator retrieval/fetch, proposal validation, overlay CAS, and recovery.
- Produces versioned `SMCAction`/`SMCResult`, coordinator attempt loop, and accepted batch progress/
  projection state for Chunk 12's finalization and production integration.
- Chunk 12 invokes the final projection/finalizer after all selected evidence/audit work is accepted.

## File Responsibility Map

**Create:**
- `src/session-maintenance/protocol.ts` — strict versioned action/result unions and JSON Schema.
- `src/session-maintenance/coordinator.ts` — bounded dispatch loop, journal-before-return, batch/audit
  progression, and phase outcomes.
- `src/session-maintenance/work-envelope.ts` — bounded provider prompt containing current batch,
  policy, protocol, compact progress, and prior typed result only.
- `src/agents/smc-adapter.ts` — provider-neutral one-turn action invocation contract.
- `tests/session-maintenance/protocol.test.ts`
- `tests/session-maintenance/coordinator.test.ts`
- `tests/agents/smc-adapter.test.ts`

**Modify:**
- `src/agents/contracts.ts` — add SMC turn request/result while preserving generic invocation result.
- `src/agents/execute.ts` — exhaustive Codex/Claude dispatch for SMC actions.
- `src/agents/providers/codex.ts` and `src/agents/providers/claude.ts` — provider-specific command/
  response transport only.
- `src/session-maintenance/policy.ts` — editable SMC role/instructions aligned with the typed protocol.
- `src/session-maintenance/identity.ts` — protocol/policy identities.

**Test:**
- `tests/ingest/runtime.test.ts`
- `tests/ingest/ingest-service.test.ts`

## Behavioral And Contract Changes

- `SMCAction` is one of `query`, `fetch_record`, `submit_proposal`, or `blocker`; each includes
  protocol version, job/attempt/sequence/batch/epoch identities and expected overlay/snapshot state.
- The provider `query` action is text formulation only: trusted plan identity, one coordinator-
  selected text obligation, and nonempty query text. Myelin owns deterministic non-text queries,
  page limits, cursors, every continuation, and terminal coverage.
- Dispatcher validates capability scope, budgets, identity, and schema before invoking the matching
  trusted service. Unknown actions/fields yield a journaled validation result without execution.
- Each provider turn prompt is phase-driven and bounded by current work-envelope limits. It contains
  compact plan/coverage/work-set identity, the selected text descriptor in `text_formulation`, the
  exact next `required_action` in `audit_fetch`, or compact affected members in `proposal_ready`; it
  never contains the full obligation or audit matrix or active corpus. The encoded envelope must be
  `<= manifest.budgets.max_provider_envelope_bytes` before invocation; overflow yields
  `provider_envelope_budget_exceeded` without truncating an
  evidence item or query result. Repository inspection remains read-only and relevant to evidence.
- In `audit_fetch`, any response other than the exact required fetch or a genuine typed
  transport/system blocker is rejected and journaled. `insufficient_evidence` caused only by the
  not-yet-fetched admitted target is invalid. The next audit member is exposed only after the
  current fetch receipt commits, and `proposal_ready` requires all such receipts.
- Provider/process/transport interruption records a stable retryable failure and transitions the
  same job to `needs_followup`. Invalid/incomplete proposal leaves the batch open and canonical state
  unchanged within configured turns.
- Preparation rejects when `max_turns < evidence_count + work_batch_count + audit_member_count`.
  Root `SMC_MAX_TURNS=20` admits the acceptance case whose exact minimum is
  `7 formulations + 2 proposals + 10 audit fetches = 19`.
- Codex and Claude transport exactly the same protocol schema. Resolved invocation identity is
  persisted before the first process starts and cannot switch mid-job.
- Direct coordinator execution advances a prepared fixture to an accepted projection or
  `needs_followup`; it does not finalize or enable public/manual/automatic starts. Production
  entrypoints retain the stable availability blockers and launch no process through this chunk.

## Implementation Tasks

- [ ] Define strict action/result schemas and generated JSON Schema with prompt-injection-resistant
      policy hierarchy. Include stable blocker/retryability codes and echoed identities.
- [ ] Implement bounded coordinator dispatch: reconstruct from journal; exhaust non-text/page work;
      request one text formulation when needed; require one exact audit fetch at a time after
      coverage; invoke audit proposal only after all frozen fetch receipts; validate/journal every
      provider action; continue until accepted batch or bounded follow-up.
- [ ] Adapt Codex/Claude transport. Codex remains target-cwd/read-only; neither parser follows
      model-controlled filesystem paths. Use injected/stub provider turns for deterministic tests.
- [ ] Keep production start/resume gates unchanged and test direct coordinator execution through an
      injected runner. No `IngestService`, detached runtime, or worker path may invoke it until
      Chunk 12 wires the full coordinator-plus-finalizer workflow.
- [ ] Implement evidence batches first, then bounded due audit work, and build the final projection
      only after all selected units are accepted. Exercise restart reconstruction and additive
      budget grant behavior.

## Verification

- `bun test tests/session-maintenance/protocol.test.ts tests/session-maintenance/coordinator.test.ts tests/agents/smc-adapter.test.ts tests/ingest/runtime.test.ts tests/ingest/ingest-service.test.ts`
  — provider parity, strict schema, bounded prompts, journal replay, injection resistance, and
  needs-followup outcomes pass; the 3,219-memory fixture keeps every provider envelope at or below
  its frozen byte ceiling and contains no serialized full-corpus snapshot.
- The same test set proves production manual/automatic start and resume still persist/launch nothing,
  while direct prepared fixtures complete coordinator reasoning without legacy one-shot calls.
- Feasibility coverage proves each frozen audit member contributes one fetch turn and each batch one
  proposal turn; the root 20-turn ceiling admits the 19-turn acceptance workload.
- Phase coverage proves required-action exactness, one-receipt-at-a-time audit progression,
  journaled invalid `insufficient_evidence`, and proposal gating until all frozen audit fetches exist.
- `bun run typecheck` — exits 0.
- `git diff --check` — exits 0.

## Acceptance Criteria Covered

- Proposal-only SMC has bounded text-formulation agency without selector, pagination, canonical, or
  tool-execution authority.
- Target-repository verification and provider neutrality are preserved.
- Bounded turns replace snapshot-wide prompts and resume from authoritative journal state.
- Audit reasoning cannot skip materialization: policy v3 requires exact durable fetches before the
  audit proposal phase.
- A legitimate coordinator target is complete and ready for Chunk 12 production integration.

## Risks, Rollback, And Isolation

- Multi-turn providers can repeat or reorder actions; journal idempotency and expected sequence/
  overlay revision must reject divergence.
- No parser may recover JSON from an arbitrary path named by model output.

## Non-Goals

- Canonical promotion, production ingest/resume enablement, trigger policy, public SMC CLI, or new
  input adapters.

## Consistency Check

- Verify every action maps to exactly one trusted service and no arbitrary SQL/shell dispatch exists.
- Verify prompts include policy/protocol identity and bounded current work only.
- Verify Codex/Claude resolved invocation fields match manifest/resume validation names.
- Verify source search shows no production start/auto-resume invokes either coordinator or legacy
  one-shot for new-format work before Chunk 12.

## Execution Notes

### 2026-08-11: Accepted Implementation

- Independent review accepted the provider-neutral bounded coordinator protocol for query, strict
  record fetch, proposal submission, and blockers. Codex remains target-CWD/read-only and Claude SMC
  explicitly uses plan permission mode without changing generic Claude execution.
- Query, fetch, and accepted-overlay effects commit atomically with their exact coordinator journal
  result, so lost responses replay from durable state without duplicated provider or tool work.
- Result schemas are closed through normalized evidence, frozen/staged memory, context, and link
  records; arbitrary JSON remains limited to the documented memory payload map. Digest-valid but
  schema-invalid journal replay fails closed before provider dispatch.
- Production start/resume remained unavailable through this chunk as required.
- Final independent gates passed 39 Chunk 11 tests, 57 focused Chunk 07/09/10 regressions,
  TypeScript typecheck, and `git diff --check`.

### 2026-08-12: Chunk 15 design corrections

- The tool protocol advanced to v2 for bounded `text_formulation`/`proposal_ready` work, and the
  governing policy then advanced to v3 to add trusted `audit_fetch` progression.
- Coordinator-owned exact/link/overlay recall and cursor pagination are no longer provider actions.
- Repo/branch/commit values constrain candidates on one context row, and affected work does not
  recursively expand recall plans.
- Preparation feasibility and runtime provider-turn reserve fail honestly with explicit grant paths.
- The accepted correction makes the turn floor explicit: evidence formulations + batch proposals +
  audit-member fetches. Root `SMC_MAX_TURNS` is 20, one above the 19-turn acceptance minimum.
- `audit_fetch` exposes one exact required action and commits one durable fetch receipt before
  advancing. An unfetched admitted target cannot justify `insufficient_evidence`, and audit proposal
  remains unavailable until all receipts exist. Earlier-policy anchors must be abandoned and
  restarted because their frozen governing identity is incompatible with policy v3.
