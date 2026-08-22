# `src/storage/sqlite/repositories/evidence-log.repository.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/storage/sqlite/repositories/evidence-log.repository.ts`

`EvidenceLogRepository` owns project-local sequence allocation, append-only
mapping and persistence, and replay-key lookup for accepted Evidence Log items.
`EvidenceAcceptanceService` owns the transaction and replay classification. It
constructs the resulting `EvidenceItemDto` after this repository returns the
SQLite-generated identity. The repository also implements the narrow
`SessionMaintenanceEvidenceReader` port without taking ownership of Session
maintenance eligibility.

```ts
// intentionally illustrative pseudocode

type ReplayCandidateFingerprint = Readonly<{
  scheme: string
  version: positive integer
  digest: string
}>

type ReplayPersistence = Readonly<{
  identity: SourceReplayIdentity
  candidateFingerprint: ReplayCandidateFingerprint
}>

type PersistedReplayEvidence = Readonly<{
  evidenceId: EvidenceItemId
  projectSequence: ProjectEvidenceSequence
  candidateFingerprint: ReplayCandidateFingerprint
}>

type ProjectEvidenceSequenceRange = Readonly<{
  first: ProjectEvidenceSequence
  last: ProjectEvidenceSequence
  size: positive integer
}>

class EvidenceLogRepository implements SessionMaintenanceEvidenceReader {
  async reserveProjectSequenceRange(
    projectId: ProjectIdentity,
    size: positive integer,
    transaction: SqliteTransaction
  ): Promise<ProjectEvidenceSequenceRange> {
    require size > 0

    project = find Project by projectId through the supplied transaction

    IF project does not exist
      fail the acceptance transaction because the project is not registered

    first = project.last_allocated_evidence_sequence + 1
    last = project.last_allocated_evidence_sequence + size

    update Project through the supplied transaction:
      last_allocated_evidence_sequence: last
      allow normal Sequelize updated_at behavior

    return {
      first,
      last,
      size
    }
  }

  async findByReplayIdentity(
    identity: SourceReplayIdentity,
    transaction: SqliteTransaction
  ): Promise<PersistedReplayEvidence | null> {
    row = find one EvidenceItem through the supplied transaction where:
      replay_domain == identity.domain
      replay_scheme == identity.scheme
      replay_key == identity.key

    IF row does not exist
      return null

    return {
      evidenceId: row.id,
      projectSequence: row.project_sequence,
      candidateFingerprint: {
        scheme: row.replay_fingerprint_scheme,
        version: row.replay_fingerprint_version,
        digest: row.replay_candidate_fingerprint
      }
    }
  }

  async requireFirstReceivedAtAfter(
    projectId: ProjectIdentity,
    sequenceExclusive: nonnegative integer,
    transaction: SqliteTransaction
  ): Promise<normalized timestamp> {
    row = find the first EvidenceItem through the supplied transaction where:
      project_id == projectId
      project_sequence > sequenceExclusive
      ordered by project_sequence ascending

    IF row does not exist
      fail the caller's transaction with an invariant violation

    return row.received_at as a normalized timestamp
  }

  async append(
    candidate: EvidenceCandidateDto,
    acceptance: Readonly<{
      projectSequence: ProjectEvidenceSequence
      receivedAt: normalized timestamp
      sourceReplay?: ReplayPersistence
    }>,
    transaction: SqliteTransaction
  ): Promise<EvidenceItemId> {
    rowValues = {
      project_id: candidate.workspaceContext.projectReference,
      project_sequence: acceptance.projectSequence,
      branch:
        candidate.workspaceContext.repository?.branch.kind == "active"
          ? candidate.workspaceContext.repository.branch.name
          : null,
      origin_kind: candidate.origin.kind,
      origin_source_key: candidate.origin.source.key,
      origin_json: candidate.origin,
      content: candidate.content,
      occurred_at: candidate.occurredAt ?? null,
      received_at: acceptance.receivedAt,
      workspace_context_json: candidate.workspaceContext,
      source_material_json: candidate.sourceMaterial,
      replay_domain: acceptance.sourceReplay?.identity.domain ?? null,
      replay_scheme: acceptance.sourceReplay?.identity.scheme ?? null,
      replay_key: acceptance.sourceReplay?.identity.key ?? null,
      replay_fingerprint_scheme:
        acceptance.sourceReplay?.candidateFingerprint.scheme ?? null,
      replay_fingerprint_version:
        acceptance.sourceReplay?.candidateFingerprint.version ?? null,
      replay_candidate_fingerprint:
        acceptance.sourceReplay?.candidateFingerprint.digest ?? null
    }

    inserted = insert EvidenceItem with rowValues through the supplied transaction

    return inserted SQLite-generated id
  }
}
```

`reserveProjectSequenceRange` owns the Evidence Log persistence operation for
allocating one consecutive project-local range. The caller supplies the number
of new items and assigns the returned values in command order. The repository
does not decide which items are new or whether a range is needed.

The supplied `IMMEDIATE` transaction keeps the selected range unavailable to a
concurrent acceptance operation until commit or rollback. The transaction
advances `Project.last_allocated_evidence_sequence` with the evidence inserts,
so rollback restores both. Database uniqueness on
`(project_id, project_sequence)` remains the final constraint.

The durable project counter never moves backward. Evidence deletion may create
sequence gaps but cannot make a previous coordinate available again. A
separate counter model is not justified because the existing project row owns
the project lifecycle and can hold this single frontier.

The repository constructs one row object from the candidate and
acceptance-owned metadata. Project ownership, nullable branch, origin
projections, normalized content, source time, and lossless JSON cannot arrive
as independent caller inputs. An active Git branch maps to its name; an
unavailable or absent branch maps to `NULL` while its complete repository
context remains preserved in `workspace_context_json`.

The mapping remains inside `EvidenceLogRepository`. A separate mapper owner is
not justified because no second consumer exists.

`append` requires the transaction supplied by `EvidenceAcceptanceService`. It
does not create, commit, roll back, or nest a transaction. A failed mapping,
constraint, or insert fails the caller's complete acceptance transaction.

The repository returns only `EvidenceItemId`. It does not return a Sequelize
model or construct `EvidenceItemDto`, because neither persistence detail belongs
in the application-service result contract.

Source replay identity remains separate admission metadata. The repository
stores it as nullable immutable projections on the accepted evidence row; it
does not place it in `EvidenceOrigin` or decide whether an incoming item is new,
replayed, or conflicting. `EvidenceAcceptanceService` owns that classification.

`findByReplayIdentity` is shaped because replay classification requires it.
`requireFirstReceivedAtAfter` is shaped because Session elapsed-time
eligibility requires the raw time of the first uncovered evidence. The schedule
capability supplies the project and covered frontier after it proves that the
uncovered range is non-empty. This repository does not decide which frontier
applies or whether elapsed time makes maintenance eligible.

Other read methods enter this repository only when concrete consumers establish
their query contracts. The repository exposes no general update or delete
operation. A future explicit-forgetting workflow uses a separate narrow
persistence path.
