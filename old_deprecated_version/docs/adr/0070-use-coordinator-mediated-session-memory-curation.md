# Use coordinator-mediated staged Session Memory curation

Myelin will maintain Session Memory through one project-scoped **Session Memory Anchor Job** with a
proposal-only **Session Memory Curator (SMC)**. The trusted Myelin coordinator freezes selected
Experience Log evidence and the active Session Memory/retrieval view into a job-owned SQLite
manifest, invokes the provider from the target repository, mediates typed curator queries and
record fetches, validates revisioned staged proposals, and performs one final atomic promotion.

This supersedes ADR 0056 where it described the agent as pulling live rows, writing through Myelin
tools during the run, treating bookkeeping as simple, or requiring `master`. It preserves ADR
0056's useful decisions: capture stays non-agentic, one Myelin-owned durable job starts a detached
target-repository provider attempt, raw Experience Log rows remain behind tombstone-backed leases
until accepted terminal processing, and branch/commit/worktree data remains provenance. Branch is
not an ingest gate or a separate Session Memory corpus.

## Decision

- One manual, threshold, age-eligible, or `session.start` invocation owns one anchor job. Evidence
  batches, retrieval pages, tool turns, and resumed provider processes are internal units, not jobs.
- SMC is proposal-only and runs with read-only repository access. It cannot execute arbitrary SQL,
  mutate canonical memory, finalize evidence, or write the target repository.
- Myelin executes the provider-neutral SMC action/result protocol, owns the append-only action
  journal and revisioned noncanonical overlay, and rejects stale owner epochs or overlay revisions.
- The job's immutable normalized SQLite snapshot contains selected evidence and every
  retrieval-affecting active-memory, context, link, normalized-text/hash, embedding-contract, and
  vector field needed for deterministic query and same-job resume.
- Curator retrieval is a high-recall job-scoped contract over the frozen base and current overlay,
  not the end-user top-k query facade. Required semantic coverage fails closed.
- Recall plans are derived only from frozen evidence text, evidence-explicit canonical memory
  references, due audit targets, and accepted overlay state. Repo/branch/commit metadata constrain
  candidate qualification on one context row; they are not union seeds. Affected work-set growth is
  non-transitive and never revises the seed plan.
- The coordinator owns deterministic exact/link/overlay queries, page limits, cursors, and complete
  pagination. The provider receives `text_formulation` turns one obligation at a time, then—for an
  audit batch—`audit_fetch` turns one unfetched frozen member at a time, and a `proposal_ready` turn
  only after fixed-plan coverage and all required audit fetches are complete. An `audit_fetch`
  envelope exposes exactly the coordinator-selected batch ID, memory ID, expected revision, and
  maximum result bytes; the provider must return that exact fetch.
  Its envelope contains compact phase, coverage, and work-set summaries rather than the obligation
  matrix or active corpus.
  Because provider turns are stateless, the next envelope also carries the latest compact validation
  status and bounded successful record fetches from that batch; it never replays retrieval pages or
  match sets. An audit target appears as one required action during `audit_fetch` and later as one
  compact affected-work-set member during proposal; no envelope duplicates the frozen-target matrix.
- Each successful required audit fetch commits one durable exact-revision fetch receipt before the
  coordinator advances to the next member. Claiming `insufficient_evidence` solely because the
  admitted target is still unfetched is invalid and is journaled as action-validation failure.
  Audit-batch proposal submission is unavailable until every frozen member has a fetch receipt.
- This phase contract is Session maintenance policy v3 and therefore changes the governing policy
  identity. Anchors frozen under an earlier policy identity are incompatible; they must be explicitly
  abandoned and restarted from preserved evidence rather than resumed under v3.
- Preparation rejects definitely infeasible frozen budgets with zero durable state. Runtime turn
  reserve exhaustion requires an explicit additive grant and is never auto-granted.
- The frozen minimum provider-turn requirement is the number of evidence text formulations plus one
  proposal per work batch plus one exact full-record fetch per frozen audit member. This repository
  sets `SMC_MAX_TURNS=20`; its acceptance workload requires 7 + 2 + 10 = 19 minimum turns. The one
  remaining turn is runtime headroom, not permission to weaken completeness or auto-grant retries.
- A SQLite project mutation fence serializes every canonical Session Memory writer. A separate
  Session-scope embedding-lifecycle fence serializes global migrate, rollback, and prune operations:
  it can start only when no project fence exists, and project fences cannot start while it exists.
  Hard-crash recovery resumes the same owner/operation when its identities still match;
  incompatible work requires explicit idempotent abandonment.
- Before revision/digest or anchor schema changes, migration 16 atomically closes a SQLite
  legacy-write firewall. Pre-firewall binaries cannot receive transaction admission, so delayed
  launchers/workers cannot update jobs, leases, raw evidence, canonical Session Memory, or Session
  embedding-contract state after the incompatible migration. New-runtime compatibility and SMC
  writes use transaction-scoped admissions bound to their durable owner; quarantined legacy job IDs
  remain permanently denied after abandonment or later fence ownership.
- Myelin validates exact selected-source and affected-memory coverage, then atomically applies
  memory/lifecycle/link changes, audit receipts, tombstones, raw-row deletion, the accepted result,
  a finalization receipt, and job completion.
- Incremental work uses affected-memory neighborhoods. A bounded rolling audit advances only when a
  successful maintenance job includes due audit work; `session.start` is the primary below-threshold
  wake. Blocked/no-work outcomes claim no progress, and idle projects run no daemon or scheduler.
- Rolling-audit selection has a separate positive-integer `SMC_AUDIT_PARTITION_LIMIT`. It bounds the
  due revisions frozen into each anchor independently of `max_affected_work_set_size`, whose role is
  bounding retrieval-derived affected work and which remains an additive grant ceiling. This
  repository explicitly configures an audit partition of 10.
- Codex hooks are the only enabled Session Memory evidence adapter in this refactor. Runtime
  Durable-Memory Inbox support for Session Memory remains deferred, so ADR 0061 is unchanged.

## Consequences

The SMC workflow scales with bounded evidence and evidence-scoped affected memory instead of
serializing the whole active corpus into one prompt. Coordinator-owned pagination does not consume
provider turns, query-materialization allowance, or provider-result bytes. Preparation counts every
fixed evidence, explicit-reference, and audit materialization before admitting the job. Later batches
see accepted staged work, while canonical Session Memory remains all-or-nothing. Recovery and replay
no longer depend on provider-native conversation state.

The implementation requires new SQLite manifest, snapshot, overlay, journal, fence, revision,
audit-receipt, finalization-receipt, and abandonment-receipt state; a multi-turn provider-neutral
coordinator; curator-specific retrieval; migration of existing Session Memory revisions and legacy
jobs; and retirement of both the current one-shot full-snapshot workflow and older unused worker
apply path as production owners.

The 60-entry and 24-hour values are eligibility defaults, not prompt sizes or idle-time guarantees.
Projects may override them; an existing explicit threshold such as this repository's 25 remains in
force until the operator changes it. The audit-partition limit independently controls per-anchor
rolling-audit cost; increasing the affected-work-set budget does not increase the selected audit
partition.

The migration boundary intentionally does not trust PID liveness, process names, argv, or timeouts.
Those signals may aid operator diagnosis, but only the database firewall prevents already-running
old code from crossing the new authority boundary.
