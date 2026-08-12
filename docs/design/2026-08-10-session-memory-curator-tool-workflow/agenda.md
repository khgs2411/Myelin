# Session Memory Curator Tool Workflow Design Agenda

## Status

- Spec: `docs/design/2026-08-10-session-memory-curator-tool-workflow/spec.md`
- State: Approved — eligible for implementation planning
- Approval: Original design approved after external audit; pre-migration firewall correction approved by user on 2026-08-11

## Documented Decisions

- The agent role is named Session Memory Curator (SMC).
- The full `$pmp-specifying-features` → `$pmp-writing-plans` → `$pmp-executing-plans`
  workflow is being used. Pseudocode is optional supporting material, not a substitute for an
  approved design.
- SMC maintenance is Session Memory-only in this design. Project Memory reliability and curation,
  Droplet Bot, Practice/Personal consumers, installation, commit, and push are outside scope.
- Inputs remain provider-neutral; Codex hooks are the only Session Memory evidence adapter in this
  refactor. Session inbox support is deferred.
- SMC runs in the target repository and may inspect repository evidence to verify selected claims.
- `myelin ingest <project-key>` remains the operator entry point. One invocation creates one durable
  anchor job; internal evidence batches and query pages are not jobs.
- SMC gets a dedicated `myelin smc ...` machine contract separate from end-user memory query.
- Selected evidence is processed in bounded sequential batches. Later batches see the accepted
  staged overlay from earlier batches.
- SMC is proposal-only. Myelin is the sole canonical writer and source-terminalization authority.
- Raw evidence remains until one accepted final promotion. Canonical memory changes, lifecycle
  changes, tombstones, raw-row deletion, accepted result, and job completion remain one SQLite
  transaction.
- Session Memory lifecycle is non-destructive: keep, supersede, or retract rather than physical
  deletion.
- Manual and automatic maintenance use the same workflow. Thresholds govern invocation cost, not
  prompt size.
- Session Memory indexing remains derived post-commit work and cannot roll trusted memory back.
- Incremental SMC curation uses high-recall affected-memory work sets. A separate rolling audit
  eventually reviews every active memory revision; normal ingest does not scan the whole corpus.
- Required semantic curator retrieval fails closed when unavailable; lexical-only results never
  silently stand in for the complete curator retrieval contract.
- SMC progress uses a revisioned SQLite overlay and resumes under the same anchor job only while all
  governing identities and accepted digests match. A resumable job retains project mutation
  ownership.
- Session Memory self-maintenance is event-driven. Capture checks the 60-entry threshold after
  durable storage; `session.start` checks below-threshold age eligibility and advances a bounded
  rolling-audit slice; manual ingest remains unconditional. Idle projects do not wake themselves.
- Default automatic eligibility is 60 valid Experience Log content entries or 24 hours, whichever
  becomes eligible first and is observed by a wake signal.
- Focused behavior-level tests are authorized for the SMC workflow replacement, including updates
  to stale one-shot prompt/trimming expectations.
- Migration 16 closes a SQLite legacy-write firewall before any incompatible Session Memory schema
  change. Old binaries never receive write admission; new-runtime compatibility writes use
  transaction-scoped admission until SMC authority activation.

## Questions

### Question 1: SMC Tool Interaction Protocol

- Status: Answered
- Why it matters: Codex-backed SMC runs in a read-only sandbox, while semantic retrieval may require
  provider connectivity and staged overlay mutation must occur outside the agent. The choice
  determines provider neutrality, number of agent turns, CLI semantics, and the security boundary.
- Scenario: While processing one evidence batch, SMC wants to search Session Memory for three
  reformulated concepts and then revise a staged replacement created during the previous batch.
- Options:
  - A. Coordinator-mediated tool loop — SMC returns a typed `query` or `proposal` action; Myelin
    executes dedicated SMC services/CLI operations outside the agent sandbox, persists accepted
    overlay revisions, and continues the bounded SMC conversation. Strongest sandbox, network,
    validation, and provider-neutral boundary, but requires a multi-turn coordinator protocol.
  - B. Agent-executed read-only CLI plus host-staged output — SMC directly runs `myelin smc` read
    commands inside its sandbox and returns one batch proposal; Myelin stages it after exit.
    Simpler orchestration, but child-process network access, installed-runtime identity, and
    Codex/Claude parity can make retrieval unreliable.
  - C. Agent-executed read/write CLI — SMC directly queries and stages changes. Most natural shell
    experience, but conflicts with the read-only sandbox and gives untrusted agent execution durable
    mutation authority.
