# `src/evidence/evidence-ingestion.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/evidence/evidence-ingestion.service.ts`

`EvidenceIngestionService` is the deterministic, project-bound admission owner
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

type MaintenanceIntent = "policy" | "immediate"

type EvidenceAcceptanceCommand = Readonly<{
  contractVersion: EvidenceAcceptanceContractVersion
  operationId: ApplicationOperationId
  items: ReadonlyArray<EvidenceAcceptanceItem>
  maintenanceIntent: MaintenanceIntent
}>

type EvidenceAcceptanceReceipt = Readonly<{
  operationId: ApplicationOperationId
  projectId: ProjectIdentity
  items: ReadonlyArray<{
    evidenceId: EvidenceItemId
    disposition: "accepted" | "replayed"
    sequence: ProjectEvidenceSequence
  }>
  maintenance:
    | Readonly<{
        disposition: "not-requested"
      }>
    | Readonly<{
        disposition: "created" | "coalesced"
        requestId: MaintenanceRequestId
        throughSequence: ProjectEvidenceSequence
        priority: "normal" | "immediate"
      }>
  committedAt: normalized timestamp
}>

class EvidenceIngestionService {
  async accept(
    command: EvidenceAcceptanceCommand
  ): Promise<EvidenceAcceptanceReceipt> {
    reject the complete command unless every EvidenceCandidateDto is valid

    projectId = require exactly one shared project identity across command.items
    commandFingerprint = versioned deterministic fingerprint of:
      command.contractVersion
      command.maintenanceIntent
      command.items in their supplied order
        each complete candidate
        each sourceReplay value or explicit absence

    receipt = within one SQLite write transaction acquired before lookup:
      existingOperation = find acceptance operation by command.operationId

      IF existingOperation exists
        IF existingOperation.commandFingerprint != commandFingerprint
          fail with operation-identity conflict

        return existingOperation.storedReceipt

      classifiedItems = []

      FOR EACH item IN command.items
        IF item.sourceReplay does not exist
          classifiedItems.push({ kind: "new", item })
          CONTINUE

        existingReplay = find evidence by unique replay identity:
          item.sourceReplay.domain
          item.sourceReplay.scheme
          item.sourceReplay.key

        IF existingReplay does not exist
          classifiedItems.push({ kind: "new", item })
          CONTINUE

        IF existingReplay does not match item.candidate
          fail the complete command with source-replay conflict

        classifiedItems.push({
          kind: "replayed",
          item,
          evidenceId: existingReplay.evidenceId,
          sequence: existingReplay.sequence
        })

      newItems = classifiedItems where kind == "new"
      sequenceRange = reserve one contiguous project-local range for newItems

      FOR EACH new item IN command order
        evidenceItem = construct EvidenceItemDto from:
          item.candidate
          id: new application-owned EvidenceItemId
          receivedAt: transaction acceptance time

        assign evidenceItem the next sequence from sequenceRange
        map evidenceItem to the future Evidence Log persistence shape
        append evidenceItem and optional source replay identity

      maintenance = evaluateMaintenance({
        projectId,
        latestProjectSequence,
        maintenanceIntent: command.maintenanceIntent
      })

      receipt = construct EvidenceAcceptanceReceipt from:
        accepted new items and their assigned sequences
        replayed items and their existing identities and sequences
        maintenance disposition
        transaction commit time

      persist one immutable successful acceptance-operation record containing:
        command.operationId
        projectId
        fingerprint scheme and version
        commandFingerprint
        receipt schema version
        complete receipt JSON
        transaction commit time

      return receipt

    after commit, notify the maintenance runtime that durable work may exist
    return receipt
  }
}
```

## Atomic admission contract

One acceptance command belongs to one project. Our app may process different
projects in parallel, but no acceptance operation, maintenance request, or
maintenance attempt combines projects.

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
and changes maintenance eligibility.

The exact source-replay comparison projection remains `OPEN` until the Evidence
Log persistence shape is designed. Content hashes alone cannot provide source
replay equality because separate valid evidence can have the same content.

## Operation fingerprint boundary

The operation fingerprint represents the caller-controlled acceptance command,
not the durable results produced by ingestion.

```text
INCLUDED
  acceptance contract and fingerprint version
  maintenanceIntent
  ordered EvidenceCandidateDto values
  each source replay identity or its explicit absence

EXCLUDED
  operationId, which is the lookup key
  EvidenceItemId
  receivedAt
  project-local sequence
  acceptance receipt
  maintenance disposition
```

Canonicalization preserves item order and duplicate candidates, uses one
object-key order and optional-absence representation, and normalizes timestamps
to one UTC representation. Evidence content and source-material strings remain
byte-exact; they are not trimmed or Unicode-normalized. Candidate validation
must verify the source-material digest before fingerprinting.

The fingerprint scheme and version are stored with its digest. The digest is
not unique: separate operation identities can intentionally carry equal
commands. Operation fingerprinting remains distinct from source replay
comparison because operation equality also includes batch order and maintenance
intent. The exact canonical encoding library and compatibility policy for older
fingerprint versions remain `OPEN`.

## Acceptance-operation persistence

Each successful acceptance transaction creates one immutable SQLite record:

```text
evidence_acceptance_operations
  operation_id
  project_id
  fingerprint_scheme
  fingerprint_version
  command_fingerprint
  receipt_schema_version
  receipt_json
  committed_at
