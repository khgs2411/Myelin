# `src/evidence/evidence-acceptance.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/evidence/evidence-acceptance.service.ts`

`EvidenceAcceptanceService` is the deterministic, project-bound admission owner
shared by automatic capture and manual insertion. It accepts provider-neutral
evidence, appends new evidence to the Evidence Log idempotently, and records any
resulting Session maintenance obligation in the same SQLite transaction. It
does not normalize source input, authorize callers, interpret corrections,
curate memory, or invoke an agent.

```ts
// intentionally illustrative pseudocode

type EvidenceAcceptanceItem = Readonly<{
  candidate: EvidenceCandidateDto
  sourceReplay?: Readonly<{
    domain: ApplicationOwnedDedupDomainId
    scheme: string
    key: string
  }>
}>

type EvidenceAcceptanceCommand = Readonly<{
  contractVersion: EvidenceAcceptanceContractVersion
  operationId: ApplicationOperationId
  items: ReadonlyArray<EvidenceAcceptanceItem>
  sessionMaintenanceIntent: SessionMaintenanceIntent
}>

type EvidenceAcceptanceReceipt = Readonly<{
  operationId: ApplicationOperationId
  projectId: ProjectIdentity
  items: ReadonlyArray<{
    evidenceId: EvidenceItemId
    disposition: "accepted" | "replayed"
    sequence: ProjectEvidenceSequence
  }>
  sessionMaintenance: SessionMaintenanceScheduleResult
  committedAt: normalized timestamp
}>

class EvidenceAcceptanceService {
  async accept(
    command: EvidenceAcceptanceCommand
  ): Promise<EvidenceAcceptanceReceipt> {
    reject the complete command unless every EvidenceCandidateDto is valid

    projectId = require exactly one shared project identity across command.items
    commandFingerprint = versioned deterministic fingerprint of:
      command.contractVersion
      command.sessionMaintenanceIntent
      command.items in their supplied order
        each complete candidate
        each sourceReplay value or explicit absence

    receipt = within one SQLite write transaction acquired before lookup:
      existingOperation = await acceptanceOperations.findByOperationId(
        command.operationId,
        transaction
      )

      IF existingOperation exists
        IF existingOperation.commandFingerprint != commandFingerprint
          fail with operation-identity conflict

        return existingOperation.storedReceipt

      classifiedItems = []

      FOR EACH item IN command.items
        IF item.sourceReplay does not exist
          classifiedItems.push({ kind: "new", item })
          CONTINUE

        candidateFingerprint = calculate the established versioned fingerprint
          of the complete item.candidate

        existingReplay = await evidenceLog.findByReplayIdentity(
          item.sourceReplay,
          transaction
        )

        IF existingReplay does not exist
          classifiedItems.push({
            kind: "new",
            item,
            replayPersistence: {
              identity: item.sourceReplay,
              candidateFingerprint
            }
          })
          CONTINUE

        IF existingReplay.candidateFingerprint != candidateFingerprint
          fail the complete command with source-replay conflict

        classifiedItems.push({
          kind: "replayed",
          item,
          evidenceId: existingReplay.evidenceId,
          sequence: existingReplay.sequence
        })

      newItems = classifiedItems where kind == "new"

      IF newItems is not empty
        sequenceRange = await evidenceLog.reserveProjectSequenceRange(
          projectId,
          newItems.length,
          transaction
        )
      ELSE
        sequenceRange = empty

      FOR EACH newItem IN command order
        projectSequence = take the next sequence from sequenceRange
        evidenceId = await evidenceLog.append(
          newItem.item.candidate,
          {
            projectSequence,
            receivedAt: transaction acceptance time,
            sourceReplay: newItem.replayPersistence or explicit absence
          },
          transaction
        )

        evidenceItem = construct EvidenceItemDto from:
          newItem.item.candidate
          id: evidenceId
          receivedAt: transaction acceptance time

      IF newItems is not empty
        sessionMaintenance =
          await sessionMaintenanceSchedule.afterEvidenceAccepted(
            {
              projectId,
              firstAcceptedSequence: sequenceRange.first,
              latestProjectSequence: sequenceRange.last,
              intent: command.sessionMaintenanceIntent,
              evaluatedAt: transaction acceptance time
            },
            transaction
          )
      ELSE
        sessionMaintenance = { disposition: "not-requested" }

      receipt = construct EvidenceAcceptanceReceipt from:
        accepted new items and their assigned sequences
        replayed items and their existing identities and sequences
        Session maintenance disposition
        application-assigned acceptance transaction timestamp

      await acceptanceOperations.appendSuccessfulOperation(
        {
          operationId: command.operationId,
          projectId,
          commandFingerprint,
          receipt: {
            schemaVersion: current receipt schema version,
            value: receipt
          },
          committedAt: application-assigned acceptance transaction timestamp
        },
        transaction
      )

      return receipt

    after commit, notify the Session maintenance runtime that durable work may exist
    return receipt
  }
}
```