- Recommendation: A. Preserve the dedicated CLI/service contract, but let the trusted coordinator
  execute requests and own staging. This gives SMC real query agency without making child sandbox
  permissions or provider-specific shell behavior part of memory correctness.
- Answer: A. Use a coordinator-mediated tool loop.
- Resulting decision: SMC returns typed query, record, proposal, or blocker actions. Trusted Myelin
  validates and executes the matching SMC service outside the child agent sandbox, owns every
  overlay revision, and continues the bounded logical conversation. `myelin smc ...` exposes the
  same service contracts for operator inspection/debugging, but direct child CLI execution is not a
  correctness dependency.
- Spec changes: Expanded Dedicated SMC Surface and Permissions, Security, And Privacy with the
  provider-neutral action/result loop and trusted execution boundary.

### Question 2: Scalable Memory Coverage Model

- Status: Answered
- Why it matters: Reviewing every active memory after every input batch does not scale to projects
  with thousands of memories, but retrieval-only curation can miss a stale contradiction.
- Scenario: A project has 3,219 active memories and receives 120 new Experience Log items, most
  concerning two subsystems.
- Options:
  - A. Affected-neighborhood curation plus rolling global audit — each evidence batch gets a
    high-recall memory work set with exact dispositions; untouched memory is implicit keep, while a
    separate watermark-driven audit eventually revisits every active memory. Scales with change and
    retains eventual full coverage.
  - B. Cursor-review every active memory in every anchor job — strongest immediate enumeration, but
    cost and latency grow with the entire memory corpus after every trigger.
  - C. Affected-neighborhood curation only — cheapest normal path, but memories missed by retrieval
    may remain stale indefinitely.
- Recommendation: A. It is the only option that scales normal work without abandoning eventual
  corpus-wide maintenance.
- Answer: A. Use affected-neighborhood curation plus a rolling global audit.
- Resulting decision: Every selected source and every active memory admitted to an incremental work
  set receives an exact disposition. Other active memories are implicit keep for that job. A
  separate watermark-driven audit reviews bounded oldest, never-audited, or invalidated memory
  partitions until every active memory revision has eventual coverage.
- Spec changes: Updated Incremental Curation And Coverage, added Rolling Global Audit, separated
  incremental freshness from audit coverage, and made the scaling model authoritative.

### Question 3: Curator Retrieval Degradation

- Status: Answered
- Why it matters: SMC retrieval combines lexical, semantic, metadata, link, and overlay channels.
  Semantic search can be unavailable because indexing or provider access is degraded; silently
  shrinking recall would make successful curation misleading.
- Scenario: Lexical search and complete ID lookup work, but the active semantic query provider is
  unreachable during one maintenance job.
- Options:
  - A. Fail closed before finalization — leave evidence recoverable until all required retrieval
    channels are available. Strongest recall claim, but memory freshness can stall during provider
    outages.
  - B. Continue with explicit degraded coverage plus mandatory rolling audit — use complete lexical,
    metadata, link, and overlay channels; record semantic degradation and schedule re-audit when the
    channel recovers. More available, but immediate affected-neighborhood recall is weaker.
  - C. Continue silently with available channels — simplest, but produces false confidence and is
    incompatible with the reliability goal.
- Recommendation: B. The approved rolling audit provides the recovery path for explicitly degraded
  semantic coverage. Never continue silently.
- Answer: A. Fail closed before finalization.
- Resulting decision: Required semantic retrieval availability and indexed coverage are curation
  preconditions. If unavailable, SMC stops without accepting further curation or canonical
  promotion. Raw evidence remains recoverable and previously staged work remains noncanonical.
- Spec changes: Updated Curator Retrieval Contract and Failure And Recovery Behavior to make
  semantic-channel availability a fail-closed gate.

### Question 4: Overlay Persistence And Resume

- Status: Answered
- Why it matters: Sequential work can span several agent turns and fail midway. The overlay must be
  durable enough for recovery without replaying stale reasoning against changed memory or evidence.
- Scenario: SMC completes 8 of 12 evidence batches, then its provider process exits. Canonical
  memory is unchanged and raw evidence remains leased.
- Options:
  - A. Revisioned SQLite overlay with same-job resume — resume only when snapshot, evidence, policy,
    output contract, tool protocol, provider/model, and staged digests still match. Strong recovery
    and read-your-writes, with additional staging schema and lifecycle state.
  - B. Durable overlay, but failed attempts always restart in a new job — safer than ambiguous
    resume and simpler identities, but discards accepted staged work and repeats cost.
  - C. Filesystem or conversation-only progress — smallest implementation, but not authoritative,
    transactionally safe, or reliably resumable.
