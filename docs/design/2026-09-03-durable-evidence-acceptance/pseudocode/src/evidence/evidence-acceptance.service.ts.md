# `src/evidence/evidence-acceptance.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/evidence/evidence-acceptance.service.ts`

`EvidenceAcceptanceService` owns the atomic transition from normalized,
project-bound capture candidates to immutable durable evidence. It does not
construct candidates or execute Session maintenance.

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
  sessionMaintenanceIntent: "policy" | "immediate"
}>

type EvidenceAcceptanceReceipt = Readonly<{
  operationId: ApplicationOperationId
  projectId: ProjectIdentity
  items: ReadonlyArray<{
    evidenceId: EvidenceItemId
    disposition: "accepted" | "replayed"
    sequence: ProjectEvidenceSequence
  }>
  sessionMaintenance: unknown
    // OPEN: exact Session Maintenance Obligation result shape
  committedAt: normalized timestamp
}>

class EvidenceAcceptanceService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly evidenceLog: EvidenceLogRepository,
    private readonly acceptanceOperations:
      EvidenceAcceptanceOperationRepository,
    // OPEN: exact dependency that persists Session Maintenance Obligation
  ) {}

  async accept(
    command: EvidenceAcceptanceCommand
  ): Promise<EvidenceAcceptanceReceipt> {
    validate the complete command before durable mutation
      require at least one item
      require every candidate is valid
      require every source-material digest matches its exact content bytes
      require every candidate.workspaceContext.project.identity is identical

    projectId = the shared candidate.workspaceContext.project.identity
    commandFingerprint = fingerprint the complete caller-controlled command
      using the established operation-fingerprint contract

    return database.writeTransaction(async transaction => {
      existingOperation = await acceptanceOperations.findByOperationId(
        command.operationId,
        transaction
      )

      IF existingOperation exists
        IF its fingerprint does not match commandFingerprint
          fail with operation identity conflict

        decode and validate its stored versioned receipt
        return that exact receipt without changing evidence or Session work

      classifiedItems = preserve command order while classifying each item:
        IF sourceReplay is absent
          classify as new
        ELSE
          candidateFingerprint = fingerprint the complete candidate
            using the established source-replay fingerprint contract
          existingEvidence = await evidenceLog.findByReplayIdentity(
            sourceReplay,
            transaction
          )

          IF existingEvidence is absent
            classify as new with sourceReplay and candidateFingerprint
          ELSE IF its candidate fingerprint matches candidateFingerprint
            classify as replayed with its existing identity and sequence
          ELSE
            fail with source replay conflict

      newItems = classifiedItems where disposition is new

      IF newItems is not empty
        sequenceRange = await evidenceLog.reserveProjectSequenceRange(
          projectId,
          newItems.length,
          transaction
        )

        append each new item in command order with:
          next sequence from sequenceRange
          one transaction acceptance time
          optional replay persistence

        sessionMaintenance = record Session Maintenance Obligation for:
          projectId
          sequenceRange.first
          sequenceRange.last
          command.sessionMaintenanceIntent
          transaction acceptance time
          using this transaction

        // OPEN: exact obligation owner, shape, and result
      ELSE
        sessionMaintenance = "unchanged"

      receipt = construct from:
        command operation identity
        projectId
        accepted identities and sequences
        replayed identities and sequences
        sessionMaintenance result
        transaction acceptance time

      await acceptanceOperations.appendSuccessfulOperation(
        {
          operationId: command.operationId,
          projectId,
          commandFingerprint,
          versionedReceipt: receipt,
          committedAt: transaction acceptance time
        },
        transaction
      )

      return receipt
    })
  }
}
```

## Atomic boundary

The write transaction starts before operation lookup. Evidence append,
project-sequence allocation, the Session obligation, and the immutable receipt
therefore commit or roll back together. The service never opens nested
repository transactions.

`operationId` protects a retry of one complete application command. Optional
source replay identity protects repeated delivery of one source event across
different operations. SQLite evidence identity identifies accepted evidence.
Project sequence orders accepted evidence for one Project. None replaces
another.

A stored operation retry returns its exact receipt before policy or obligation
evaluation. A new operation containing only source replays stores its own
receipt but does not create or advance Session work.

## Ownership boundary

The service validates admission and classifies conflicts. Repositories map and
persist the exact writes selected by the service. The future development
fixture and provider-capture paths construct candidates before this boundary.
Later Session owners consume the durable obligation after commit.

The service does not parse transcripts, normalize provider events, resolve a
working directory, interpret evidence meaning, create memory, execute Session
maintenance, or invoke an agent.