## Atomic admission contract

One acceptance command belongs to one project. Our app may process different
projects in parallel, but no acceptance operation, Session maintenance request,
or Session maintenance attempt combines projects.

The command is all-or-nothing. Invalid evidence, mixed project identity,
operation-identity conflict, source-replay conflict, or transaction failure
appends no new evidence, advances no project sequence, creates no maintenance
request, and persists no successful receipt.

`operationId` protects retries of one application command. Reusing the same
operation identity with the same command fingerprint returns the stored
receipt. Reusing it with a different command is a conflict. If SQLite commits
but the caller does not receive the response, the caller can retry with the
same operation identity and recover the exact durable result.

Optional source replay identity protects repeat delivery across different
application commands. Matching replay identity and evidence is a successful
`replayed` disposition. Matching replay identity with different evidence is a
conflict, never a correction. Only newly appended evidence receives a sequence
and changes Session maintenance eligibility.

Source-replay equality uses a versioned deterministic fingerprint of the
complete `EvidenceCandidateDto`:

```text
INCLUDED
  origin
  content
  workspaceContext
  occurredAt value or explicit absence
  sourceMaterial

EXCLUDED
  source replay identity, which is the lookup key
  EvidenceItemId
  receivedAt
  project-local sequence
  Session maintenance intent and disposition
```

Matching `(domain, scheme, key)` and candidate fingerprint returns the existing
evidence as `replayed`. Matching replay identity with a different candidate
fingerprint is a conflict. This strict comparison prevents a repeated source
identity from silently changing project, branch, origin, content, source time,
or preserved source material. Content hashes alone cannot provide source-replay
equality because separate valid evidence can have the same content.

## Operation fingerprint boundary

The operation fingerprint represents the caller-controlled acceptance command,
not the durable results produced by acceptance.

```text
INCLUDED
  acceptance contract and fingerprint version
  sessionMaintenanceIntent
  ordered EvidenceCandidateDto values
  each source replay identity or its explicit absence

EXCLUDED
  operationId, which is the lookup key
  EvidenceItemId
  receivedAt
  project-local sequence
  acceptance receipt
  Session maintenance disposition
```

Canonicalization preserves item order and duplicate candidates, uses one
object-key order and optional-absence representation, and normalizes timestamps
to one UTC representation. Evidence content and source-material strings remain
byte-exact; they are not trimmed or Unicode-normalized. Candidate validation
must verify the source-material digest before fingerprinting.

The fingerprint scheme and version are stored with its digest. The digest is
not unique: separate operation identities can intentionally carry equal
commands. Operation fingerprinting remains distinct from source replay
comparison because operation equality also includes batch order and Session
maintenance intent. The exact canonical encoding library and compatibility
policy for older fingerprint versions remain `OPEN`.

## Acceptance-operation persistence

Each successful acceptance transaction creates one immutable SQLite record:

```text
evidence_acceptance_operations
  id
  operation_id
  project_id
  fingerprint_scheme
  fingerprint_version
  command_fingerprint
  receipt_schema_version
  receipt_json
  committed_at
```

`id` is the SQLite-assigned row identity. `operation_id` is the unique opaque
application identity and the service's operation lookup key. It does not encode
project identity or enter the acceptance receipt. `project_id` is a separate
required foreign key because one operation belongs to exactly one project. It
supports relational integrity and project lifecycle without parsing an
operation ID or receipt document. Restrictive project deletion prevents silent
loss of the operation's idempotency guarantee.