- Recommendation: A. The additional state is justified because long sequential curation otherwise
  turns transient provider failure into repeated expensive full work.
- Answer: A. Use a revisioned SQLite overlay with same-job resume.
- Resulting decision: Accepted batch proposals advance a compare-and-set overlay revision. Provider
  or worker interruption pauses the same job in a resumable `needs_followup` phase while retaining
  leases and project single-flight ownership. Resume is allowed only when snapshot, evidence,
  policy, output contract, SMC protocol, provider/model, overlay, and response identities match;
  otherwise the overlay must be explicitly abandoned and a new job started.
- Spec changes: Expanded Trusted Coordinator And Overlay and Failure And Recovery Behavior with the
  SQLite revision, identity gate, resumable job ownership, and abandonment boundary.

### Question 5: Maximum-Age Wake Mechanism

- Status: Answered
- Why it matters: An age predicate evaluated only by hooks does not run when a project becomes idle.
  A real time guarantee requires a wake source and expands operational lifecycle.
- Scenario: Ten valid inputs remain below the count threshold, the repository receives no further
  hooks for two days, and no operator runs ingest manually.
- Options:
  - A. Add a periodic Myelin wake mechanism in this design — guarantees the configured maximum age,
    but introduces timer/service installation, lifecycle, and observability work.
  - B. Add maximum-age eligibility now, evaluated by capture, `session.start`, status/maintenance
    checks, and manual commands; defer a clock-driven service. Preserves the policy and improves
    freshness without expanding deployment topology, but idle queues can exceed the age target.
  - C. Keep count/manual/session-start only — simplest, but does not address age-based freshness.
- Recommendation: B for this Session Memory slice. It establishes the correct policy contract while
  keeping always-on service installation outside an already substantial redesign.
- Answer: B. Add maximum-age eligibility now and defer a clock-driven service.
- Resulting decision: Capture after storage, `session.start`, explicit maintenance entry points, and
  manual ingest evaluate count/age eligibility. Status may report overdue eligibility but does not
  schedule work as a hidden write. Idle projects may exceed the target until the next wake signal;
  a future periodic service can close that gap without changing SMC semantics.
- Spec changes: Updated Trigger Policy with the eligibility/wake distinction, explicit overdue
  status behavior, and deferred always-on service boundary.
- Confirmed by the later clarification in Question 10: no clock-driven service is part of this
  design. Maximum age is eligibility observed at `session.start` or another existing wake, not a
  wall-clock freshness guarantee for idle projects.

### Question 7: Default Automatic Eligibility

- Status: Answered
- Why it matters: The defaults establish the cost/freshness posture for every newly configured
  project. Count is measured in valid Experience Log content entries, not anchor jobs or internal
  SMC batches.
- Scenario: Normal Codex work produces alternating user and assistant entries. The project stays
  active daily, and manual ingest remains available for urgent freshness.
- Options:
  - A. 120 entries or 24 hours — roughly sixty two-message exchanges before the volume trigger,
    materially reducing invocation frequency while bounding normal staleness to the next wake after
    one day.
  - B. 60 entries or 12 hours — fresher memory with approximately twice the volume-triggered
    maintenance frequency.
  - C. Keep 25 entries and add 24 hours — preserves current frequent invocation behavior and gains
    little of the requested cost reduction.
- Recommendation: A. Work batching removes the prompt-size reason for a low threshold, and manual
  ingest plus `session.start` remains available when immediate freshness matters.
- Answer: Custom option D: 60 entries or 24 hours.
- Resulting decision: New projects default to automatic eligibility when valid queued content
  reaches 60 entries or the oldest valid content reaches 24 hours. Project configuration may
  override both values. Entry count is independent of SMC work-batch and prompt sizing.
- Spec changes: Updated Trigger Policy with the approved default values and configuration boundary.

### Question 6: Contract Test Authorization

- Status: Answered
- Why it matters: Repository policy forbids creating or modifying tests without explicit user
  approval. This redesign replaces core ingest behavior and needs durable protection for coverage,
  staging, retry, and atomicity rather than patch-specific assertions.
- Options:
  - A. Authorize focused contract tests — replace stale one-shot prompt/trimming expectations and
    add behavior-level coverage for SMC work sets, overlay CAS, resume, finalization, provenance,
    trigger eligibility, and sandbox/provider boundaries.
  - B. Do not modify tests — implementation may use typecheck, inspection, and live dogfood only,
    leaving core invariants without automated regression protection.
- Recommendation: A. The tests protect general reliability contracts and are proportionate to a
  core workflow replacement.
