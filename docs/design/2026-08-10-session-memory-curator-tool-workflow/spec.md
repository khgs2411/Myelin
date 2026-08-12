# Session Memory Curator Tool Workflow Design

Status: Approved — eligible for implementation planning.
Design directory: `docs/design/2026-08-10-session-memory-curator-tool-workflow/`
Agenda: `docs/design/2026-08-10-session-memory-curator-tool-workflow/agenda.md`

## Goal And Success Criteria

Replace snapshot-wide prompt transport with a scalable, tool-driven Session Memory Curator (SMC)
workflow while preserving the reliability guarantees already established in the current dirty
worktree.

The design succeeds when:

- one manual or automatic Session Memory maintenance invocation creates one durable anchor job;
- SMC runs from the target repository and can use repository state as verification evidence;
- SMC receives selected Experience Log evidence in bounded work batches rather than one giant
  prompt;
- SMC can search and inspect a job-scoped Session Memory view through a dedicated curator contract
  that prioritizes recall and coverage rather than concise end-user answers;
- later batches see accepted staged proposals from earlier batches, so duplicate or superseding
  evidence is reconciled against the work already performed in the same anchor job;
- the agent never writes canonical memory, terminalizes evidence, or executes arbitrary SQL;
- Myelin deterministically validates the completed staged result and promotes memory changes,
  source dispositions, tombstones, raw-row deletion, and job completion in one SQLite transaction;
- normal work scales with selected evidence and the affected memory neighborhood, rather than with
  every active Session Memory record after every trigger;
- each successful Session Memory maintenance job with due audit work advances bounded audit
  coverage, while blocked/no-work outcomes and idle projects claim no progress;
- failures remain recoverable without consuming raw evidence or publishing partial memory state;
- automatic maintenance can balance cost and freshness through volume and age eligibility, while
  manual ingest remains unconditional.

## Current Repository Context

Repository-backed facts:

- Capture already classifies provider input as `experience`, `control`, or `ignored`. Valid
  `user.prompt` and `assistant.response` content is stored durably before scheduling;
  `session.start` is a non-persisted control signal.
- `myelin ingest <project-key>` creates one durable `ingest_jobs` row, uses an application-level
  check intended to prevent concurrent active maintenance for the same project, and launches one
  detached worker from the target repository. The pressure test found that this ownership is not
  yet enforced by SQLite and does not cover every canonical Session Memory writer.
- Codex-backed stages run with a read-only sandbox. They may inspect the repository, but canonical
  SQLite mutation must remain outside the agent process.
- Experience Log leases use tombstone stubs while raw `experience_events` remain intact. Accepted
  terminal processing finalizes tombstones and deletes raw rows.
- `src/session-maintenance/` currently reads every active Session Memory plus all selected evidence,
  serializes both into one prompt, requires complete dispositions, and commits the accepted result
  atomically.
- The live `llm-wiki` acceptance run failed before agent execution because that prompt required
  356,206 characters against a configured 180,000-character limit. The active-memory portion alone
  was 335,420 characters for 156 active memories.
- The consumer Session Memory query facade is semantic, top-k, answer-oriented, index-dependent,
  and query-logged. It is not a curator completeness surface.
- The current snapshot token, strict proposal schema, reference validation, collision checks,
  deterministic commit path, accepted-result digest, and post-commit derived indexing are reusable.
- The Runtime Durable-Memory Inbox currently accepts Project Memory proposals only. It does not yet
  supply Session Memory evidence.
- ADR 0056 originally described a target-repository ingest agent using Myelin tools and bounded
  pulls. The present one-shot prompt implementation drifted from that tool-first direction while
  adding stronger atomicity and validation boundaries. ADR 0070 records the replacement boundary.

## Confirmed Product Direction

The following decisions come from the user and are not open agenda questions:

- The agent role is named **Session Memory Curator (SMC)**.
- Inputs are provider-neutral. Codex hooks are the only enabled Session Memory evidence adapter in
  this refactor, not the product boundary.
- SMC runs in the target repository for the project being maintained.
- SMC may use the repository to verify or disprove claims raised by selected evidence. It does not
  perform an unrelated repository crawl.
- SMC gets a dedicated curator-oriented interface rather than reusing the concise day-to-day query
  contract.
- Selected evidence is processed sequentially in bounded batches inside one anchor job.
- Later batches must observe the staged result of earlier batches.
- SMC is proposal-only. Myelin remains the sole canonical writer and terminal evidence authority.
- Physical deletion is not a Session Memory lifecycle operation; existing memory is kept,
  superseded, or retracted.
- Manual ingest and self-maintenance invoke the same underlying workflow.
- This design covers Session Memory only. Project Memory reliability, Project Memory curation,
  Droplet Bot, Practice/Personal consumers, installation, Git commits, and publication are outside
  scope.
- Session inbox intake and changes to the Runtime Durable-Memory Inbox contract are outside scope.

## User-Facing Behavior

### Operator Entry

`myelin ingest <project-key>` remains the normal operator command. It starts one detached Session
Memory maintenance anchor job and returns its durable identifier.

The job records why it started:

- `manual`
- `content_threshold`
- `max_pending_age`
- `session_start`
- `manual_audit`
- a future explicit recovery reason

The operator-facing command does not require knowledge of internal work batches, SMC turns, or
retrieval pages. When no curator-eligible evidence is queued, manual ingest starts an audit-only
anchor job if audit work is due and returns `no_work` only when neither workload exists.

### Dedicated SMC Surface

The dedicated `myelin smc ...` namespace is a machine-oriented protocol and an operator-debugging
surface, not a replacement for `myelin memory query`.

