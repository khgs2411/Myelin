# Session Memory Curator Tool Workflow Implementation Plan Set

**Approved Source:** `docs/design/2026-08-10-session-memory-curator-tool-workflow/spec.md`
**Agenda:** `docs/design/2026-08-10-session-memory-curator-tool-workflow/agenda.md`
**Pseudocode:** Absent; the approved spec and ADR define the required state, authority, and protocol boundaries
**Context:** `CONTEXT.md`
**ADRs:** `docs/adr/0070-use-coordinator-mediated-session-memory-curation.md`; partially superseded `docs/adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`; unchanged supporting ADRs 0002, 0051, 0054, and 0061
**Status:** Completed and Independently Accepted

## Goal

Replace the current all-active-memory prompt workflow with the approved scalable Session Memory
Curator (SMC): one durable project anchor job, immutable job-owned evidence and memory state,
coordinator-mediated bounded agent turns, high-recall job-scoped retrieval, revisioned noncanonical
staging, same-job recovery, and one trusted atomic promotion.

The completed plan set must preserve Session Memory provenance and recoverability, keep SMC
proposal-only, serialize project writes against scope-global embedding lifecycle operations, advance
rolling audit only through successful event-triggered maintenance, and retire both older production
curation owners. It must not introduce Session inbox support, an idle scheduler, Project Memory
reliability work, installation changes, commits, or publication.

## Source Artifacts And Repository Evidence

Approved and verified sources:

- `docs/design/2026-08-10-session-memory-curator-tool-workflow/spec.md` — approved design and
  acceptance contract.
- `docs/design/2026-08-10-session-memory-curator-tool-workflow/agenda.md` — sixteen resolved design
  decisions and external design-audit history.
- `docs/adr/0070-use-coordinator-mediated-session-memory-curation.md` — authoritative coordinator,
  staged-overlay, dual-fence, and branch-provenance decision.
- `CONTEXT.md` — approved SMC, anchor-job, manifest, overlay, retrieval, audit, and fence vocabulary.
- External Software Architect design-correction audit — Ready for Development, 66/70, no critical
  issues. It requires the plan set to move the legacy-write isolation boundary before migration 16.

Current implementation seams verified in the dirty worktree:

- `src/memory/migrations.ts`, `src/memory/session-memories.ts`,
  `src/memory/session-memory-contexts.ts`, `src/memory/session-memory-links.ts`, and
  `src/memory/session-memory-repair-service.ts` own current canonical Session state and writers.
- `src/memory/embedding-contract-lifecycle-service.ts` and related contract/index services own the
  current scope-global embedding lifecycle and project-spanning Session indexing.
- `src/ingest/ingest-service.ts`, `src/ingest/jobs.ts`, `src/ingest/runtime.ts`, and
  `src/ingest/status.ts` own the current job handle, detached worker, and status lifecycle.
- `src/memory/experience.ts` owns Experience Log selection, leases, tombstones, and raw evidence
  finalization.
- `src/session-maintenance/` owns the current one-shot snapshot, prompt, output validation, commit,
  accepted result, and artifact flow.
- `src/memory/session-memory-query.ts` and Session indexing modules provide reusable lower-level
  semantic primitives but currently query live, answer-oriented state.
- `src/agents/` provides provider-neutral Codex/Claude execution with Codex read-only repository
  access, but not a durable Myelin tool loop.
- `src/maintenance/auto-memory-maintenance.ts`, `src/capture/facade.ts`,
  `src/commands/ingest.ts`, `src/commands/memory.ts`, and status services own current triggers and
  operator surfaces.
- Relevant existing coverage is concentrated under `tests/ingest/`, `tests/memory/`,
  `tests/maintenance/`, `tests/capture/`, `tests/commands/`, and `tests/status/`.
- Repository-native verification commands are `bun run typecheck`, targeted `bun test <paths>`, and
  `git diff --check`.

Artifact state and impact:

- No pseudocode artifacts exist. This is non-blocking because the approved spec defines the state
  machines, action/result union, snapshot and retrieval identities, atomicity, and recovery rules
  precisely enough for chunk planning.
- All fifteen indexed chunk plans exist. Chunks 01–04 and their consumers are reopened by the
  approved pre-migration firewall correction; no stale chunk approval authorizes further execution.

## Design Readiness