- Answer: A. Authorize focused contract tests.
- Resulting decision: Implementation may replace stale one-shot prompt/trimming tests and add
  behavior-level tests for work-set coverage, overlay revisions, same-job resume, fail-closed
  retrieval, atomic finalization, provenance, trigger eligibility, and sandbox/provider boundaries.
- Spec changes: Testing And Acceptance Evidence is approved as the implementation verification
  boundary.

### Question 8: Authoritative Immutable Job Snapshot

- Status: Answered
- Why it matters: Same-job resume, deterministic retrieval, and finalization cannot depend on live
  Experience Log, Session Memory, link, or index rows changing underneath the anchor job. The
  current tombstone lease stub retains `{}` rather than a complete evidence copy, and the current
  snapshot token does not freeze every retrieval-affecting field.
- Scenario: SMC pauses after several accepted batches. Before it resumes, another process changes a
  memory link, an embedding row, or a selected Experience Log row. Resume must either reproduce the
  exact prior view or fail before any further proposal is accepted.
- Options:
  - A. Job-owned immutable normalized SQLite snapshot rows — in the same `BEGIN IMMEDIATE`
    transaction that creates leases and the manifest, copy selected evidence and every
    retrieval-affecting base-memory field, context, link, normalized-text hash, and frozen embedding
    contract/index-readiness identity and vector into job-scoped rows. Strongest inspectability,
    foreign-key integrity, deterministic pagination, and transaction boundary, at the cost of
    bounded per-job duplication.
  - B. Immutable content-addressed SQLite blobs plus a job manifest — deduplicate identical content
    across jobs and bind it through foreign keys and digests. Reduces duplicated bytes, but adds
    indirection, garbage collection, and more complex recovery semantics before scale proves the
    storage benefit necessary.
  - C. Live canonical rows plus manifest hashes — store only identities and hashes, then reread live
    rows and fail on drift. Smallest storage footprint, but cannot support a stable paused query
    view or reliable same-job resume after otherwise unrelated canonical changes.
- Recommendation: A. The anchor job needs a self-contained, queryable, transactionally created
  view. Normalized job-owned rows are simpler and more reliable than introducing a global blob
  store, and unlike live-row references they actually satisfy the approved resume contract.
- Answer: A. Use job-owned immutable normalized SQLite snapshot rows.
- Resulting decision: The lease/manifest transaction copies selected evidence plus every
  retrieval-affecting active-memory field, revision, context, link, normalized search text/hash,
  embedding-contract identity, completeness identity, and vector into normalized job-scoped rows.
  SMC retrieval and resume use only that frozen base plus the revisioned overlay; live canonical
  rows are used only for final compare-and-set validation.
- Spec changes: Made the immutable job snapshot representation authoritative in Immutable Job
  Manifest, Job-Scoped Memory View, Curator Retrieval Contract, and Data And State.

### Question 9: Rolling-Audit Wake Guarantee

- Status: Answered
- Why it matters: Question 2 promised eventual review of every active memory revision, while the
  earlier maximum-age decision deferred any clock-driven wake. Without a periodic wake, an idle
  project can retain unaudited revisions forever.
- Scenario: A project has no new captures or session starts for several months, but some active
  memory revisions have never been audited under the current policy and tool identities.
- Options:
  - A. Add a periodic Myelin maintenance wake in this design — each wake evaluates overdue queued
    evidence and advances a bounded audit partition. This makes eventual review an operational
    guarantee, but adds timer/service lifecycle and observability to this Session Memory slice.
  - B. Keep the event-driven wake boundary and weaken the guarantee — audit progresses only while
    Myelin receives capture, session-start, manual, or maintenance wake signals. Avoids a new
    service, but “eventual” is conditional rather than guaranteed for idle projects.
  - C. Remove rolling global audit — preserves the smaller operational boundary but allows memories
    missed by affected-neighborhood retrieval to remain stale indefinitely.
- Recommendation: A. Once rolling audit is part of the reliability contract, the system needs a
  real wake source. The same periodic wake can evaluate the already-approved maximum-age predicate
  rather than creating two schedulers.
- Answer history: An earlier short answer, “question 2: A,” was interpreted as selecting option A.
  Question 10 then clarified that idle projects should not invoke Myelin and `session.start` is the
  intended self-maintenance wake.
- Revised answer: B. Keep the event-driven wake boundary and make rolling-audit progress conditional
  on Session Memory maintenance being invoked.