```

`operation_id` is an opaque application identity and the table's primary lookup
key. It does not encode project identity. `project_id` is a separate required
foreign key because one operation belongs to exactly one project. It supports
relational integrity and project lifecycle without parsing an operation ID or
receipt document.

`command_fingerprint` is not unique. It detects conflicting reuse of the same
`operation_id`; it does not suppress equal commands submitted under different
operation identities. Optional source replay identity remains the separate
cross-operation replay mechanism.

`receipt_json` stores the complete `EvidenceAcceptanceReceipt` in the same
database record. It is not a durable Markdown or filesystem artifact. The
receipt schema version selects the decoder. A retry returns the stored receipt
values without recomputing evidence or maintenance outcomes. If the runtime
cannot decode that stored version, it reports incompatible durable state rather
than manufacturing a new receipt.

The table contains no pending or failed acceptance operations. A successful
transaction commits the immutable record with its evidence and maintenance
obligation. A rejected or rolled-back transaction leaves no operation record.

The SQLite write transaction begins before the operation lookup. Concurrent
first submissions of the same `operation_id` therefore serialize: the first
commits the operation, and the second reads and compares that stored operation.
Database uniqueness on `operation_id` remains the final admission constraint.

Acceptance-operation records remain for the lifetime of their owning project.
Deleting a record would end its idempotency guarantee and could let a late retry
append duplicate evidence. Explicit project removal may delete the record with
the rest of that project's application state. Raw source-material retention is
a separate policy.

## Project-local evidence ordering

New evidence receives a contiguous project-local sequence inside the
acceptance transaction. Command order determines order within one accepted
batch. The persistence model must enforce uniqueness on
`(projectId, sequence)`. Replayed evidence reuses its existing sequence, and a
rolled-back transaction advances no sequence.

The application-owned `EvidenceItemId` remains evidence identity. Sequence is
an ordered project coordinate used for maintenance frontiers; it is not a
replacement identity and is never derived from an evidence ID.

## Maintenance eligibility and coalescing

The active `MaintenancePolicy` is an immutable, revisioned SQLite policy
created from validated YAML configuration. `accept()` reads that active policy
inside its transaction. A maintenance request records the policy revision that
caused its eligibility. Exact threshold and elapsed-time values remain
configuration, not constants in this service.

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

```text
evaluateMaintenance(input)
  cursor = load the project's maintenance cursor
  running = load the project's optional running request
  pending = load the project's optional pending request

  coveredFrontier = cursor.lastCoveredSequence
  scheduledFrontier = maximum of:
    coveredFrontier
    running.throughSequence when running exists
    pending.throughSequence when pending exists

  IF pending exists
    extend pending.throughSequence through the latest newly accepted evidence

    IF input.maintenanceIntent == "immediate"
      promote pending.priority to "immediate"

    return the coalesced pending request

  unscheduledRange = scheduledFrontier exclusive through latestProjectSequence

  IF unscheduledRange is empty
    return "not-requested"

  countEligible = unscheduledRange.count >= policy.evidenceCountThreshold

  timeAnchor =
    cursor.lastSuccessfulMaintenanceAt
    OR first uncovered evidence time when maintenance has never succeeded

  timeEligible = now - timeAnchor >= policy.elapsedInterval
  immediateEligible = input.maintenanceIntent == "immediate"

  IF NOT countEligible AND NOT timeEligible AND NOT immediateEligible
    return "not-requested"

  create one pending MaintenanceRequest:
    project = input.projectId
    fromSequenceExclusive = scheduledFrontier
    throughSequenceInclusive = latestProjectSequence
    state = "pending"
    priority = "immediate" when immediateEligible, otherwise "normal"
    maintenancePolicyRevision = policy.revision

  return the created request
```

The first accepted evidence starts the elapsed-time clock when maintenance has
never succeeded. Time passing alone does not invoke maintenance. The next
accepted evidence performs the eligibility evaluation.

`immediate` is another trigger for the same maintenance path. It bypasses count
and elapsed-time eligibility, includes all currently unscheduled evidence
through the transaction's latest sequence, and promotes an existing pending
request. It does not run curation synchronously or keep the capture, CLI, or MCP
request open until curation finishes.

A pending request can grow because no worker has frozen it. A running request
never changes. Evidence accepted after a running frontier remains available
for one non-overlapping pending successor.

## Maintenance execution boundary

`accept()` creates or coalesces durable requests. It does not create an
execution attempt or advance the covered cursor.

Later maintenance execution preserves these established relationships:

```text
MaintenanceRequest
  state: pending | running | satisfied
  owns the finite evidence frontier that must be processed

MaintenanceAttempt
  state: running | succeeded | failed
  owns one execution and its failure evidence
  holds a renewable lease owner and lease expiry

successful current attempt
  -> satisfy request
  -> advance cursor through the frozen request frontier

failed or expired attempt
  -> retain failed attempt history
  -> return request to pending
  -> do not advance cursor
```

Recovery must atomically replace an expired attempt. Completion must match the
current attempt identity, lease owner, and valid lease so that a stale worker
cannot publish or advance the cursor after replacement. The concrete worker,
claim, retry, and publication owners remain outside this service and are not
yet shaped.

The post-commit notification is only an acceleration. Failure to deliver that
notification cannot remove the durable maintenance request or make another
hook event necessary for recovery.

## Remaining persistence boundary

The acceptance-operation record above is established. This artifact does not
yet establish the remaining Evidence Log tables, their concrete SQLite column
types and indexes, repository classes, transaction API, or the packaged SQLite
access library. Those decisions belong to the SQLite persistence design that
follows.