- Approved source verified: Yes. The spec and agenda are explicitly approved for planning.
- Artifact paths verified: Yes. Spec, agenda, context, ADRs, current code seams, and relevant test
  directories exist.
- Pseudocode status: Absent and non-blocking; no file/class shape is being treated as pre-approved.
- Cross-artifact consistency: Yes. The corrected spec, agenda, ADR 0070, and CONTEXT agree that a
  SQLite-enforced legacy-write firewall must close before incompatible Session schema migration.
- Repository constraints reconciled: `openMemoryDb` auto-applies migrations, and an old process can
  remain paused across that call. Migration 16 therefore installs/closes the firewall before its
  revision-table rebuild. Process liveness is diagnostic only; transaction-scoped SQLite admission
  is the integrity boundary. Chunks 02–03 bind their project/global authorities to that admission,
  and Chunk 04 assigns permanent deny identities before authority activation.
- Dirty-worktree constraint: The existing changes are the implementation baseline and must be
  preserved. Every executor must preflight overlapping diffs and must not revert unrelated or
  earlier Session Memory/sandbox work.
- Test authority: The user approved focused behavior-level test changes for this workflow,
  including replacement of stale one-shot prompt/trimming expectations.
- Remaining non-blocking risks: exact forensic-retention duration is configuration/planning-owned;
  the public embedding lifecycle command spans Session and Project scopes; this repository's
  explicit threshold of 25 remains an override to the new default; live provider dogfood requires
  verified host access rather than sandbox assumptions.
- Product-design blockers: None.
- Roadmap audit history: First Senior Project Manager audit returned Needs Refinement (48/70) due to
  oversized chunks, contradictory partial parallelism, and incomplete ownership mapping. The
  first refinement split the roadmap and repaired ownership. The second audit returned Needs
  Refinement (55/70) for two dependency declarations. The final re-audit returned Ready for
  Development (65/70), with no critical issues or unresolved questions.
- Roadmap approval: Approved by the user on 2026-08-11.
- Original full plan-set audit history: The first Software Architect audit returned Needs Refinement (44/70)
  with six plan-reconciliation issues. The second audit returned Needs Refinement (53/70) for two
  Chunk 04 transition gaps. The third audit returned Needs Refinement (55/70) for stale migration/
  activation wording and production launch preceding the coordinator. The plan set now reserves
  migration 19 for additive schema, keeps production start/resume blocked through Chunk 11, and
  makes Chunk 12 the first complete coordinator-plus-finalizer production enablement. The final
  re-audit returned Ready for Development (68/70) with no critical issues, and the user approved
  continuous full-plan execution on 2026-08-11. Execution then exposed a cross-migration race:
  migrations 16–19 could be applied while an old runtime still owned an unfenced write. The user
  approved the pre-migration SQLite firewall correction; the corrected design re-audit returned
  Ready for Development (66/70). The corrected full plan-set audit then returned Ready for
  Development (67/70), with no critical issues, after the exact firewall matrix and
  `migrate_legacy_anchor` admission were reconciled. The user's 2026-08-11 instruction approved
  continuation once this gate passed.

## Reconciliations And Decision Ownership

| Item | Evidence / Decision Rule | Owning Chunk | Must Resolve Before |
| --- | --- | --- | --- |
| Protected legacy-write surface | Maintain an explicit table-by-operation matrix. Deny old job lifecycle/PID mutation, leases/tombstones, raw evidence deletion, canonical memory/context/link DML, and initial Session embedding registration; allow capture inserts. Prove indirect old apply rolls back when terminal tombstone mutation is denied. | 01 | Any migration-16 schema rebuild or later authority work |
| Trusted SQLite admission | Admission is transaction-scoped, uncommitted, bound to operation/project-or-scope/owner/epoch, and minted only by internal services. A denied legacy job may be the mutation target but can never be the admitted authority. | 01; consumed by 02, 03, 04, 06, 08, 12 | Each protected writer is accepted |
| Legacy nonterminal jobs without SMC state | Assign a permanent deny identity before quarantine/activation. Preserve IDs, evidence, tombstones, and attempts. PID/process probes are status diagnostics only and never authorize writes or cutover. | 04 | Chunk 04 acceptance before new preparation activates |
| Public embedding lifecycle command spans Session and Project scopes | Preserve the public command. Apply the Session-scope global fence at the Session phase, or conservatively around the combined operation when that is the only atomic safe seam; do not redesign Project Memory behavior. | 03 | Chunk 03 acceptance |
| Forensic retention duration | Use an existing authoritative configuration value if present. Otherwise expose a named configuration boundary without inventing an intuition-based default; cleanup remains forbidden before completion/abandonment receipt. | 08 | Chunk 08 cleanup acceptance and Chunk 15 integrated retention check |
| Existing explicit threshold of 25 | Preserve `myelin.config` as a project override. The 60-entry/24-hour pair is the fallback default only. | 13 | Trigger acceptance |
| Deprecated evidence-chunk names | Preserve documented CLI/config compatibility aliases at the boundary while using evidence-work-batch vocabulary internally. | 14 | Authoritative cutover |
| Provider/network access in live dogfood | Use the resolved host-access contract and stable typed unavailability errors. Never interpret a rejected socket as proof of sandbox denial or persist it as invalid data. | 15 | Live acceptance |