Its conceptual capabilities are:

- inspect the immutable job manifest and current staged revision;
- obtain the next bounded evidence work batch;
- search the job-scoped Session Memory view with high recall;
- fetch complete records, provenance, links, and repository-context references by stable ID;
- inspect the staged overlay produced earlier in the job;
- submit or transport structured batch proposals to the trusted coordinator;
- validate a complete staged proposal without canonical mutation;
- finalize exactly the validated proposal digest;
- inspect progress, coverage, degradation, and recovery state.

SMC does not execute these commands as untrusted child-process mutations. It participates in a
coordinator-mediated tool loop:

1. Myelin derives an immutable recall-seed plan, exhausts deterministic exact/link/overlay
   obligations, and owns every persisted cursor continuation.
2. When text coverage is missing, Myelin invokes SMC in `text_formulation` phase for exactly one
   selected evidence-text obligation. SMC supplies only bounded query text.
3. Myelin executes lexical and semantic retrieval to terminal coverage. For an audit batch with an
   unfetched frozen member, Myelin then invokes `audit_fetch` with exactly the next trusted
   `required_action`: batch ID, memory ID, expected revision, and maximum result bytes.
4. SMC must return that exact memory fetch. Myelin validates it, atomically journals the result and
   durable exact-revision fetch receipt, then advances to at most one next unfetched audit member.
5. Myelin invokes `proposal_ready` only after fixed-plan coverage is complete and every frozen audit
   member has a durable fetch receipt. SMC may then submit the complete proposal or report a genuine
   typed blocker; Myelin validates and journals the result and records any accepted overlay revision.

The CLI and coordinator call the same underlying services. The CLI remains useful for operator
inspection and deterministic debugging, but agent shell access, installed-command resolution, and
child-process network permission are not correctness dependencies.

The versioned action/result protocol is a discriminated union:

- `query`: in `text_formulation` phase supplies exactly the trusted plan revision/digest, selected
  text-obligation ID, and nonempty query text. Channels, selectors, page limits, cursors, and
  continuations remain coordinator-owned; rich persisted query/page receipts are internal results;
- `fetch_record`: supplies stable memory/source IDs and expected revisions; its result returns full
  immutable job-scoped records or explicit not-found/revision errors. In `audit_fetch`, the provider
  has no record-selection discretion and must echo the exact coordinator-supplied required fetch;
- `submit_proposal`: supplies work-batch ID, expected overlay revision, exact source/work-set
  dispositions, and staged operations; its result returns structured validation issues or the new
  overlay revision and accepted-response digest;
- `blocker`: supplies a stable reason code, retryability, and compact explanation when SMC cannot
  continue safely.

Every provider action carries job, attempt, sequence, work-batch, owner-epoch, and protocol-version
identity. Provider-visible results echo those identities and are journaled before return. Internal
query pages are coordinator-owned durable receipts and are summarized, not returned, to the provider.
Each stateless provider turn receives the latest compact same-batch validation status and any
successful bounded record fetches it previously requested. Fetch feedback is deduplicated, remains
inside the frozen envelope-byte ceiling, and never includes retrieval-page matches or diagnostics.
Audit target identity is carried only where the current phase requires it: one required action in
`audit_fetch`, then one compact affected-work-set member in `proposal_ready`. No envelope duplicates
the frozen-target matrix.
Unknown actions or fields fail schema validation; evidence text can never introduce a new action type.

The trusted provider phase is one of `text_formulation`, `audit_fetch`, or `proposal_ready`.
`audit_fetch` exposes exactly one `required_action` with `batch_id`, `memory_id`,
`expected_revision`, and `max_encoded_bytes`; it does not expose the remaining audit matrix. A
successful exact fetch adds one durable curator-fetch receipt before the next turn. Returning
`insufficient_evidence` solely because that admitted member has not yet been fetched is invalid and
is journaled as `action_validation_failed`; only genuine typed transport/system blockers may replace
the required fetch. `proposal_ready` is unreachable for an audit batch while any required fetch
receipt is missing.

This playbook is Session maintenance policy v3. Policy version and digest are part of the frozen
governing identities, so an existing anchor prepared under an earlier policy cannot resume under
v3. It must be explicitly abandoned, preserving raw evidence, and a new anchor must be prepared
under the new identity. The tool action/result protocol remains independently versioned.

Turn count, query-materialization count, provider-visible fetched-record bytes, and affected-work-set
size are explicit job budgets. Audit partition size is a separate positive-integer plan control,
not an additive workflow budget: `SMC_AUDIT_PARTITION_LIMIT` bounds the due audit revisions selected
for each anchor independently of `max_affected_work_set_size`. Coordinator-owned query pages do not
consume provider turns, count as provider-result bytes, or multiply the query-materialization count.
Preparation counts every fixed
text, explicit exact/link, and audit materialization and rejects a definitely infeasible frozen job before writing
any anchor, fence, lease, or snapshot state with `smc_workflow_budget_infeasible` and exact
configured/required details.
The minimum provider-turn calculation is exact for irreducible work:

```text
min_turns = evidence text formulations
          + one proposal per frozen work batch
          + one exact full-record fetch per frozen audit member
```

The repository root sets `SMC_MAX_TURNS=20`. The acceptance workload freezes seven evidence
formulations, two work-batch proposals, and ten audit fetches, so its minimum is 19. The remaining
turn is headroom above preparation feasibility; it does not guarantee arbitrary validation retries.
Exhaustion produces `needs_followup` with a stable `budget_exhausted` reason; it never accepts a
partial batch. Transport/provider transients may auto-resume the same job, but budget exhaustion
or an insufficient remaining provider-turn reserve requires an operator-recorded additive budget
grant or explicit abandonment; the coordinator never auto-grants. A grant does not alter
the frozen evidence or memory manifest and is itself epoch/digest guarded in the action journal.