`command_fingerprint` is not unique. It detects conflicting reuse of the same
`operation_id`; it does not suppress equal commands submitted under different
operation identities. Optional source replay identity remains the separate
cross-operation replay mechanism.

`receipt_json` stores the complete `EvidenceAcceptanceReceipt` in the same
database record. It is not a durable Markdown or filesystem artifact. The
receipt schema version selects the decoder. A retry returns the stored receipt
values without recomputing evidence or Session maintenance outcomes. If the runtime
cannot decode that stored version, it reports incompatible durable state rather
than manufacturing a new receipt.

The table contains no pending or failed acceptance operations. A successful
transaction commits the immutable record with its evidence and Session
maintenance obligation. A rejected or rolled-back transaction leaves no
operation record.

The SQLite write transaction begins before the operation lookup. Concurrent
first submissions of the same `operation_id` therefore serialize: the first
commits the operation, and the second reads and compares that stored operation.
Database uniqueness on `operation_id` remains the final admission constraint.

Acceptance-operation records remain for the lifetime of their owning project.
Deleting a record would end its idempotency guarantee and could let a late retry
append duplicate evidence. Explicit project removal may delete the record with
the rest of that project's application state. Raw source-material retention is
a separate policy.

`committed_at` is the application-assigned timestamp for the successful
acceptance transaction. It is selected and stored inside that transaction. A
rolled-back transaction leaves no durable timestamp or operation record.

## Project-local evidence ordering

New evidence receives a contiguous project-local sequence inside the
acceptance transaction. Command order determines order within one accepted
batch. The persistence model must enforce uniqueness on
`(projectId, sequence)`. Replayed evidence reuses its existing sequence, and a
rolled-back transaction advances no sequence.

The SQLite-assigned `EvidenceItemId` remains evidence identity. Sequence is an
ordered project coordinate used for maintenance frontiers; it is not a
replacement identity and is never derived from an evidence ID.

## Maintenance eligibility and coalescing

`EvidenceAcceptanceService` delegates Session request decisions to its injected
[`SessionMaintenanceScheduleService`](../session-maintenance/session-maintenance-schedule.service.ts.md).
When the command appends new evidence, it supplies the accepted sequence range,
intent, acceptance time, and current transaction. A replay-only command does
not create, extend, or promote a maintenance request. The schedule capability
synchronizes its injected validated effective policy inside the current
transaction and evaluates against the exact returned immutable revision. A
created request records that revision. Exact threshold and elapsed-time values
remain configuration, not constants in this service.

Two frontiers prevent overlapping work:

```text
covered frontier
  highest project evidence sequence completed by successful Session maintenance

scheduled frontier
  highest project evidence sequence assigned to a pending or running request
```

Evidence already inside a running request is not yet covered, but it is already
scheduled. Count eligibility therefore uses evidence after the scheduled
frontier rather than counting the running frontier again.

The schedule capability owns active-chain validation, covered and scheduled
frontier calculation, count, elapsed-time and immediate eligibility, and the
choice of exact request write. Its
[`SessionMaintenanceEvidenceReader`](../session-maintenance/session-maintenance-evidence.reader.ts.md)
port supplies the first uncovered Evidence Log `received_at` when no Session
maintenance has succeeded. `EvidenceLogRepository` implements that narrow port
without deciding eligibility.

The schedule capability joins the `IMMEDIATE` transaction already owned by
`accept()`. It does not open or nest a transaction. The repositories return raw
domain snapshots and apply only the exact insert, extension, or priority
promotion selected by the schedule capability.

The first accepted evidence starts the elapsed-time clock when maintenance has
never succeeded. Time passing alone does not invoke maintenance. The next
accepted evidence asks the schedule capability to perform the eligibility
evaluation.

`immediate` is another trigger for the same maintenance path. It bypasses count
and elapsed-time eligibility, includes all currently unscheduled evidence
through the transaction's latest sequence, and promotes an existing pending
request. It does not run curation synchronously or keep the capture, CLI, or MCP
request open until curation finishes.