- Resulting decision: `session.start` advances one bounded due audit partition and evaluates queued
  evidence age. Count-triggered and manual maintenance also advance bounded audit work. Audit
  coverage is recorded per memory revision and governing identities; a scalar cursor alone is not
  proof. Idle projects do no work and carry no wall-clock audit guarantee.
- Spec changes: Rolling Global Audit, Trigger Policy, and testing evidence now state the
  event-conditioned guarantee explicitly.

## Pressure-Test Result

- Status: Complete — pre-migration activation-race finding incorporated
- Categories checked: lifecycle, persistence, recovery, permissions, provider boundary, retrieval
  completeness, scheduling, acceptance evidence
- New questions added: authoritative immutable job snapshot; rolling-audit wake guarantee;
  pre-migration legacy-write isolation
- Required design corrections: authoritative action journal, DB-enforced project mutation fence,
  frozen retrieval-completeness proof including overlay retrieval, and crash-idempotent finalization
  receipt
- Remaining non-blocking risks: snapshot, overlay, journal, and receipt retention must use a bounded
  policy; the exact retention duration is operational configuration rather than a correctness
  choice because cleanup may occur only after a durable finalization or abandonment receipt

## External Design Audit

- Auditor: Software Architect sub-agent using `$plan-auditor`
- First verdict: Needs Refinement (49/70)
- Second verdict after refinement: Needs Refinement (53/70)
- Final verdict: Ready for Development (66/70); no critical issues remain
- Blocking areas after clarification: stale mutation-fence recovery; authoritative memory revision
  and embedding-contract compatibility; durable ADR and glossary reconciliation. The periodic-wake
  issue is resolved by removing the idle-time guarantee, and Session inbox complexity is removed
  from scope.
- Re-audit gate: the same Software Architect must return Ready for Development before
  `$pmp-writing-plans`
- Migration-correction re-audit: Ready for Development (66/70), no critical issues; affected
  roadmap/chunk plans must be revised and re-audited before execution resumes.

### Question 10: Periodic Wake Host And Installation Lifecycle

- Status: Answered
- Why it matters: A real idle-project guarantee requires a machine clock source. The current
  maintenance service only runs when another process calls it, while installed Myelin code is owned
  by immutable runtime versions and the design currently excludes installation work.
- Scenario: Myelin is installed, the active runtime is upgraded or rolled back, and a registered
  project receives no hooks for two days. The scheduler must invoke the active version, discover the
  project once, and avoid duplicate maintenance jobs.
- Options:
  - A. Managed per-user scheduler installed by Myelin — extend this slice narrowly so install,
    upgrade, rollback, prune, and uninstall own a platform scheduler entry that invokes the stable
    `myelin` launcher. The launcher resolves the active immutable version on every tick; a
    Myelin-owned tick command discovers registered projects, applies interval/jitter and due checks,
    and relies on the SQLite mutation fence for deduplication. Strongest real guarantee and version
    safety, but explicitly brings scheduler installation/lifecycle into scope.
  - B. Long-lived Myelin daemon — one resident process owns timers and maintenance dispatch. Offers
    richer coordination, but introduces a new daemon lifecycle, restart, logging, upgrade handoff,
    and resource model far beyond the needed clock signal.
  - C. External scheduler contract only — document a stable `myelin maintenance tick` command for
    operators to wire into cron/launchd/systemd. Keeps installation out of scope, but Myelin cannot
    guarantee idle-project wake coverage because scheduling is optional external setup.
- Recommendation: A. It is the smallest topology that honestly fulfills the already-approved real
  wake guarantee. The scheduler entry points only to the stable launcher, so immutable version
  activation and rollback remain authoritative.
- Answer: Custom option D. Do not add a periodic scheduler; idle projects should not invoke Myelin.
- Resulting decision: `session.start` is the primary self-maintenance wake. It evaluates
  below-threshold age eligibility and advances one bounded rolling-audit slice. Capture after durable
  storage checks the 60-entry threshold, and manual ingest remains available. The 24-hour setting is
  an eligibility condition observed at a wake, not an idle-time execution guarantee. Installation,
  upgrade, rollback, and uninstall remain outside this design.
- Spec changes: Removed the periodic wake and weakened corpus-audit language to guaranteed progress
  while maintenance is invoked.

### Question 11: Stale Mutation-Fence Recovery

- Status: Answered
- Why it matters: A hard kill can strand `starting`, `running`, or `finalizing` without executing a
  clean transition. Automatically handing the fence to another job risks concurrent ownership;
  requiring all recovery to be manual risks permanent unavailability.
- Scenario: The worker dies after accepting overlay revision 8. Its heartbeat expires, raw evidence
  and the overlay remain intact, and the next `session.start` or manual operation sees the stale
  owner.