## Revised Roadmap Chunks

| Chunk | Deliverable | Depends On | Enables | Verification Focus | Status |
| --- | --- | --- | --- | --- | --- |
| 01 — Pre-migration firewall and canonical revision identity | In migration 16, atomically install and close the SQLite legacy-write firewall before rebuilding/backfilling revision identity; route current compatibility/canonical writers through narrow transaction admissions. | None | 02–15 | Held-open old connection and launcher barriers; protected-operation matrix; capture insert allowed/raw delete denied; final triggers survive rebuild; deterministic backfill; integrity/rollback | Completed |
| 02 — Project mutation fence adoption | Bind every project Session mutation to both the accepted project owner/epoch and a narrow firewall admission. `legacy_compatibility` means current-runtime compatibility shape only, never old-binary write permission. | 01 | 03–15 | Authority/admission binding; stale/clone/cross-DB rejection; paused phases; no generic mint; migration 17 isolation | Completed |
| 03 — Scope-global embedding lifecycle fence | Bind Session embedding lifecycle operations and initial Session contract registration to reciprocal global authority plus firewall admission, preserving the combined public command. | 02 | 04–15 | Project/global races; generation/receipt replay; old registration denied; current lifecycle admitted; migration 18 isolation | Completed |
| 04 — Anchor job phases, permanent deny, and authority activation | Add companion phase/attempt state, permanently deny every migrated old job identity, quarantine unresumable jobs without trusting PID, atomically activate SMC authority, and reject normal starts through Chunk 11. | 02, 03 | 05–15 | Denied-target versus admitted-authority semantics; resume appends attempt; multiple-job blocker; late old spawn/provider return denied; activation atomicity | Completed |
| 05 — Deterministic evidence selection and batch planning | Define complete valid-content selection, immutable evidence normalization/hashing, deterministic byte-aware batch planning, oversize rejection, and no-agent intent classification without leasing, terminalizing, or committing a partial manifest. | 04 | 06–15 | Exact order/hashes/batch IDs; oversized-item blocker; content predicate parity; control/invalid intent never reaches SMC; no database mutation | Completed |
| 06 — Atomic complete manifest and frozen retrieval snapshot | Under project authority plus firewall admission, atomically create one new anchor, lease/copy evidence, persist batches, copy every retrieval-affecting row, prove coverage, and commit one complete manifest. Production launch remains blocked through Chunk 11. | 01, 03, 04, 05 | Admission-bound preparation; no partial state; complete base/vector coverage; denied jobs cannot prepare; 3,219-row bounded transport; migration 20 isolation | Completed |
| 07 — Overlay, journal, and receipt persistence | Add revisioned noncanonical overlay state, append-only action/result journal, idempotency keys/digests, work-set/query receipt storage, overlay CAS, additive budget-grant records, and the shared terminal-receipt schema. | 04, 05, 06 | 08–15 | Replay/digest rules; overlay CAS; stable staged IDs; terminal uniqueness; no canonical writes | Completed |
| 08 — Same-job recovery, abandonment, and retention | Implement epoch recovery, `needs_followup`, abandonment, release, and receipt-gated cleanup; all protected abandonment/reassignment writes use a new trusted owner admission and never revive a permanently denied old job identity. | 02, 03, 04, 07 | 09–15 | Fresh attempt per resume; stale owner denied; permanent deny survives abandonment/new owner; cleanup receipt/retention gates | Completed |
| 09 — Curator retrieval over frozen base and overlay | Build high-recall job-scoped lexical, semantic, evidence-explicit exact/link, and overlay retrieval. Repo/branch/commit values constrain matches on one context row; work-set growth is non-transitive. Persist ordered hit sets, stable pagination, and completion diagnostics under coordinator-owned recall controls. | 03, 06, 07, 08 | 10–15 | Partial/mismatched embeddings fail closed; fixed seed plan; scoped exact/link recall; stable cursors/digests; truncation blocks; no consumer-query logging/live hydration | Completed |
| 10 — Deterministic proposal validation and projection | Adapt the output contract and validator to selected-source coverage, affected-work-set dispositions, explicit same-revision receipt reuse, stable staged/final IDs, lifecycle/reference closure, and a digest-bound final projection—without canonical mutation. | 07, 09 | 11–15 | Exact source/work-set coverage; duplicate/missing/stale refs rejected; receipt reuse valid only for same revision; keep/supersede/retract closure; validation is read-only | Completed |
| 11 — Provider-neutral SMC coordinator loop | Implement a phase-driven protocol: coordinator-owned non-text recall and pagination, provider-owned one-at-a-time text formulation, trusted one-at-a-time audit fetch, and proposal only after coverage and audit-fetch receipts are complete. Envelopes expose only the current bounded phase payload. | 07–10 | 12–15 | Provider parity; bounded envelopes; no obligation matrix/cursor authority; exact required audit fetch; durable receipt progression; exact minimum-turn equation; explicit turn reserve/grants; direct jobs reach accepted projection | Completed |
| 12 — Atomic promotion, audit receipts, and production enablement | Make one finalizer the sole canonical/terminal owner. Its one transaction binds final project authority to firewall admission while applying canonical state, tombstones/raw deletion, receipts, and completion, then enables the complete production route. | 01–11 | 13–15 | Admission-bound atomic commit; denied old provider return rolls back; replay/drift; after-preparation recovery; indexing independence | Completed |
| 13 — Trigger scheduling, indexing order, and audit fairness | Route manual, count, age, and `session.start` eligibility through indexing-first maintenance and the new anchor service. Implement evidence-plus-audit, audit-only, and no-work selection while ensuring continuously eligible evidence cannot starve due audit work. | 03–12 | 14–15 | 60/24 fallback vs configured 25; separately typed audit partition with root limit 10; session-start control semantics; indexing-only wake creates no anchor; index failure blocks before manifest; bounded audit partition progresses under continuous evidence; no idle scheduler | Completed |
| 14 — CLI, debugging, and honest status | Expose ingest/resume/abandon, machine/debug `myelin smc`, compatibility aliases, stable JSON reason codes, project/global fence ownership, permanent-deny diagnostics, job phases, freshness, and audit coverage. | 08, 11–13 | 15 | CLI/JSON compatibility; liveness diagnostic only; denied identity visible safely; no raw evidence leakage | Completed |
| 15 — Authoritative cutover and integrated acceptance | Retire competing owners; reconcile fixed evidence-seed recall, preparation feasibility, phase-driven envelopes, coordinator pagination, required audit-fetch progression, and the independent audit-partition control; then prove firewall/admission boundaries and the full SMC scale/recovery suite. | 01–14 | Execution completion | Pre-spawn/post-spawn/pre-PID/provider-return barriers; one production owner; policy-v3 incompatible-anchor restart; audit proposal gated by exact fetch receipts; infeasible jobs leave zero state; root audit partition 10 independent of affected-work limit 1000; max turns 20 clears exact 19-turn acceptance floor; 3,219-memory successful completion; SQLite integrity; source dogfood | Completed |