## Technical Design And Boundaries

### One Anchor Job, Many Bounded Turns

One `ingest_job_id` owns:

- one frozen selected evidence set;
- one immutable active-memory base view;
- one policy, output-contract, SMC-tool-protocol, provider, and model identity set;
- zero or more bounded SMC reasoning turns;
- one revisioned noncanonical overlay;
- one accepted final projection and digest;
- one final atomic promotion or one recoverable terminal failure.

Evidence page size, retrieval page size, and SMC turn count are transport concerns. They never
create additional ingest jobs and never become independent canonical commits.

### Immutable Job Manifest

Before SMC reasoning begins, one `BEGIN IMMEDIATE` transaction acquires the project mutation fence,
creates the evidence leases, copies the immutable job snapshot, and records a manifest containing:

- project and anchor job identity;
- trigger reason and requested selection limits;
- selected source/tombstone IDs, content hashes, ordering, and total bytes;
- active-memory IDs and content hashes plus one aggregate snapshot token;
- policy, output-contract, and SMC-tool-protocol identities;
- resolved provider/model/reasoning identity;
- target repository and captured branch context;
- creation time and configured page/turn/work budgets.

The snapshot uses normalized job-owned SQLite rows. It copies selected evidence and every
retrieval-affecting active-memory field, revision, context, link, normalized search text/hash,
embedding-contract identity, completeness identity, and vector. The manifest is the retry and
finalization authority. Mutable live rows are never substituted for a manifest item during SMC
reasoning or resume.

### Job-Scoped Memory View

SMC reads a stable view composed of:

1. the normalized immutable job-owned active Session Memory base captured with the manifest; and
2. the latest accepted revision of the job-scoped staged overlay.

The view provides read-your-writes behavior without publishing partial results. New staged memory,
staged replacements, and staged retractions affect later searches inside the job. Canonical
`session_memories` remains unchanged until final promotion.

The view must never be implemented as unrestricted SQL. Every read is scoped to the project, job,
snapshot, and allowed result size.

### Curator Retrieval Contract

The curator contract is separate from the end-user query facade.

It materializes a paginated, inspectable union of:

- lexical/full-text matches over complete snapshot and overlay text;
- semantic vector matches where the active retrieval contract is usable;
- exact IDs explicitly referenced by frozen evidence;
- evidence-scoped repository path, branch, and commit constraints applied to candidate matches;
- existing Session Memory links and staged relationships;
- staged records created earlier in the anchor job.

Results include match reasons, stable IDs, coverage-channel diagnostics, total/cursor metadata, and
snapshot/overlay revision identities. They do not silently truncate at an end-user top-k boundary.

Textual evidence always requires lexical and semantic channels. Exact-ID lookup and one-hop link
expansion apply only when frozen evidence contains canonical `session_memories/<id>` references;
an affected work-set member never becomes a new recall seed. Repository path, branch, and commit
metadata constrain the candidate set rather than contributing union hits. Every present constraint
must match on the same memory-context row; absent metadata does not constrain. Overlay search applies
whenever the accepted overlay is nonempty.

That coordinator-owned set is an append-only per-batch channel plan, not a field supplied by SMC.
Frozen textual evidence creates paired lexical/semantic obligations. Stable exact references use
canonical `session_memories/<id>` syntax; bare IDs and free-prose guesses are not admitted. Each
evidence-derived text/exact/link obligation carries that evidence item's normalized repo/branch/
commit scope. A nonempty accepted overlay creates an overlay obligation. Work-set membership is a
proposal-disposition authority only and never feeds plan identity or obligation derivation.

The coordinator selects the next text obligation and SMC may supply only its nonempty formulation.
SMC cannot supply obligation arrays, raw channel lists, filters, exact IDs, link seeds, page limits,
or cursors. Batch acceptance requires complete, untruncated, gap-free terminal receipts for every
obligation/channel pair in the immutable evidence-seed plan. Work-set growth does not revise that
plan or invalidate completed coverage. Query materialization identity survives a
higher-epoch same-job resume, while every call still requires the current attempt authority.

Because vector search is rank-based rather than cursor-native, the first semantic query materializes
the deterministic ordered hit-ID set for the frozen query, base snapshot, overlay revision, distance
threshold, and tie-break by stable memory ID. Pages use an opaque cursor into that persisted receipt,
not a rerun against live vectors. Lexical and structured channels use equivalent persisted ordered
receipts. If a configured result ceiling truncates qualifying hits, the receipt is incomplete and
the batch cannot be accepted; SMC must narrow the query within budget or report a blocker.

Semantic distance thresholds and result ceilings are coordinator-policy/configuration values, not
agent-selected recall controls. Their resolved values and policy identity are frozen for the job and
included in every query-receipt digest. SMC may reformulate or narrow query text, but it cannot raise
the distance threshold, lower the qualifying-result ceiling, or declare an incomplete receipt
complete.

Base semantic retrieval is complete only when every semantically eligible active record in the
frozen snapshot has a vector for its frozen normalized-text hash under the manifest's embedding
contract. The job never hydrates missing base records or vectors from later live canonical state.
If that proof cannot be established when the snapshot is created, the anchor job does not begin
curation.

Every accepted overlay revision synchronously derives normalized searchable text and a job-scoped
vector for each staged active record under the same frozen embedding contract. Later searches union
the frozen base index with the current overlay index while masking base records staged for
supersession or retraction. An embedding failure leaves the proposed overlay revision unaccepted and
recoverable; it cannot produce a lexical-only accepted revision.

