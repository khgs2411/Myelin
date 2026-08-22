# `src/session-maintenance/session-maintenance-lifecycle.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/session-maintenance/session-maintenance-lifecycle.service.ts`

`SessionMaintenanceLifecycleService` owns the Session maintenance state part of
project bootstrap. It distinguishes initialization of a new project from
validation of an existing project.

```ts
// intentionally illustrative pseudocode

class SessionMaintenanceLifecycleService {
  constructor(
    private readonly states: SessionMaintenanceStateRepository
  ) {}

  async initializeNewProject(
    projectId: ProjectIdentity,
    transaction: SqliteTransaction
  ): Promise<void> {
    await states.initialize(projectId, transaction)
  }

  async requireInitializedProject(
    projectId: ProjectIdentity,
    transaction: SqliteTransaction
  ): Promise<void> {
    await states.requireByProjectId(projectId, transaction)
  }
}
```

Both methods join the caller's project-bootstrap transaction. This service does
not open, commit, roll back, or nest a transaction.

`initializeNewProject` is valid only after the same transaction creates the
owning `Project` row. `requireInitializedProject` is valid for an already
registered project. A missing state row for an existing project is incompatible
durable state. The service does not silently repair it and exposes no `ensure`
or upsert operation.

The service does not register projects, canonicalize paths, synchronize policy,
schedule requests, or advance successful maintenance. It gives the bootstrap
owner one Session-domain capability while preserving Project ownership of the
larger registration workflow.