## Chunk Plan Artifacts

1. `plans/01-canonical-session-memory-revision-identity.md`
2. `plans/02-project-mutation-fence-adoption.md`
3. `plans/03-scope-global-embedding-lifecycle-fence.md`
4. `plans/04-anchor-job-phases-and-legacy-migration-gate.md`
5. `plans/05-deterministic-evidence-selection-and-batch-planning.md`
6. `plans/06-atomic-complete-manifest-and-frozen-retrieval-snapshot.md`
7. `plans/07-overlay-journal-and-receipt-persistence.md`
8. `plans/08-same-job-recovery-abandonment-and-retention.md`
9. `plans/09-curator-retrieval-over-frozen-base-and-overlay.md`
10. `plans/10-deterministic-proposal-validation-and-projection.md`
11. `plans/11-provider-neutral-smc-coordinator-loop.md`
12. `plans/12-atomic-promotion-and-audit-receipts.md`
13. `plans/13-trigger-scheduling-indexing-order-and-audit-fairness.md`
14. `plans/14-cli-debugging-and-honest-status.md`
15. `plans/15-authoritative-cutover-and-integrated-acceptance.md`

The original chunk artifacts were approved and execution began. The approved firewall correction
reopened the full dependency chain. The corrected full plan-set audit returned Ready for
Development (67/70); the user authorized continuation, so this revised set is Approved for Execution.

