# `src/storage/sqlite/repositories/session-maintenance-request.repository.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/storage/sqlite/repositories/session-maintenance-request.repository.ts`

`SessionMaintenanceRequestRepository` owns transaction-scoped persistence for
Session maintenance requests. `SessionMaintenanceScheduleService` owns
eligibility, frontier calculation, and coalescing decisions.
`EvidenceAcceptanceService` owns the acceptance transaction.

```ts
// intentionally illustrative pseudocode

type SessionMaintenanceRequestSnapshot = Readonly<{
  id: SessionMaintenanceRequestId
  projectId: ProjectIdentity
  fromSequenceExclusive: nonnegative integer
  throughSequenceInclusive: ProjectEvidenceSequence
  state: SessionMaintenanceRequestState
  priority: SessionMaintenanceRequestPriority
  sessionMaintenancePolicyRevision: SessionMaintenancePolicyRevision
}>

type NewPendingSessionMaintenanceRequest = Readonly<{
  projectId: ProjectIdentity
  fromSequenceExclusive: nonnegative integer
  throughSequenceInclusive: ProjectEvidenceSequence
  priority: SessionMaintenanceRequestPriority
  sessionMaintenancePolicyRevision: SessionMaintenancePolicyRevision
}>

class SessionMaintenanceRequestRepository {
  async listActiveByProjectId(
    projectId: ProjectIdentity,
    transaction: SqliteTransaction
  ): Promise<ReadonlyArray<SessionMaintenanceRequestSnapshot>> {
    rows = find SessionMaintenanceRequest rows through the supplied transaction
      where project_id == projectId
      and state is one of "pending" or "running"

    return rows mapped to immutable domain snapshots
  }

  async insertPending(
    request: NewPendingSessionMaintenanceRequest,
    transaction: SqliteTransaction
  ): Promise<SessionMaintenanceRequestId> {
    guarded insert through the supplied transaction:
      insert exact request values plus:
        state = "pending"
      only when:
        request.throughSequenceInclusive
          <= owning Project.last_allocated_evidence_sequence

    require exactly one inserted row
    return its SQLite-generated id
  }

  async extendPendingFrontier(
    input: Readonly<{
      requestId: SessionMaintenanceRequestId
      projectId: ProjectIdentity
      throughSequenceInclusive: ProjectEvidenceSequence
    }>,
    transaction: SqliteTransaction
  ): Promise<void> {
    guarded update through the supplied transaction:
      target SessionMaintenanceRequest where:
        id == input.requestId
        project_id == input.projectId
        state == "pending"
        through_sequence_inclusive < input.throughSequenceInclusive
        owning Project.last_allocated_evidence_sequence
          >= input.throughSequenceInclusive
      set:
        through_sequence_inclusive = input.throughSequenceInclusive

    require exactly one affected row
    otherwise fail the caller's transaction with an invariant violation
  }

  async promotePendingPriority(
    input: Readonly<{
      requestId: SessionMaintenanceRequestId
      projectId: ProjectIdentity
    }>,
    transaction: SqliteTransaction
  ): Promise<void> {
    guarded update through the supplied transaction:
      target SessionMaintenanceRequest where:
        id == input.requestId
        project_id == input.projectId
        state == "pending"
        priority == "normal"
      set:
        priority = "immediate"

    require exactly one affected row
    otherwise fail the caller's transaction with an invariant violation
  }
}
```

`listActiveByProjectId` returns raw request facts. It does not calculate a
scheduled frontier or decide which eligibility rule applies. The partial
unique indexes guarantee at most one row in each active state. The service
still owns the meaning of a pending successor beside a running request.

`insertPending`, `extendPendingFrontier`, and `promotePendingPriority` receive
exact values selected by the service. They do not upsert, coalesce, select a
policy, or classify immediate eligibility. Every method uses the caller's
explicit `IMMEDIATE` transaction.

The guarded writes protect row identity, project ownership, pending state, and
the allocated Evidence Log ceiling. They do not claim to enforce contiguous or
non-overlapping active frontiers. `SessionMaintenanceScheduleService` must
calculate those relationships from the covered and active-request snapshots
before it supplies a write.

This repository exposes no general update or delete method. The later Session
execution boundary will add only the exact pending-to-running and
running-to-satisfied operations required by attempt claiming and fenced
completion. Those operations are not shaped here.