- Options:
  - A. Recover the same job automatically; abandon explicitly — a CAS-guarded recovery actor moves
    the stale phase to `needs_followup` while retaining the same job, fence, and incremented owner
    epoch. It resumes automatically only when all frozen identities and journal/overlay digests
    validate. Identity conflict or repeated bounded failure requires an explicit idempotent abandon
    command, which writes an abandonment receipt, releases leases/fence, and leaves raw evidence
    eligible for a new job.
  - B. Operator-only recovery — stale detection reports a blocker, but only an operator may resume
    or abandon. Safest human gate, but unattended maintenance can remain unavailable indefinitely.
  - C. TTL reclaim into a new job — after a timeout, release the fence and transfer evidence to a
    fresh job. Restores availability quickly but can race a delayed original worker and discards the
    approved same-job recovery boundary.
- Recommendation: A. Never transfer ownership merely because time elapsed; recover the same durable
  job when its state proves safe and require explicit abandonment when it does not.
- Answer: A. Recover the same job automatically; abandon explicitly.
- Resulting decision: A maintenance entrypoint detecting an expired heartbeat compare-and-set moves
  the same owner job to `needs_followup`, increments its owner epoch, and validates the frozen
  manifest, leases, overlay, and journal before resuming. Responses from an older epoch are rejected.
  If validation fails, the fence remains with the blocked job until an operator invokes idempotent
  abandonment. Abandonment writes a receipt, releases leases and the fence, preserves raw evidence,
  and retains bounded forensic state so a new job can start safely.
- Spec changes: Added the authoritative job/fence state machine, stale-finalizing recovery,
  epoch-guarded actions, and abandonment semantics.

### Question 12: Memory Revision And Retrieval-Contract Identity

- Status: Answered
- Why it matters: Rolling audit, resume, and finalization require an authoritative identity for the
  exact memory state reviewed. Current Session Memory rows have no revision column, while context,
  links, lifecycle, and embedding contracts can change independently.
- Scenario: A memory's text remains unchanged, but one context/link changes and the active embedding
  contract is migrated while an SMC job is paused.
- Options:
  - A. Monotonic revision plus canonical state digest — every canonical change to payload,
    lifecycle, contexts, or links atomically increments the memory revision and recomputes a digest.
    Audit receipts bind to memory ID, revision, digest, and policy/output/tool/embedding identities.
    Embedding migrate/rollback/prune acquires the same project fence; a contract change invalidates
    paused jobs and current audit coverage under the old contract.
  - B. Canonical state digest only — derive identity from serialized payload, lifecycle, contexts,
    and links without a counter. Reproducible and migration-light, but harder to inspect/order and
    easier for a future writer to omit a field from canonicalization silently.
  - C. Timestamp/version metadata only — use `updated_at` and embedding contract version. Smallest
    schema change, but timestamps are not collision-safe authoritative revision identities and do
    not prove which related rows were reviewed.
- Recommendation: A. The counter gives explicit mutation order, while the digest proves exact state;
  binding the retrieval contract closes the audit and resume gap.
- Answer: A. Use a monotonic revision plus canonical state digest.
- Resulting decision: Every canonical payload, lifecycle, context, or link mutation atomically
  increments the memory revision and recomputes its canonical state digest. Audit receipts bind that
  pair to policy, output-contract, SMC-tool, and embedding-contract identities and are written in the
  same final promotion transaction. Embedding migrate, rollback, and prune acquire the same project
  mutation fence; contract drift blocks resume/finalization rather than silently changing the
  reviewed retrieval view.
- Superseded detail: Question 15 replaces only the “same project fence” coordination phrase with a
  Session-scope global embedding-lifecycle fence mutually exclusive with every project fence. The
  revision/digest and contract-invalidation decision remains unchanged.
- Spec changes: Defined memory revision canonicalization, audit invalidation, atomic receipt writes,
  existing-row backfill, and embedding-maintenance coordination.

### Question 13: Session Inbox Boundary And Terminal Lifecycle

- Status: Answered
- Why it matters: Session inbox items must be preserved, deduplicated, traced into Experience Log,
  and terminalized only after SMC finalization. The existing shared Runtime Durable-Memory Inbox
  currently accepts only Project Memory because only that consumer exists.
- Scenario: The same Session inbox item is intaken twice, then its SMC job is abandoned and later
  reprocessed. It must create one evidence identity, remain recoverable, and eventually expose the
  final source disposition.
