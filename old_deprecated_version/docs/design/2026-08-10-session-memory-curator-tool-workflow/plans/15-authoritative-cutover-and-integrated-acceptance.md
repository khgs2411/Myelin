# Chunk 15: Authoritative Cutover And Integrated Acceptance

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Testing And Acceptance Evidence; Implementation Constraints And Seams
**Status:** Completed and Independently Accepted
**Depends on:** Chunks 01–14
**Enables:** Plan completion

## Goal

All production Session Memory ingestion routes use the coordinator-mediated SMC workflow, competing
one-shot/apply owners are retired, and deterministic plus source-CLI dogfood evidence proves the
approved reliability and scale contracts before installation.

## Source Artifacts And Constraints

- Retire the snapshot-wide prompt production route in `src/session-maintenance/workflow.ts` and old
  parser/apply ownership in `src/ingest/worker.ts`; do not keep either as a fallback.
- Preserve reusable policy, schema, validation, lifecycle, reference, indexing, and artifact helpers
  only where they have one authoritative caller/contract.
- Existing dirty worktree changes are user/prior work. Preflight every overlapping file and preserve
  unrelated Session sandbox/provider changes.
- Firewall acceptance executes the exact old runtime shape through installed-locator, direct-source,
  and held-open pre-migration SQLite-connection routes.
- Live dogfood uses `bun src/cli.ts` from this source tree. Do not install, commit, push, or publish.
- Host/provider unavailability is an environment result; deterministic acceptance uses injected
  providers and does not depend on localhost/network.

## Relationships

- Integrates and accepts every prior chunk and the full approved source coverage map.
- No later implementation chunk exists; remaining work is external audit, user execution approval,
  and execution reporting.

## File Responsibility Map

**Create:**
- `tests/integration/session-maintenance-smc.test.ts` — full deterministic workflow and scale matrix.
- `tests/integration/session-maintenance-migration.test.ts` — populated legacy migration/cutover.
- `tests/integration/session-maintenance-recovery.test.ts` — hard-kill/receipt/fence matrix.

**Modify:**
- `src/session-maintenance/workflow.ts` — compatibility facade delegates to coordinator or is removed
  from production exports.
- `src/session-maintenance/prompt.ts` — remove all-active snapshot composer from production; retain
  only bounded envelope helpers if still referenced.
- `src/ingest/worker.ts` — one anchor coordinator runner; remove legacy model parser/apply branch.
- `src/ingest/worker-output.schema.json` — remove or archive generated old one-shot contract only
  after all runtime consumers move to the versioned SMC protocol.
- `src/ingest/ingest-service.ts`, `src/ingest/runtime.ts`, `src/maintenance/auto-memory-maintenance.ts`
  — confirm singular production route.
- `docs/IMPLEMENTATION_ALIGNMENT.md`, `docs/ROADMAP.md`, `docs/CLI.md`, and `AGENTS.md` — align current
  behavior, remove stale full-snapshot/session-start-storage claims, and record source dogfood rules.
- Existing fixtures/tests under `tests/ingest/`, `tests/session-maintenance/`, `tests/maintenance/`,
  `tests/capture/`, `tests/commands/`, and `tests/status/` — remove stale expectations and cover the
  authoritative route without duplicating chunk-level tests.

**Test:**
- All targeted tests named in Chunks 01–14.
- `tests/integration/session-maintenance-smc.test.ts`
- `tests/integration/session-maintenance-migration.test.ts`
- `tests/integration/session-maintenance-recovery.test.ts`

## Behavioral And Contract Changes

- Exactly one production route exists: input/control → indexing-first eligibility → anchor prepare →
  frozen manifest → coordinator SMC turns → validated projection → atomic finalization → derived index.
- No runtime path composes a prompt proportional to all active Session Memory or lets a provider
  directly apply lifecycle/source decisions.
- Compatibility CLI aliases may remain, but old workflow modules/schemas are not alternate owners.
- Integrated acceptance covers 3,219 active memories, multiple sequential evidence batches,
  duplicate/superseding evidence, audit-only/no-agent paths, global/project races, migration,
  recovery, provider degradation, idempotent finalization, retention cleanup, and status honesty.
- Deterministic barriers pause the old launcher pre-spawn, child post-spawn/pre-PID, child running
  with PID-null, leased worker after provider return, and denied job after abandonment/new owner.
- In the 3,219-memory fixture, record every provider-envelope encoded byte count and assert each is
  at or below the frozen `max_provider_envelope_bytes`; also assert no envelope contains the full
  active-ID set or serialized snapshot rows. The workflow must reach accepted projection and final
  completion; an early blocker is not scale acceptance.
- Recall-plan seeds come only from evidence text, evidence-explicit canonical references, audit
  targets, and overlay state. Repo/branch/commit metadata constrain one candidate context row, and
  affected work-set membership never recursively creates recall obligations.
