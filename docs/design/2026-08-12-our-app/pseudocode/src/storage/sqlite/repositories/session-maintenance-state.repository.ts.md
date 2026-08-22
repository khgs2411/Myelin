# `src/storage/sqlite/repositories/session-maintenance-state.repository.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/storage/sqlite/repositories/session-maintenance-state.repository.ts`

`SessionMaintenanceStateRepository` owns persistence operations for Session
Memory's project-scoped maintenance cursor. The Session lifecycle, schedule,
and later successful-completion capabilities own the meaning of its operations.
Every operation uses the caller's explicit SQLite transaction.

```ts
// intentionally illustrative pseudocode

type SessionMaintenanceCoveredSequence = nonnegative integer

type SessionMaintenanceSnapshot = Readonly<{
  lastCoveredEvidenceSequence: SessionMaintenanceCoveredSequence
  lastSuccessfulMaintenanceAt: normalized timestamp | null
}>

class SessionMaintenanceStateRepository {
  async initialize(
    projectId: ProjectIdentity,
    transaction: SqliteTransaction
  ): Promise<void> {
    insert SessionMaintenanceState through the supplied transaction:
      project_id: projectId
      last_covered_evidence_sequence: 0
      last_successful_maintenance_at: null
  }

  async requireByProjectId(
    projectId: ProjectIdentity,
    transaction: SqliteTransaction
  ): Promise<SessionMaintenanceSnapshot> {
    row = find SessionMaintenanceState by projectId through the transaction

    IF row does not exist
      fail with incompatible durable state

    return {
      lastCoveredEvidenceSequence: row.last_covered_evidence_sequence,
      lastSuccessfulMaintenanceAt: row.last_successful_maintenance_at
    }
  }

  async advanceCoveredFrontier(
    input: Readonly<{
      projectId: ProjectIdentity
      throughSequence: ProjectEvidenceSequence
      successfulAt: normalized timestamp
    }>,
    transaction: SqliteTransaction
  ): Promise<void> {
    guarded update through the supplied transaction:
      target SessionMaintenanceState where:
        project_id == input.projectId
        last_covered_evidence_sequence < input.throughSequence
        owning Project.last_allocated_evidence_sequence
          >= input.throughSequence
      set:
        last_covered_evidence_sequence = input.throughSequence
        last_successful_maintenance_at = input.successfulAt

    require exactly one affected SessionMaintenanceState row
    otherwise fail the caller's transaction with an invariant violation
  }
}
```

`initialize` is called only through `SessionMaintenanceLifecycleService` after
the project-bootstrap transaction creates a new `Project`. Database uniqueness
rejects duplicate initialization. Bootstrap for an existing project calls the
lifecycle service's required-state path; it does not repair missing state
during an ordinary application operation.

`requireByProjectId` returns domain values rather than a Sequelize model.
`SessionMaintenanceScheduleService` uses this snapshot to calculate the covered
and scheduled frontiers and the elapsed-time anchor. The repository does not
decide whether maintenance is eligible.

`advanceCoveredFrontier` receives the exact frozen request frontier and
successful completion time from the later maintenance-completion owner. It does
not select a request, classify attempt success, or own the transaction. The
guard preserves:

```text
current covered sequence
  < supplied frozen request frontier
  <= Project.last_allocated_evidence_sequence
```

The caller must also fence completion against the current attempt before it
advances this state. That completion workflow remains outside this repository
and is not yet shaped.

The repository exposes no general update, upsert, delete, or higher-memory
operation. Project, Personal, and Practice maintenance do not enter this table
or repository.