Lexical, semantic, metadata/link, and overlay coverage are required curator channels when applicable
to the job snapshot. If the active semantic retrieval contract, query provider, or required indexed
coverage is unavailable, SMC maintenance fails closed before accepting further curation or final
promotion. Available lexical matches are diagnostic evidence only; they are not treated as a
reliable substitute for the missing semantic channel.

Any record added to an SMC work set by retrieval becomes part of that batch's deterministic
disposition requirement but creates no further recall obligation. Each channel records stable
keyset cursors, returned IDs, page digests,
truncation state, and the base/overlay revisions used. Missing pages, exhausted work budgets before
declared completion, or cursor/revision drift block batch acceptance. Search results remain
untrusted context rather than agent instructions.

### Incremental Curation And Coverage

Selected evidence is ordered by durable `inserted_at`, then stable event ID. The manifest freezes
that order and deterministically packs complete items into byte-aware work batches using configured
maximum item count and maximum encoded bytes. Evidence is never excerpted or split silently. One
item larger than the absolute per-item limit blocks with `evidence_item_too_large` while remaining
raw and recoverable. Each batch ID is derived from the anchor job, ordinal, ordered event IDs, and
content hashes, so resume reconstructs identical boundaries.

For each evidence work batch:

1. Myelin supplies every selected source item in that batch.
2. Myelin exhausts the fixed evidence-seed recall plan and builds a high-recall candidate work set.
3. SMC supplies bounded text formulations during recall and may request complete records only after
   proposal phase begins.
4. SMC proposes source dispositions, memory dispositions, new memory, candidates, or handoffs.
5. Myelin validates the batch proposal against the manifest, work set, and current overlay revision.
6. Accepted proposal effects become a new overlay revision visible to the next batch.

Every selected source event must receive exactly one terminal-intent disposition before finalization.
Every active memory admitted to a batch work set must receive exactly one explicit disposition for
that batch. Active memories never admitted to an affected work set are treated as unchanged for the
incremental job; they are not enumerated merely to emit repetitive keep decisions.

If the same unchanged base/overlay memory revision enters a later batch, the later proposal may cite
its earlier accepted disposition receipt instead of emitting a duplicate decision. New evidence
that changes the proposed outcome must submit a new disposition against the current overlay
revision. Validator-owned receipt resolution makes reuse explicit; omission is never treated as
implicit reuse.

A duplicate input may resolve as already represented by an active or staged memory. That source
still receives an explicit disposition and records the checked memory reference; it is never
silently discarded.

### Rolling Global Audit

Incremental curation and corpus-wide maintenance are separate workloads:

- incremental curation starts from new evidence and reconciles its high-recall affected memory
  neighborhood;
- rolling global audit selects bounded partitions of active memory that are oldest, never audited,
  or invalidated by policy/schema changes, even when no new evidence points to them.

The audit uses the same SMC query, staged-overlay, validation, lifecycle, and atomic-promotion
boundaries. A successful audit records an individual durable receipt for each reviewed memory
revision, tied to the governing policy, output contract, and SMC tool identities. A scalar cursor
may guide selection but is not proof of coverage. A changed memory becomes unaudited until its
current revision is reviewed. Keep, supersede, and retract remain explicit audit outcomes.

The product guarantee is eventual corpus-wide review while successful Session Memory maintenance
continues to be invoked with due audit work, not a full-corpus scan after every input threshold and
not a wall-clock guarantee for an idle project. `session.start` is the primary self-maintenance wake;
count-triggered and manual maintenance use the same audit selection. `no_work`, occupied-fence,
indexing-blocked, or fail-closed retrieval outcomes do not claim audit progress. Status must
separately expose incremental freshness and audit coverage so a successful incremental job cannot
imply that the whole corpus was recently audited.

The authoritative memory revision identity is `(memory_id, revision, state_digest)`. `revision` is
a monotonic integer. `state_digest` is SHA-256 over a versioned canonical serialization of the
memory payload, lifecycle state and lifecycle targets, contexts, and links. Every canonical mutation
to any of those fields increments the revision and recomputes the digest in the same transaction.
Derived vector-row rebuilds under the same embedding contract do not change the memory revision.

An audit receipt binds that revision identity to the policy, output contract, SMC tool protocol,
and embedding contract used for the review. Coverage is current only while all identities still
match. A memory mutation or governing identity change makes the old receipt historical rather than
current. Audit receipt creation is a canonical effect inside the same final promotion transaction as
the keep, supersede, or retract outcome.

Audit work cannot be starved by a continuously busy evidence queue. When both workloads are due,
one anchor job processes its selected evidence first and then one bounded due audit partition under
the same frozen snapshot and mutation fence. An audit-only anchor job is allowed when an existing
wake observes no eligible evidence but due audit work. A wake that finds the mutation fence occupied
records no second job; the next existing wake reevaluates eligibility.

The partition bound comes from the typed `SMC_AUDIT_PARTITION_LIMIT`, not from the affected-work-set
budget. The scheduler and status audit selector use the same configured value; the repository root
sets it to 10, so one anchor freezes at most ten due revisions even though additional revisions may
remain due and the retrieval-derived affected work set has a larger ceiling.

### Proposal-Only Agent Authority

SMC may:

- inspect repository files and Git state read-only;
- inspect job-scoped evidence and memory through bounded SMC tools;
- request additional memory lookup;
- propose create, keep, supersede, retract, candidate, and handoff outcomes;
- revise or withdraw noncanonical staged proposals through the coordinator.