## Dependency And Parallelism Order

Required critical path:

1. Chunk 01 installs/closes the legacy-write firewall before any incompatible schema change, then
   establishes canonical revision identity and admitted current-runtime compatibility writes.
2. Chunks 02–03 bind project and Session-scope global ownership to narrow firewall admissions.
3. Chunk 04 introduces the anchor phase model, permanent deny identities, quarantine, and authority
   activation without using PID as an integrity signal.
4. Chunk 05 defines deterministic evidence planning without mutation; Chunk 06 atomically freezes
   evidence and memory/retrieval state in one complete manifest transaction.
5. Chunks 07–08 establish staged persistence, then recovery and cleanup.
6. Chunks 09–10 establish complete curator retrieval and read-only proposal validation.
7. Chunk 11 connects provider reasoning to trusted retrieval/validation/staging as a direct service
   while production remains blocked.
8. Chunk 12 becomes the sole atomic canonical promotion boundary and first enables ordinary
   production start/resume because coordinator and finalizer are both available.
9. Chunks 13–14 integrate scheduling first, then operator/debug/status surfaces.
10. Chunk 15 removes competing owners and proves the integrated system.

Safe limited parallelism:

- The roadmap defines no partial execution inside an unaccepted chunk. Formal dependencies are the
  approval boundaries.
- After Chunk 08, non-mutating inventory for later CLI/status and cutover work may be prepared, but
  Chunks 09–15 still complete in dependency order because they share retrieval, validation, and
  production-entry ownership.
- Executor sub-agents may parallelize tests, documentation inventory, or isolated provider-adapter
  work only inside one approved chunk under explicit file ownership. Such delegation does not change
  cross-chunk dependencies or acceptance.

## Shared Contracts And Integration Points

- `SessionMemoryRevisionIdentity`: memory ID, monotonic revision, versioned canonical state digest.
- `SessionMemoryLegacyWriteFirewall`: migration-16 SQLite triggers plus a closed default state that
  deny protected old-runtime DML before revision schema changes occur.
- `SessionMemoryWriteAdmission`: transaction-scoped, uncommitted authority record bound to exact
  operation, project/scope, owner, and epoch; internal Myelin services alone may mint it.
- Protected operation matrix: deny old `ingest_jobs` lifecycle/PID writes, tombstone
  lease/reassign/finalize, raw evidence deletion, canonical memory/context/link DML, and initial
  Session embedding-contract registration; allow Experience Log capture inserts.
- `LegacySessionJobDenyIdentity`: immutable job identity that permanently prevents that old job from
  ever being admitted authority, including after abandonment or a later owner takes the project.

Protected table-by-operation matrix (migration-owned admission is valid for every row only inside
migration 16; no runtime bypass exists):

