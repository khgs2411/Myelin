# `src/storage/sqlite/repositories/session-maintenance-policy.repository.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/storage/sqlite/repositories/session-maintenance-policy.repository.ts`

`SessionMaintenancePolicyRepository` owns transaction-scoped lookup and
immutable insertion of project-effective Session policy revisions.
`SessionMaintenancePolicyService` decides whether values changed through the
acceptance transaction supplied by Session scheduling.

```ts
// intentionally illustrative pseudocode

type SessionMaintenancePolicySnapshot = Readonly<{
  projectId: ProjectIdentity
  revision: SessionMaintenancePolicyRevision
  evidenceCountThreshold: positive integer
  elapsedInterval: normalized positive duration
  configurationDigest: string
}>

class SessionMaintenancePolicyRepository {
  async findLatestByProjectId(
    projectId: ProjectIdentity,
    transaction: SqliteTransaction
  ): Promise<SessionMaintenancePolicySnapshot | null> {
    row = find the SessionMaintenancePolicy with the highest revision
      through the supplied transaction where project_id == projectId

    IF row does not exist
      return null

    return the immutable domain snapshot represented by row
  }

  async insertRevision(
    policy: SessionMaintenancePolicySnapshot,
    transaction: SqliteTransaction
  ): Promise<void> {
    insert one SessionMaintenancePolicy through the supplied transaction using
      the exact project, revision, threshold, interval, and digest supplied
  }
}
```

`SessionMaintenancePolicyService` loads the latest row, compares canonical
effective values, and supplies the exact next revision only when those values
differ. This repository does not compare configuration, select active state
through a mutable pointer, compute revisions, or own a transaction.

The policy service uses the nullable lookup to create revision one only when the
operation contains the project's first accepted Evidence Log sequence. Later
absence is incompatible durable state. `SessionMaintenanceScheduleService`
calls that service inside the caller's `IMMEDIATE` acceptance transaction. It
evaluates Session eligibility against the exact returned revision and records
that revision on a created request.

The composite primary key is the final concurrency constraint against duplicate
revisions. Policy synchronization is not exposed as a separate application
operation. The repository exposes no required lookup, update, upsert, delete,
or policy operation for another memory product.