- `SMC_AUDIT_PARTITION_LIMIT` independently caps each anchor's audit selection. The root value is
  10 even though `SMC_MAX_AFFECTED_WORK_SET_SIZE` is 1000; scheduler and status must use the former
  for audit selection and the latter only for retrieval-derived affected work.
- Coordinator exhausts non-text obligations and cursor continuations. Provider turns are limited to
  one selected text formulation, one exact coordinator-required audit fetch, or a proposal after
  complete fixed-plan coverage and all audit fetch receipts; envelopes carry only the current
  compact phase payload, never the obligation or audit matrix.
- Each `audit_fetch` turn identifies exactly one batch, memory, expected revision, and maximum result
  bytes. Only that matching fetch advances one durable receipt. An `insufficient_evidence` blocker
  caused solely by the admitted member being unfetched is invalid and journaled; `proposal_ready`
  remains unavailable until every frozen audit member is fetched.
- Preparation rejects definitely infeasible frozen controls with `smc_workflow_budget_infeasible`,
  configured/required details, and zero state. Runtime remaining-turn reserve requests only an
  explicit additive grant.
- Minimum turns are evidence text formulations + one proposal per frozen work batch + one exact
  fetch per frozen audit member. Root `SMC_MAX_TURNS=20` must admit the acceptance composition
  `7 + 2 + 10 = 19` before any state is written.
- Policy v3 governs the new phase playbook. Any existing anchor frozen under an earlier governing
  policy identity is incompatible and must be explicitly abandoned, preserving its raw evidence,
  before a fresh anchor is prepared.
- Live dogfood first performs a typed embedding/agent host-access preflight. If available, run source
  ingest, inspect exact SQLite job/fence/manifest/journal/overlay/tombstone/result/audit rows, index,
  and query Session Memory. If unavailable, report it separately without invalidating deterministic
  acceptance or mutating pending evidence as failed.

## Implementation Tasks

- [ ] Inventory all production imports/callers of `runSessionMemoryMaintenanceWorkflow`, old prompt
      composer, worker output parser/schema, and direct commit helper. Decision rule: route reusable
      deterministic helpers under coordinator/finalizer ownership; delete or make test-only any old
      owner with no valid historical-reader responsibility.
- [ ] Cut every ingest/manual/auto/runtime entrypoint to the singular coordinator worker and remove
      legacy fallback branches. Preserve historical result readers through explicit schema versions.
- [ ] Build integrated deterministic fixtures for populated migration, 3,219-memory bounded-context
      operation, sequential overlay read-your-writes, failure/restart matrix, global admission race,
      audit fairness, no-agent rows, typed provider failures, receipt replay, and cleanup.
- [ ] Prove evidence metadata is constraint-only, multi-field scope matches one context row,
      explicit references expand one hop only, work-set growth leaves plan identity stable,
      deterministic pages consume no provider turns, and the 3,219 fixture completes successfully.
- [ ] Prove the typed audit-partition control admits at most 10 due revisions per anchor under the
      root config, remains independent of affected-work grants, and is shared by scheduler/status
      audit selection.
- [ ] Prove preparation derives the exact 19-turn acceptance floor from seven evidence formulations,
      two batch proposals, and ten audit-member fetches, and that root `SMC_MAX_TURNS=20` admits it
      without changing runtime exhaustion/grant behavior.
- [ ] Prove `audit_fetch` reveals only one exact required action, a successful matching fetch commits
      one durable receipt before the next member, invalid `insufficient_evidence` is journaled, and
      audit proposal cannot start while any frozen fetch receipt is missing.
- [ ] Abandon every anchor frozen under the prior policy identity and restart from preserved evidence
      under policy v3; prove resume never rebases the old manifest or overlay in place.
- [ ] Execute the protected table-by-operation matrix against installed-locator old runtime,
      direct-source old runtime, and a held-open pre-migration connection. Assert final-schema guards
      survive rebuild/rename, no public admission mint exists, and a second connection cannot
      piggyback uncommitted admission.
- [ ] Run all five launcher/worker barriers. Prove old apply rolls back at denied tombstone
      terminalization, permanent deny survives abandonment/new owner, denied jobs may only be
      trusted-operation targets, and PID/liveness changes never authorize mutation.
- [ ] Run full relevant tests/static checks and inspect the final diff for duplicate ownership,
      excluded-scope edits, generated artifacts, and raw evidence leakage.
- [ ] With host access explicitly verified, run source-CLI dogfood on the intended project. Capture
      commands, job ID, stable outcomes, SQLite integrity/query evidence, and skipped live steps.
      Do not install or publish.

## Verification