| Table | Verb / row predicate | Allowed trusted admission operations | Unadmitted behavior |
| --- | --- | --- | --- |
| `ingest_jobs` | `INSERT` | `compat_job_create`, `anchor_prepare` | Reject |
| `ingest_jobs` | `UPDATE` | `compat_job_transition`, `migrate_legacy_anchor`, `anchor_resume`, `anchor_finalize`, `anchor_abandon` | Reject |
| `ingest_jobs` | `DELETE` | None; compact job audit identity is retained | Reject |
| `experience_event_tombstones` | `INSERT` | `compat_event_lease`, `anchor_prepare` | Reject |
| `experience_event_tombstones` | `UPDATE` | `compat_event_lease`, `migrate_legacy_anchor`, `anchor_resume`, `anchor_finalize`, `anchor_abandon` | Reject |
| `experience_event_tombstones` | `DELETE` | None; terminal/forensic tombstones are retained | Reject |
| `experience_events` | `INSERT` | None; append-only capture remains intentionally open | Allow |
| `experience_events` | `UPDATE` | None | Reject |
| `experience_events` | `DELETE` | `compat_event_finalize`, `anchor_finalize` | Reject |
| `session_memories` | `INSERT`, `UPDATE`, `DELETE` | `compat_canonical_apply`, `repair_session_memory`, `anchor_finalize` | Reject |
| `session_memory_contexts` | `INSERT`, `UPDATE`, `DELETE` | `compat_canonical_apply`, `repair_session_memory`, `anchor_finalize` | Reject |
| `session_memory_links` | `INSERT`, `UPDATE`, `DELETE` | `compat_canonical_apply`, `repair_session_memory`, `anchor_finalize` | Reject |
| `embedding_contracts` | `INSERT` where `NEW.scope = 'session_memory'` | `register_session_embedding_contract`, `session_embedding_lifecycle` | Reject |
| `embedding_contracts` | `UPDATE` where `OLD.scope = 'session_memory' OR NEW.scope = 'session_memory'` | `session_embedding_lifecycle` | Reject |
| `embedding_contracts` | `DELETE` where `OLD.scope = 'session_memory'` | `session_embedding_lifecycle` | Reject |

Project-scope embedding-contract rows are unchanged by this Session-only firewall. Each allowed
operation is further constrained by its project/scope, owner, epoch, and phase predicate; naming an
operation does not confer authority by itself.
- `ProjectSessionMutationFence`: project, owner job, phase, epoch, heartbeat, and terminal receipt;
  every canonical Session writer must use it.
- `SessionMemoryAuthorityMode`: durable `legacy_compatibility|smc_v1`; compatibility means the
  current runtime may execute the legacy-shaped path under admission, not that old binaries write.
- `SessionEmbeddingLifecycleFence`: scope-global operation/phase/epoch/heartbeat/target-contract
  identity, reciprocally exclusive with all project fences.
- `SessionMemoryAnchorJob`: unchanged `ingest_jobs` compatibility handle plus authoritative companion
  phase/epoch row; Chunk 04 creates companion rows only for quarantine and Chunk 06 alone creates
  ordinary complete-manifest anchors through a direct service. Production start/resume remains
  blocked until Chunk 12 wires that service to the coordinator and finalizer. Batches/turns are internal.
- `SMCManifest`: selected evidence, immutable base state and vectors, retrieval/policy/provider
  identities, deterministic ordering/budgets, and aggregate digests.
- `SMCAction` / `SMCResult`: versioned `query`, `fetch_record`, `submit_proposal`, and `blocker`
  protocol with job/attempt/sequence/batch/epoch identities.
- `SMCProviderPhase`: trusted `text_formulation|audit_fetch|proposal_ready` playbook. `audit_fetch`
  names exactly one required batch/memory/revision/byte-bound fetch; its successful durable receipt
  advances the coordinator to at most one next member.
- `SMCOverlayRevision` and journal idempotency: expected-revision CAS plus same-key/same-digest replay.
- `SMCTerminalReceipt`: shared anchor-owned unique terminal receipt with a discriminated
  `smc_manifest|legacy_quarantine` basis, target epoch, result/receipt digests, and
  cleanup-eligibility predicate;
- `SMCCuratorBatchChannelPlan`: append-only job/batch authority derived from frozen evidence seeds
  and accepted overlay identity. Evidence repo/branch/commit fields constrain candidate matches;
  affected work never creates new obligations. Per-obligation/channel receipts prove fixed-plan
  exhaustion;
  Chunk 08 writes abandonment receipts and Chunk 12 writes finalization receipts.
- `CuratorQueryReceipt`: applicable channels, frozen recall controls, ordered IDs, page cursor,
  truncation/completion state, snapshot/overlay identity, and digest.
- `SessionMaintenanceProjection`: exact source and affected-memory dispositions, outputs, lifecycle
  targets, stable references, and accepted digest.
- Finalization/abandonment/audit receipts: canonical, idempotent evidence for terminal effects and
  per-memory-revision coverage.
- Operator contracts: existing `myelin ingest`, embedding lifecycle commands, status, and new
  machine/debug `myelin smc` surface; JSON outputs carry stable reason codes.