A pending request can grow because no worker has frozen it. Once a request is
running, its evidence frontier and policy revision never change. A failed or
expired attempt does not return that request to pending. Evidence accepted
after its frozen frontier remains available for one non-overlapping pending
successor.

## Maintenance execution boundary

`accept()` creates or coalesces durable requests. It does not create an
execution attempt or advance the covered cursor.

Later maintenance execution preserves these established relationships:

```text
SessionMaintenanceRequest
  state: pending | running | satisfied
  owns the finite evidence frontier that must be processed

SessionMaintenanceAttempt
  state: running | succeeded | failed
  owns one execution and its failure evidence
  holds a renewable lease owner and lease expiry

successful current attempt
  -> satisfy request
  -> advance SessionMaintenanceState through the frozen request frontier

failed or expired attempt
  -> retain failed attempt history
  -> keep request running with its frontier frozen
  -> leave request eligible for a replacement attempt
  -> do not advance SessionMaintenanceState
```

Recovery must atomically replace the current failed or expired attempt without
reopening the request frontier. Completion must match the current attempt
identity, lease owner, and valid lease so that a stale worker cannot publish or
advance the cursor after replacement. The concrete worker, claim, retry, and
publication owners remain outside this service and are not yet shaped.

The post-commit notification is only an acceleration. Failure to deliver that
notification cannot remove the durable Session maintenance request or make
another hook event necessary for recovery.

## Remaining persistence boundary

The acceptance-operation record above is represented by the
[`EvidenceAcceptanceOperation` model](../storage/sqlite/models/evidence-acceptance-operation.model.ts.md).
[`EvidenceAcceptanceOperationRepository`](../storage/sqlite/repositories/evidence-acceptance-operation.repository.ts.md)
owns operation lookup and immutable insertion through the transaction supplied
by this service.
[`SessionMaintenancePolicy`](../storage/sqlite/models/session-maintenance-policy.model.ts.md)
owns immutable project-effective Session policy revisions.
[`SessionMaintenancePolicyRepository`](../storage/sqlite/repositories/session-maintenance-policy.repository.ts.md)
supplies the latest revision to
[`SessionMaintenancePolicyService`](../session-maintenance/session-maintenance-policy.service.ts.md)
through this service's acceptance transaction. The policy service appends
changed effective values through the same repository in that transaction and
returns the exact revision used by scheduling.
[`SessionMaintenanceRequest`](../storage/sqlite/models/session-maintenance-request.model.ts.md)
owns finite Session maintenance obligations and their active-state
multiplicity constraints.
[`SessionMaintenanceRequestRepository`](../storage/sqlite/repositories/session-maintenance-request.repository.ts.md)
returns raw active snapshots and applies the exact insert, extension, or
priority-promotion selected by the schedule capability.
[`SessionMaintenanceState`](../storage/sqlite/models/session-maintenance-state.model.ts.md)
owns Session Memory's project-scoped covered frontier outside the `Project`
model. Its
[`SessionMaintenanceStateRepository`](../storage/sqlite/repositories/session-maintenance-state.repository.ts.md)
supplies the transactional snapshot used by the schedule capability. The
[`SessionMaintenanceLifecycleService`](../session-maintenance/session-maintenance-lifecycle.service.ts.md)
owns its use during project bootstrap. Its guarded advance operation belongs to
later successful maintenance completion, not acceptance.
`SqliteDatabase` owns
the process-scoped Sequelize connection and `IMMEDIATE` write-transaction
boundary. [`EvidenceLogRepository`](../storage/sqlite/repositories/evidence-log.repository.ts.md)
maps each validated `EvidenceCandidateDto` plus acceptance-owned metadata to
the append-only
[`EvidenceItem` model](../storage/sqlite/models/evidence-item.model.ts.md).
Stable query fields are relational columns, while complete nested provenance
and context remain available as lossless JSON. Insertion returns the
SQLite-generated identity used to construct `EvidenceItemDto`. The same mapper
and transaction produce and commit both stored forms.

This artifact does not establish other Evidence Log read methods, the schema
migration owner, or the future explicit-forgetting owner. Those details remain
`OPEN`; replay lookup, append, the model, and the hybrid persistence decision do
not.