- `bun test tests/memory tests/ingest tests/session-maintenance tests/maintenance tests/capture tests/commands tests/status tests/integration/session-maintenance-smc.test.ts tests/integration/session-maintenance-migration.test.ts tests/integration/session-maintenance-recovery.test.ts`
  — all Session-slice and integration contracts pass; unrelated failures are classified with evidence.
- `bun run typecheck` — exits 0.
- `git diff --check` — exits 0.
- Populated fixture SQL: `PRAGMA foreign_key_check` returns no rows and `PRAGMA integrity_check`
  returns `ok` after migration, finalization, abandonment, and cleanup cases.
- Firewall matrix evidence records every route/barrier/protected operation plus allowed capture
  insert and admitted current-owner controls; every cell matches the contract.
- Source dogfood: `bun src/cli.ts ingest <project-key> --json`, `bun src/cli.ts ingest status ...`,
  `bun src/cli.ts memory index session <project-key> --json`, and
  `bun src/cli.ts memory query <project-key> "<durable continuity question>" --layer session --json`
  return typed successful evidence when host access is available. Resolve the registered test project
  key and durable question from current project registry/memory before execution; never infer them.

## Acceptance Criteria Covered

- Entire approved spec and roadmap coverage map.
- Realistic corpus scale succeeds without all-memory prompts.
- One authoritative writer, exact provenance, recoverable failures, honest retrieval/status, and
  source-level dogfood before installation.
- Rolling-audit cost is independently bounded per anchor and cannot silently expand with the
  affected-work-set ceiling.
- Frozen turn feasibility accounts for every irreducible formulation, proposal, and audit fetch;
  the accepted root workload is admitted at 20 turns against a 19-turn minimum.
- Trusted audit materialization is sequential, durable, and proposal-gating; an unfetched admitted
  target cannot be converted into an evidence-insufficiency outcome.
- Pre-migration firewall and permanent deny exclude late old processes independently of PID state.

## Risks, Rollback, And Isolation

- Removing old owners is intentional but compatibility-sensitive. Retain versioned historical
  readers; do not retain production execution fallbacks.
- Live dogfood mutates the selected project's Myelin SQLite/evidence state. Verify exact registered
  target and recovery path immediately before running; this plan does not authorize installation,
  Git history, or external publication.

## Non-Goals

- Project Memory reliability, Session inbox, idle scheduler, MCP source, installation, commit, push,
  PR, or release.

## Consistency Check

- Search for old workflow/prompt/parser/apply symbols and account for every remaining reference.
- Confirm all 15 chunk verification contracts are represented in the integration matrix.
- Confirm documentation and CLI help describe current source behavior, not planned or installed state.
- Confirm root config, scheduler, and status resolve audit partition 10 independently of affected
  work-set limit 1000.
- Confirm preparation resolves root max turns 20 and reports 19 required for the 7 + 2 + 10
  acceptance workload.
- Confirm policy identity is v3, prior-policy anchors are abandoned/restarted, and no audit proposal
  exists before the final exact fetch receipt.
- Confirm `legacy_compatibility` means current-runtime workflow compatibility only.

## Execution Notes

### 2026-08-12: Accepted Implementation And Source Dogfood

- The production Session route is singular: indexing-first eligibility, atomic preparation,
  phase-driven coordinator turns, validated overlay projection, trusted atomic finalization, then
  derived indexing. Legacy snapshot-wide prompt, parser, schema, and apply owners are retired;
  archived v1 result reading remains read-only.
- Live dogfood corrected the approved design where project metadata and transitive work-set growth
  expanded toward the full corpus. Final policy v3 uses evidence-scoped, non-transitive recall;
  coordinator-owned non-text retrieval and pagination; provider text formulation; an exact
  one-record-at-a-time `audit_fetch` phase; and proposal gating on durable coverage/fetch receipts.
- Preparation proves structural feasibility before creating an anchor. Query-page accounting,
  additive grants, bounded last-result feedback, and the independent audit partition are durable and
  explicit. This repository uses audit partition 10, affected-work ceiling 1000, and max turns 20.
- The accepted source dogfood anchor `ingest_10fa819c-e313-4f2c-acea-ab313a1671fe` completed in one
  attempt with two accepted batches, 10 exact audit fetch receipts, 10 audit receipts, one
  finalization receipt, zero grants, zero claimed leases, no fence, clean foreign keys/integrity,
  ready indexing for 164/164 memories, and a non-degraded five-citation Session query.
- The 3,219-memory fixture now reaches trusted finalization—not merely an accepted projection—while
  proving bounded envelopes, completed phase, terminal receipt, fence release, clean foreign keys,
  and SQLite integrity.
- Final independent review returned ACCEPT with no P0 or P1. The full Session slice passed 576 tests
  with 2,913 assertions; TypeScript typecheck and `git diff --check` passed. No installation, commit,
  push, publication, Project Memory reliability, Session inbox, idle daemon, MCP, or Droplet Bot work
  was performed.