- Config contracts: fallback 60 valid content entries or 24-hour eligibility; project overrides;
  a separately typed per-anchor audit partition limit; evidence-item/batch and curator budgets;
  exact frozen minimum-turn feasibility; coordinator-owned semantic thresholds/result ceilings;
  bounded forensic retention.
- Authority: SMC and provider adapters are proposal/read only. Trusted Myelin services alone own
  snapshotting, retrieval execution, staging CAS, leases, canonical promotion, and cleanup.

## Approved-Source Coverage

| Requirement / Acceptance Criterion | Covered By | Notes |
| --- | --- | --- |
| Incompatible migrations never race an old Session writer | 01, 15 | Migration 16 closes DB-enforced firewall first; exact old runtime is denied through held-open connections and launch barriers |
| Trusted writes use narrow transaction admission; no public mint exists | 01–04, 06, 08, 12, 15 | Admission binds operation/scope/owner/epoch and is invisible to another connection |
| Capture inserts remain available while old mutation/deletion is denied | 01, 15 | Protected-operation matrix distinguishes append-only input collection from curation mutation |
| Permanent deny survives abandonment and later owners | 04, 08, 15 | Denied job may be a mutation target under a new trusted authority but never authority itself |
| One invocation creates one anchor job; internal batches/turns are not jobs | 04, 06, 11, 12, 13 | Chunk 04 blocks starts; Chunk 06 owns direct atomic creation; Chunk 11 provides coordinator service; Chunk 12 first enables complete production creation/launch/finalization |
| No prompt proportional to all active Session Memory | 05, 06, 09, 11, 15 | Frozen rows and retrieval replace snapshot-wide transport |
| SMC runs in target repo and may verify repository evidence read-only | 11 | Provider-neutral coordinator preserves Codex sandbox rule |
| SMC is proposal-only; Myelin is sole canonical writer | 07, 10–12, 15 | Legacy competing writers are fenced or retired |
| Later batches see earlier accepted staged work | 07, 09, 11 | Overlay read-your-writes plus synchronous overlay embeddings |
| Affected-neighborhood curation scales; rolling audit covers other revisions while maintenance succeeds | 09–13 | Per-revision receipts prove coverage; idle/no-work claims none |
| Continuously eligible evidence cannot starve bounded due audit work | 13, 15 | Each eligible job includes one due audit partition after selected evidence |
| Status distinguishes incremental freshness from rolling-audit coverage | 14, 15 | Blocked/no-work/indexing failure cannot overclaim progress |
| Required curator retrieval fails closed and never silently becomes lexical/top-k | 06, 09 | Applicable channels and receipt completeness are deterministic |
| Immutable evidence/memory/retrieval snapshot supports same-job resume | 05–08 | Live state is final CAS input only |
| Every selected source and affected-memory member has exact coverage | 07, 09, 10, 12 | Receipt reuse is explicit and revision-bound |
| Every frozen audit member is fetched before proposal | 07, 10, 11, 15 | Policy v3 exposes one exact required audit fetch at a time; missing receipts keep `proposal_ready` unavailable |
| Project writers and global embedding lifecycle are mutually exclusive | 02, 03 | Reciprocal atomic admission includes new projects |
| Hard crashes resume the same job/operation; stale epochs cannot mutate | 02–04, 08, 12 | Explicit abandonment is the only incompatible release |
| Final promotion and commit-before-ack recovery are atomic/idempotent | 12 | Finalization receipt is written in the canonical transaction |
| Manual ingest supports evidence-plus-audit, audit-only, and no-work | 13, 14 | No separate audit command required |
| `session.start` is control, not evidence, and is the primary below-threshold wake | 05, 13 | No idle scheduler or installation change |
| Control-only and legacy-invalid rows use deterministic no-agent finalization | 05, 06, 12, 15 | Chunk 05 classifies intent, Chunk 06 copies/leases it, and Chunk 12 alone terminalizes/deletes it; rows never enter SMC |
| 60/24 fallback defaults remain independent of batch/prompt sizing | 13 | Existing configured 25 remains an override |
| Derived indexing runs first when needed and never creates an anchor alone | 06, 09, 13 | Index failure blocks before manifest acceptance |
| Existing jobs/tombstones/history migrate without evidence loss | 01–04, 08, 15 | Firewall denies stale mutation; quarantine/abandonment preserve evidence and assign permanent deny identity |
| Governing policy changes cannot silently rebase active anchors | 08, 11, 15 | Earlier-policy anchors are incompatible and require explicit abandonment plus a fresh manifest |
| Migration supports rollback/isolation and SQLite integrity proof | 01–04, 15 | Firewall install/closure, schema rebuild, and migration version are one atomic migration; final triggers are probed after rebuild |
| Receipt-gated forensic cleanup has one owner | 08, 15 | Retention configuration is resolved in 08; final acceptance proves it |
| Session inbox, Project Memory reliability, installation, commit, and push remain out of scope | All | No chunk owns these behaviors |
| Old one-shot and worker apply paths stop being production owners | 15 | One authoritative SMC workflow remains |
| Focused behavior-level tests replace stale prompt/trimming assertions | 01–15 | User explicitly authorized test changes |