SMC may not:

- write canonical Session Memory, candidates, handoffs, tombstones, or Experience Log rows;
- execute arbitrary SQL;
- finalize or delete source evidence;
- bypass schema, provenance, lifecycle, privacy, or collision validation;
- mutate files in the target repository;
- broaden work to unrelated repository subjects merely because the repository is readable.

### Trusted Coordinator And Overlay

Myelin owns all overlay mutations. Each accepted mutation is scoped to the anchor job and guarded by
an expected overlay revision. Replayed, duplicated, or reordered responses cannot silently overwrite
newer staged state.

The overlay is durable and noncanonical. It must support:

- create, revise, and discard staged Session Memory;
- keep, supersede, and retract dispositions against base-memory IDs;
- staged candidates and handoffs;
- complete source dispositions and checked/output references;
- stable staged IDs and their final reference mapping;
- per-batch coverage and accepted-response digests;
- resumable progress and explicit abandonment.

The overlay is stored in revisioned SQLite state owned by the anchor job. Each accepted batch
proposal advances a compare-and-set revision and records its response digest. A provider or worker
failure may pause the same anchor job without releasing its leases or publishing partial memory.

Resume is permitted only when the active-memory snapshot, selected evidence set, policy,
output-contract, SMC-tool-protocol, resolved provider/model, overlay revision, and accepted batch
digests still match the manifest. Resume appends a new attempt/heartbeat record and continues from
the first incomplete work batch; completed batches are not rerun.

Provider-native conversation state is not authoritative. The coordinator persists every typed
action and result in an append-only journal keyed by job, work batch, attempt, and sequence, with
request/result digests and the expected overlay revision. Replaying the same key and digest returns
the recorded result; reusing a key with different content fails closed. Resume reconstructs the
logical tool conversation from this journal, so Codex and Claude one-shot process behavior cannot
change recovery correctness.

A paused resumable job remains the project's single active Session Memory mutation owner. The
single-flight guard therefore includes resumable `needs_followup` jobs, not only `starting` and
`running`. If a governing identity changed, Myelin refuses resume; the operator or recovery policy
must explicitly abandon the overlay and start a new anchor job from recoverable raw evidence.
Policy v3's `audit_fetch` playbook is such an identity change for every anchor frozen under an
earlier policy version or digest; those anchors are abandoned and restarted rather than translated
in place.

Project mutation ownership is enforced in SQLite, not by a check-then-start query. One project
mutation fence covers ingest, resume, finalization, abandonment, Session Memory repair, and every
other canonical Session Memory writer. Project-fence acquisition occurs in the same immediate
transaction that verifies no Session-scope embedding-lifecycle fence exists. The fence carries an
owner job, epoch, lifecycle state, and heartbeat; lifecycle transitions use compare-and-set guards.
A paused job retains the fence until it is safely resumed or explicitly abandoned.

The authoritative anchor-job/fence phases are:

- `preparing`: the owner has acquired the fence and is atomically creating leases, snapshot, and
  manifest;
- `running`: one worker attempt may append journal actions and CAS overlay revisions under the
  current owner epoch;
- `needs_followup`: the same job retains the fence but has no active worker; its state is resumable
  only after full identity validation;
- `finalizing`: the accepted projection digest is fixed and canonical promotion is in progress;
- `completed`: a finalization receipt exists and the fence is released;
- `abandoned`: an abandonment receipt exists, leases are released, raw evidence remains eligible,
  and the fence is released.

Creation is `none -> preparing -> running`. A bounded provider, process, or budget interruption is
`running -> needs_followup`. Resume is `needs_followup -> running` with an incremented owner epoch.
Accepted validation is `running -> finalizing`; the atomic commit produces `completed`. Every
transition is compare-and-set on project, owner job, prior phase, and owner epoch.

Only the current epoch may heartbeat, append journal actions, advance the overlay, or finalize. A
maintenance entrypoint that observes an expired `preparing`, `running`, or receipt-less
`finalizing` heartbeat compare-and-set moves the same job to `needs_followup` and increments the
epoch. If a finalization receipt already exists, recovery returns it and marks the job completed.
The recoverer resumes automatically only when the immutable snapshot, leases, policy/output/tool,
provider/model, embedding contract, journal, and overlay identities validate exactly. A delayed
worker from an older epoch cannot mutate state.

If those checks fail, the job remains blocked in `needs_followup`. Only an explicit operator
abandonment may release it; timeout alone never transfers ownership to a new job. Abandonment is one
idempotent `BEGIN IMMEDIATE` transaction that verifies the epoch, writes a unique abandonment
receipt, releases nonterminal leases and the project fence, preserves raw Experience Log evidence,
and marks the job `abandoned`. Snapshot, overlay, and journal records then follow the bounded
forensic retention policy.

The shared terminal receipt belongs to the anchor lifecycle and binds one typed terminal basis. A
normal SMC job uses its exact manifest digest; a permanently denied pre-SMC job uses a versioned
legacy-quarantine digest derived from its immutable deny identity and has no fabricated manifest.
The receipt records the target epoch separately from the trusted abandonment operator/request
identity. Abandoned claimed tombstones become immutable `unfinished` history; uniqueness applies to
active `claimed` leases only, so a later anchor can create a fresh tombstone without rewriting the
old job's ownership history.

### Deterministic Validation And Atomic Promotion

Final validation is read-only and produces a digest-bound accepted projection. Finalization accepts
only that exact validated digest.

Immediately before promotion, Myelin rechecks:

- active-memory snapshot identity;
- selected evidence identities, hashes, and lease ownership;
- policy, output-contract, SMC-tool-protocol, provider, and model identities;
- frozen embedding-contract identity and complete snapshot/overlay coverage;
- overlay revision and accepted projection digest;
- complete selected-source coverage;
- required affected-memory coverage;
- output IDs, lifecycle targets, references, and provenance closure.

Finalization first compare-and-set transitions the job to `finalizing`. One `BEGIN IMMEDIATE`
SQLite transaction then:

- creates accepted Session Memory, candidates, and handoffs;
- applies supersession/retraction links and lifecycle metadata;
- increments affected memory revisions and recomputes their canonical state digests;
- writes per-memory-revision audit receipts for the accepted audit work set;
- finalizes all selected tombstones;
- deletes the corresponding raw Experience Log rows;
- stores the accepted projection and digest;
- creates a unique finalization receipt keyed by anchor job and accepted digest;
- marks the anchor job completed.

If any check fails, none of those canonical effects occur. If the transaction committed but the
caller lost the response, retrying the same job and digest returns the persisted finalization
receipt instead of attempting to re-finalize already terminal tombstones. A different digest is
rejected. Overlay and journal state remain available under a bounded forensic retention policy;
cleanup never precedes the durable receipt. Derived embedding/index work is scheduled after commit
and cannot roll canonical memory back.

## Data And State

Logical durable records required by this design are:

- the existing `ingest_jobs` anchor;
- the immutable SMC manifest;
- normalized job-owned frozen source evidence rows sufficient to reproduce every selected input;
- normalized job-owned active-memory snapshot rows containing all retrieval-affecting memory,
  revision, context, link, normalized-text/hash, embedding-contract/completeness, and vector fields;
- revisioned staged overlay state;
- query/work-set coverage receipts;
- accepted batch response digests;
- final validated projection and digest;
- compact recovery, heartbeat, and failure metadata.

These rows are self-contained for resume and are created atomically with leases, the mutation fence,
and the manifest. Live canonical rows are consulted only for final compare-and-set drift checks, not
for job-scoped retrieval. A filesystem-only overlay is not authoritative because it cannot
participate in SQLite recovery or finalization guarantees. Raw evidence must not be duplicated into
general logs or status output.

Canonical storage remains:

- Experience Log and tombstones in root SQLite;
- Session Memory in `session_memories` and its context/link tables;
- embeddings and query indexes as derived state;
- Project Memory as markdown, outside this design.

Before the first incompatible Session Memory schema change, migration 16 atomically installs and
closes a SQLite legacy-write firewall. The same migration then backfills every existing Session
Memory record with `revision = 1` and a canonical state digest computed from its current payload,
lifecycle, contexts, and links. The firewall is database-enforced because an already-running old
binary cannot observe new application-level authority checks.

Trusted new-runtime writes use a transaction-scoped SQLite admission record created, consumed, and
removed in the same write transaction. A concurrent old process cannot observe or piggyback on the
uncommitted admission. Admissions bind the operation kind, project or scope, owner identity, and
epoch needed by the target write. They are not a public bypass and cannot survive commit or
rollback. Migration-owned admission is private to the migration runner.

The closed firewall rejects old-runtime mutations to legacy job lifecycle, Experience Log leases
and terminalization, raw Experience Log deletion, canonical Session Memory/context/link state, and
initial Session embedding-contract registration. The complete old apply transaction must roll back
when its tombstone terminalization is denied. New-runtime compatibility writers remain usable under
durable `legacy_compatibility` mode only through an admitted transaction and must maintain the
revision/digest invariant. `legacy_compatibility` describes the workflow shape; it does not reopen
write admission for pre-firewall binaries.

Embedding migration, rollback, and prune operate across the Session Memory scope, so they use one
SQLite-enforced scope-global embedding-lifecycle fence rather than any single project fence. A
global operation atomically acquires that fence only after confirming that no Session project fence
exists. While it exists, every project-fence acquisition—including for a newly registered project—
fails with a stable embedding-lifecycle-busy result. This closes admission without discovering or
locking an evolving project set.

The global fence records operation kind, phase, owner epoch, heartbeat, target contract identity,
and receipt. A hard crash recovers the same lifecycle operation and higher epoch when safe;
incompatible state requires explicit idempotent abandonment. Completion or abandonment releases the
global fence. Resume and finalization compare the frozen contract identity with the active contract
and fail closed on any out-of-band or legacy drift.

### Migration And Compatibility

Schema migration preserves existing `ingest_jobs.id` values, tombstone IDs, source-event references,
and accepted historical results. Migration 16 closes legacy write admission before rebuilding or
constraining canonical state. A launcher paused before spawn, a child paused before PID persistence,
or a worker returning provider output after migration may continue consuming host resources, but
every old-runtime database mutation is rejected or rolled back. Process liveness, PID existence,
process name, argv, and elapsed time are diagnostic evidence only; none is the integrity boundary.

Activation installs an immutable deny identity for every quarantined legacy job. That identity
survives later abandonment, fence release, and new owner acquisition, so a delayed old worker can
never resume under or piggyback on another job's authority. Existing nonterminal legacy jobs that
lack an SMC manifest/overlay are recorded as `needs_followup` with reason
`legacy_state_missing_smc_manifest`, receive the project fence, and cannot be falsely resumed under
the new protocol. The operator must explicitly abandon them, after which claimed tombstones become
eligible for a distinct new anchor job without deleting raw evidence or attempt history; the old
job ID remains permanently denied.