- Options:
  - A. Extend the shared layer-shaped inbox with a Session consumer — enable
    `target_layer: "session"` only with the real consumer in this slice. Its stable `inbox:<id>`
    source reference deterministically maps to one Experience Log event. Intake is idempotent and
    nonterminal; final SMC promotion writes the source disposition back to inbox intake state, while
    abandonment restores eligibility without duplicating evidence.
  - B. Create a separate Session evidence inbox — keep the durable-memory proposal inbox unchanged
    and add a new source contract solely for Session evidence. Clear semantic isolation, but creates
    two preserved inbox mechanisms and violates ADR 0061's direction to enable future layers through
    the shared boundary when their consumers exist.
- Recommendation: A. Session now has the missing consumer, so extending the existing layer-shaped
  contract is the coherent source/provenance boundary.
- Answer: Custom option C. Defer Session inbox input from this refactor.
- Resulting decision: Codex hooks remain the current Session Memory evidence source behind the
  provider-neutral input adapter. The SMC workflow does not change Runtime Durable-Memory Inbox
  schemas, intake, ADR 0061, or Project Memory behavior. A future Session inbox slice must design its
  own idempotent source-to-evidence and terminal provenance lifecycle before enabling the layer.
- Spec changes: Removed Session inbox behavior and placed it explicitly outside scope.

### Question 14: Manual Ingest With Audit Work Only

- Status: Answered
- Why it matters: `myelin ingest` is the operator's unconditional Session maintenance command, but
  it is ambiguous whether “no queued evidence” means no work when a rolling audit partition is due.
- Scenario: The Experience Log is empty, ten active memory revisions are overdue for audit, and the
  operator runs `myelin ingest <project>`.
- Options:
  - A. Start an audit-only anchor job — manual ingest performs useful due Session maintenance even
    with no evidence and reports the trigger as `manual_audit`. It uses the same fence, snapshot,
    SMC, receipt, and finalization contracts.
  - B. Return `no_work` unless an explicit audit flag/command is used — keeps ingest synonymous with
    Experience Log processing, but exposes another operator concept and weakens the promise that
    manual maintenance invokes the same complete Session workflow.
- Recommendation: A. The operator asked Myelin to maintain Session Memory; due audit work is valid
  work under the approved architecture.
- Answer: A. Start an audit-only anchor job.
- Resulting decision: Manual `myelin ingest` runs the complete Session maintenance workflow. It
  starts an evidence-plus-audit job when evidence exists, an audit-only job when due audit work
  exists, and returns `no_work` only when neither workload exists. Audit-only jobs use trigger reason
  `manual_audit` and the same fence, immutable snapshot, SMC, receipt, and atomic finalization
  contracts.
- Spec changes: Updated Operator Entry, Rolling Global Audit, Trigger Policy, and acceptance evidence.

### Question 15: Global Embedding-Lifecycle Coordination

- Status: Answered
- Why it matters: Session Memory embedding migrate, rollback, and prune operate on one active
  contract per memory scope across every project. A project-only mutation fence cannot prevent a
  global contract operation from invalidating another project's frozen SMC snapshot.
- Scenario: Project A has a paused SMC anchor job, project B tries to start one, and an operator
  requests a Session Memory embedding migration.
- Options:
  - A. Add a scope-global embedding-lifecycle fence — project anchor acquisition atomically refuses
    while the global fence exists. Migration/rollback/prune atomically acquire the global fence only
    when no Session project fence is active, then block all new project anchors until completion.
    The global fence uses epoch, heartbeat, same-operation recovery, and explicit abandonment rules
    equivalent to the project fence. Strong serialization without acquiring every project lock.
  - B. Atomically acquire every project fence — a global operation discovers all projects, locks
    them in stable order, and prevents new project registration/admission until completion. Reuses
    one fence type, but requires multi-lock orchestration and safe rollback for partial acquisition.
  - C. Allow contract changes beside frozen jobs — rely on copied vectors and let paused jobs finish
    under old identities. Higher availability, but final output and audit receipts can become current
    under a contract that is no longer active, weakening the approved completeness boundary.
- Recommendation: A. A scope-global lifecycle is a scope-global ownership problem. One admission
  fence is simpler and safer than coordinating an evolving set of project locks.
- Answer: A. Add a scope-global embedding-lifecycle fence.
- Resulting decision: A Session-scope embedding lifecycle operation atomically acquires one global
  fence only when no project anchor fence exists. Project anchor acquisition atomically checks that
  no global fence exists. The global fence blocks new projects as well as registered projects and
  uses phase, epoch, heartbeat, same-operation recovery, final receipt, and explicit abandonment
  semantics parallel to the project fence. Migration, rollback, and prune never acquire a changing
  set of project locks.