## Verification Strategy

Verification is layered and evidence-sized:

1. Each chunk runs `bun run typecheck`, `git diff --check`, and the narrowest affected Bun test
   files. New tests protect approved state, authority, replay, atomicity, and retrieval contracts;
   they do not mirror implementation details.
2. Storage and lifecycle chunks run populated-database migrations followed by SQLite
   `PRAGMA foreign_key_check` and `PRAGMA integrity_check`, plus deterministic concurrency/crash
   simulations through injected seams.
3. Provider, retrieval, and scheduling tests use injected providers/fetch/process boundaries and
   fixture stubs. They do not depend on localhost, internet, or sandbox behavior.
4. Integrated verification runs the relevant Session slices under `tests/ingest/`, `tests/memory/`,
   `tests/maintenance/`, `tests/capture/`, `tests/commands/`, and `tests/status/`, then typecheck and
   diff validation.
5. Final dogfood uses the source CLI, not an installed runtime. It verifies provider/embedding host
   access before running ingest, inspects job/fence/tombstone/accepted-result/audit rows in SQLite,
   and queries Session Memory to prove the new continuity is retrievable. A host-access failure is
   reported as typed environment unavailability and leaves evidence pending rather than failed.

## Risks And Sequencing

- Migration is the highest-risk seam. The firewall must be installed and closed before migration 16
  rebuilds any protected table. Final-schema triggers must be reinstalled/probed after each rebuild;
  a migration failure rolls back firewall, schema, and version together.
- Process liveness cannot establish quiescence. PID/argv checks are diagnostic only. Safety comes
  from old-runtime DML denial, permanent job deny identity, and transaction-bound admissions.
- A long-lived paused project anchor intentionally blocks global embedding lifecycle work. Status
  and explicit resume/abandon must exist before operator cutover.
- A global embedding operation intentionally blocks every Session project start, including newly
  registered projects. Admission must be one SQLite transaction, not check-then-write.
- Frozen snapshot, overlay, journal, query receipts, and terminal receipts add storage. Cleanup is
  allowed only after durable completion/abandonment and must use the configured retention boundary.
- Curator completeness depends on active-contract indexing and provider access. Indexing-first and
  typed fail-closed behavior protect correctness but may delay curation.
- The current dirty worktree contains overlapping Session Memory and sandbox work. Executors must
  review the live diff at every chunk boundary and preserve all unrelated/user-owned changes.
- Cutover must be singular: the current one-shot `src/session-maintenance/workflow.ts` and legacy
  apply logic in `src/ingest/worker.ts` cannot remain alternate production paths.
- No installation, commit, push, or Project Memory reliability work is authorized by this plan set.

## Execution Handoff

An executor must load the approved spec, agenda, CONTEXT glossary, ADR 0070, this roadmap, the
approved chunk file being executed, and the live dirty-worktree diff. Chunks execute in dependency
order; only the limited parallel work named above is safe.

Stop when:

- a required predecessor chunk is not accepted;
- live code contradicts an approved architecture/data/security contract;
- a migration cannot preserve raw evidence, stable identities, or rollback/isolation;
- a proposed implementation would create a second canonical writer, weaken retrieval completeness,
  infer sandbox denial, or expand into an excluded scope;
- verification exposes a contract failure not owned by the active chunk.

The user approved the corrected design and continuation on 2026-08-11. Resume implementation only
after this revised plan set receives external `Ready for Development`; installation, commit, push,
and publication remain unauthorized.

## User Approval

- Roadmap approved by: User, 2026-08-11
- Plan set approved for execution by: User, 2026-08-11, effective after corrected external plan-set
  audit returned Ready for Development (67/70)