Existing `failed` and `completed` jobs remain historical. Claimed tombstones owned by a failed job
remain recoverable through the established attempt-history path when the first new anchor job leases
them. Migration backfills memory revisions/digests and then runs firewall probes, foreign-key, and
SQLite integrity checks before the new workflow becomes authoritative. A failed firewall install,
canonical backfill, deny mapping, or integrity check rolls back its whole migration or activation
transaction.

The root default changes to 60 entries or 24-hour eligibility only when a project has no explicit
override. This repository's current configured threshold of 25 remains an intentional project
override unless separately changed by the operator. Deprecated evidence-chunk compatibility names
may remain at the CLI/config boundary, but internal work batches use the SMC vocabulary and never
become jobs.

## Inputs And Scheduling

### Input Boundary

Capture adapters normalize curator-eligible Session Memory evidence into the same provider-neutral
Experience Log contract. Codex hooks are the only enabled adapter in this refactor. Control signals
remain separate from content.

Ordinary scheduling occurs only after durable input storage. `session.start` may check or flush
eligible queued content but is never itself curator evidence.

### Trigger Policy

Manual ingest always evaluates both Session workloads. It starts evidence-plus-audit work when
curator-eligible content exists, an audit-only anchor job when only due audit work exists, and
returns `no_work` only when neither exists.

Automatic eligibility is the logical OR of:

- queued content reaches a configurable count threshold;
- the oldest queued content reaches a configurable maximum age;
- `session.start` requests a below-threshold freshness check;
- derived Session Memory indexing has independent pending work, but this is an indexing-only wake
  and never creates an SMC anchor job by itself.

The default policy is 60 valid Experience Log content entries or a 24-hour oldest-pending age,
whichever becomes eligible first. Projects may override both values through the existing
configuration hierarchy. These values govern when an anchor job starts; they do not define evidence
work-batch size, retrieval page size, or agent prompt size.

Audit selection has its own required plan control. `SMC_AUDIT_PARTITION_LIMIT` must be a positive
integer whenever Session Memory curator plan configuration is present; this repository explicitly
sets it to 10. It limits the audit members selected into one anchor and is independent of the
grantable `SMC_MAX_AFFECTED_WORK_SET_SIZE` retrieval ceiling.

The count threshold controls cost, not SMC context size. Work batches and bounded tool turns control
context size. Selection must also observe total input bytes and configured work limits; row count
alone is not a safe workload measure.

When indexing and evidence/audit work are both pending, derived indexing runs first. An SMC manifest
can be accepted only after the active contract has complete vectors for its frozen base; indexing
failure therefore leaves curation eligible but blocked before anchor creation rather than producing
a partial curator snapshot.

Capture after durable storage, `session.start`, explicit maintenance entry points, and manual ingest
evaluate the policy. `session.start` evaluates below-threshold age eligibility and advances a
bounded rolling-audit partition; it does not run curation synchronously inside the hook. The
24-hour value is eligibility observed at one of these wakes, not a promise to invoke Myelin while a
project is idle. Repeated wakes are idempotent under the project mutation fence and cannot create a
second active Session Memory mutation job.

## Permissions, Security, And Privacy

- Codex-backed SMC execution remains read-only in the target repository.
- Provider-neutral orchestration must not depend on Codex-only implicit tool behavior.
- The SMC action/result protocol is provider-neutral; Codex and Claude adapters transport the same
  typed loop even if their native session-resume mechanisms differ.
- SMC tools use strict argument schemas, project/job capability scope, pagination limits, and
  revision/digest preconditions.
- Experience Log, memory text, repository files, and tool results are untrusted evidence. They may
  not alter the protocol or policy hierarchy.
- SMC has no arbitrary SQL, arbitrary Myelin-root file access, canonical write, or evidence-finalize
  capability.
- Session Memory write admissions are issued only by trusted runtime modules inside an already-open
  write transaction, are bound to the declared operation/project/owner/epoch, and are deleted before
  commit. No CLI, provider, hook payload, or public helper may mint a generic admission.
- Semantic retrieval requiring provider connectivity runs through the trusted Myelin coordinator,
  not through an unverified sandbox-dependent child command.
- Staged evidence retention is bounded. Operator status and logs contain identities, counts,
  digests, and compact errors rather than raw captured text.

## Failure And Recovery Behavior

- Failure before manifest/lease acceptance leaves queued evidence untouched.
- Failure while installing or exercising the legacy-write firewall rolls back the incompatible
  migration; old-schema state remains authoritative. After the firewall commits, a delayed old
  runtime receives stable database rejection and cannot partially apply output.
- Failure after leasing leaves raw evidence intact and tombstones nonterminal.
- Invalid or incomplete agent output changes neither canonical memory nor terminal evidence state.
- Frozen controls that cannot satisfy the selected job's minimum turns, query materializations,
  provider-envelope payload, or mandatory audit work set fail before preparation with
  `smc_workflow_budget_infeasible`, configured/required details, and zero durable job state.
- Minimum turns count every evidence text formulation, one proposal for each frozen work batch, and
  one exact fetch for each frozen audit member. Root `SMC_MAX_TURNS=20` clears the 19-turn acceptance
  minimum composed of 7 formulations, 2 proposals, and 10 audit fetches.
- Audit batches cannot reach `proposal_ready` until each frozen member has an exact durable fetch
  receipt. The coordinator exposes one required audit fetch at a time, journals invalid
  `insufficient_evidence` substitutions, and never treats an unfetched admitted member as evidence
  insufficiency.
- Turn, query, provider-visible fetch-byte, or work-set budget exhaustion records `budget_exhausted` in
  `needs_followup`; the same applies when remaining turns cannot reserve every required formulation
  and proposal. Automatic recovery waits for an explicit operator budget grant or abandonment.