- Spec changes: Replaced the incorrect per-project embedding coordination with a scope-global
  admission fence and added multi-project race acceptance evidence.

### Question 16: Pre-Migration Legacy-Write Isolation

- Status: Answered
- Why it matters: The original design applied revision/digest migrations before the Chunk 04
  liveness gate. An already-running old launcher can have committed `starting` without a PID and can
  spawn after an activation transaction commits; an old worker can also mutate canonical state
  without maintaining the new revision identity.
- Scenario: An old launcher pauses after committing `starting`, migration 16 completes, activation
  quarantines the PID-less row, and the launcher then spawns the old worker. The old worker attempts
  status, lease, embedding registration, and accepted-output writes.
- Options:
  - A. Pre-migration SQLite firewall — migration 16 atomically closes old-runtime write admission
    before rebuilding canonical state. Trusted new-runtime transactions use short-lived admitted
    rows, while quarantined legacy job IDs remain permanently denied. Supports automatic same-DB
    activation but requires exhaustive old-runtime write-path verification.
  - B. Operator-controlled cold cutover — refuse migrations 16+ until the operator stops every old
    launcher and worker. Simpler database design, but integrity depends on installation/process
    discipline and cannot be proven from existing rows or PIDs.
  - C. New SQLite generation — move the new runtime to another database path. Strong isolation, but
    introduces data copy, late-write reconciliation, capture split-brain, rollback, and installation
    topology beyond this Session reliability slice.
- Recommendation: A. Database enforcement is the only automatic boundary already-running old code
  cannot bypass, and it avoids expanding into a new database/install topology.
- Answer: A. The user approved the pre-migration SQLite firewall correction.
- Resulting decision: Migration 16 installs and closes the firewall in the same transaction before
  revision/digest schema changes. Old-runtime job, lease, raw-delete, canonical-output, and Session
  embedding-registration writes fail safely. New-runtime writes require a transaction-scoped
  admission bound to operation/project/owner/epoch. Quarantined legacy job deny identities survive
  abandonment and later owners. PID/liveness data is diagnostic only.
- Spec changes: Updated Data And State, Migration And Compatibility, acceptance evidence, and ADR
  0070 with the pre-migration firewall and permanent deny boundary.

### Question 17: Fixed Recall Seeds And Provider Phase Ownership

- Status: Answered during Chunk 15 source dogfood.
- Why it matters: Treating repo/branch/commit metadata and every newly affected memory as union recall
  seeds made the plan recursively expand until the provider envelope overflowed, even though the
  active-corpus snapshot and coordinator framework were bounded.
- Answer: Repo/branch/commit metadata are candidate constraints, not recall seeds; all present fields
  must match one context row. Affected work-set membership is non-transitive and never derives new
  recall obligations. Myelin owns deterministic exact/link/overlay retrieval and all cursor pages.
  The provider formulates one selected text query in `text_formulation`; audit materialization is
  refined by Question 18; proposal remains unavailable until every trusted precondition is complete.
- Resulting decision: Provider envelopes contain compact phase, plan/coverage, and work-set summaries,
  never the full obligation matrix. Preparation rejects definitely infeasible controls with stable
  `smc_workflow_budget_infeasible` details and zero state; runtime turn reserve can be extended only
  by an explicit additive grant.
- Spec changes: Updated the SMC loop, retrieval contract, budget/recovery behavior, acceptance scale,
  ADR 0070, roadmap, and Chunks 09/11/15 contracts.

### Question 18: Required Audit Fetch Progression

- Status: Answered during Chunk 15 source dogfood.
- Why it matters: A stateless provider could receive an admitted audit target without its full
  record, return `insufficient_evidence`, and consume the turn even though the coordinator already
  knew the exact bounded fetch required to make progress.
- Answer: Add trusted `audit_fetch` between fixed-plan coverage and audit proposal. The envelope
  exposes exactly one next required batch/memory/expected-revision/max-byte action; the provider must
  return that exact fetch. The coordinator commits one durable exact fetch receipt before exposing
  the next member. An unfetched admitted member alone cannot justify `insufficient_evidence`.
- Resulting decision: `proposal_ready` is unavailable until all frozen audit members have exact fetch
  receipts. Invalid substitutions are journaled as action-validation failures. The playbook advances
  the governing policy to v3; anchors frozen under an earlier policy identity are explicitly
  abandoned and restarted from preserved evidence rather than resumed or rebased.
- Spec changes: Updated the SMC loop, recovery/compatibility boundary, CLI, ADR 0070, roadmap, and
  Chunks 08/11/14/15 contracts.