- Accepted batch proposals resume under the same anchor job only when every governing manifest and
  staged-state identity still matches.
- A recoverable process/provider interruption moves the job to a resumable `needs_followup` phase;
  it does not make staged state canonical or allow another mutation job to start.
- A hard crash is recovered into the same job and a higher owner epoch; elapsed time never grants a
  new job ownership by itself.
- An incompatible paused job requires explicit idempotent abandonment, which releases ownership
  without consuming raw evidence.
- Snapshot or evidence drift fails closed; it is never silently rebased.
- Query degradation is explicit and machine-readable. Missing required semantic retrieval stops
  curation and finalization, leaving raw evidence and any staged overlay noncanonical and
  recoverable.
- Finalization is idempotent for the same accepted digest and rejects a different digest after
  completion.
- Post-commit indexing failure leaves trusted Session Memory committed with explicit retrieval
  degradation and retryable derived work.
- Control-only or legacy invalid rows retain the existing deterministic no-agent finalization path.

## Testing And Acceptance Evidence

The intended durable test boundary is contractual rather than implementation-shaped:

- a project with 3,219 active memories successfully processes bounded, evidence-scoped work without
  constructing a prompt proportional to all active memory;
- later batches retrieve staged outcomes from earlier batches and duplicate evidence resolves
  without duplicate canonical memory;
- every selected source receives exactly one final disposition;
- every affected-memory work-set member receives the required disposition;
- missing pages, stale cursors, stale overlay revisions, invalid references, or snapshot drift block
  finalization;
- agent failure leaves raw evidence and canonical memory unchanged;
- restart/resume follows the approved identity policy;
- hard kills during preparing, running, overlay acceptance, and receipt-less finalizing recover the
  same job without accepting stale-epoch responses;
- hard kills immediately before manifest commit leave no partial fence/lease/snapshot, and kills
  after finalization commit but before acknowledgement return the persisted receipt;
- abandonment releases leases and the mutation fence exactly once while preserving raw evidence;
- final promotion is atomic and repeat finalization is idempotent;
- a committed finalization whose response is lost returns the same durable receipt on retry;
- SMC retrieval exposes coverage diagnostics and does not silently become end-user top-k query;
- count, age, manual, and session-start triggers follow the approved event-driven eligibility
  contract without concurrent project mutation;
- manual ingest starts audit-only work when audit is due and returns `no_work` only when neither
  evidence nor audit work exists;
- audit receipts prove coverage for each active memory revision under the governing identities;
- payload, lifecycle, context, or link changes invalidate prior audit coverage by advancing the
  revision and state digest;
- a scope-global embedding migration, rollback, or prune excludes project A's paused anchor and
  project B's concurrent start, including admission of newly registered projects;
- migration from a populated legacy database preserves IDs/history, closes old-runtime writes
  before incompatible schema change, quarantines unresumable legacy jobs with permanent deny
  identities, and passes firewall/foreign-key/integrity verification;
- deterministic barriers prove an old launcher paused before spawn, a child paused before PID
  persistence, and a worker returning output after migration cannot update jobs, lease/finalize
  tombstones, delete raw evidence, register the Session embedding contract, or commit canonical
  output, while admitted new-runtime transactions still succeed;
- incomplete channel pages, truncated qualifying hits, and exhausted budgets cannot produce an
  accepted batch;
- continuously eligible evidence cannot starve bounded rolling-audit progress while maintenance is
  being invoked;
- provider/network failures are simulated through injected boundaries rather than host-network
  assumptions.

Repository policy requires explicit user approval before creating or modifying tests. That approval
is recorded as Agenda Question 6.

## Implementation Constraints And Seams

- Preserve the provider-neutral capture adapter and agent-executor boundaries.
- Preserve target-repository cwd, provider/model provenance, JSON contracts, and Codex read-only
  sandboxing.
- Preserve one active canonical Session Memory mutation job per project.
- Reuse existing tombstone leases, snapshot hashing, output reference vocabulary, lifecycle
  operations, deterministic commit helpers, and derived indexing where their contracts remain
  valid.
- Replace the monolithic all-active-memory prompt path; do not retain it as a fallback that fails at
  realistic scale.
- Keep consumer query and SMC retrieval separate even if they share lower-level vector, lexical,
  hydration, or filtering primitives.
- Follow ADR 0070, which supersedes ADR 0056's live-pull/direct-tool-write and `master` constraints
  while preserving detached target-repository execution and tombstone leases.
- Treat branch as provenance rather than splitting Session Memory into independent branch corpora.
- Remove or formally retire the legacy worker prompt/apply path when the new workflow becomes
  authoritative; do not leave two production curation owners.

## Assumptions And Provenance

- User requirement: tool-using SMC, target-repository execution, sequential batching, staged
  duplicate awareness, dedicated CLI, broader trigger policy, and Session Memory-only scope.
- Repository evidence: current dirty-worktree implementation under `src/session-maintenance/`,
  `src/ingest/`, `src/memory/`, `src/maintenance/`, `src/inputs/`, and `src/capture/`.
- Historical direction: ADRs 0002, 0051, 0054 and the 2026-06-12/14 Session Memory ingest designs;
  ADR 0070 supersedes the incompatible portions of ADR 0056.
- Inbox boundary: Session inbox support is deferred, so ADR 0061 remains unchanged.
- User-approved direction: scalable correctness uses affected-neighborhood reconciliation plus a
  rolling global audit rather than a full active-memory scan after every trigger.

## Open Questions

No material design questions remain. The authoritative options, decisions, and answer history live
in `agenda.md`.
