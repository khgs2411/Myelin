# `src/application.ts`

> Pseudocode artifact. Non-executable reference shape.

This artifact shapes `Application` as the composition and lifetime owner for
one CLI invocation. It resolves the caller-supplied working directory to one
existing Project before it constructs a usable Application.

```ts
// intentionally illustrative pseudocode

type RuntimeApplicationConfiguration = Readonly<{
  sqlite: Readonly<{
    databasePath: string
  }>
  workingDirectory: string
}>

class Application {
  PRIVATE CONSTRUCTOR(
    private readonly sqliteDatabase: SqliteDatabase,
    private readonly workspaceContext: WorkspaceContext
  ) {}

  STATIC async create(
    configuration: RuntimeApplicationConfiguration
  ): Promise<Application> {
    sqliteRuntime = await SqliteRuntime.initialize()
    sqliteDatabase = await SqliteDatabase.open({
      databasePath: configuration.sqlite.databasePath,
      runtime: sqliteRuntime
    })

    TRY
      projectRegistrationRepository =
        new ProjectRegistrationRepository()

      workspaceContextService = new WorkspaceContextService(
        projectRegistrationRepository
      )

      resolution = await workspaceContextService.resolve({
        workingDirectory: configuration.workingDirectory
      })

      IF resolution.kind is "unmanaged"
        fail Application composition with resolution.reason.safeDiagnostic

      IF resolution.kind is "failed"
        fail Application composition with resolution.failure.safeDiagnostic

      return new Application(
        sqliteDatabase,
        resolution.context
      )

    CATCH failure
      close sqliteDatabase while preserving the original failure
      rethrow the original failure
  }

  close(): Promise<void> {
    return sqliteDatabase.close()
  }
}
```

## Invocation input boundary

The CLI reads `process.cwd()` once and supplies that value as
`configuration.workingDirectory`. `Application` does not read or change the
process-global working directory.

The database path remains explicit configuration. Project key, Project root,
repository root, and branch are not Application configuration. They come from
the resolved durable registration and current branch observation.

## Composition boundary

`SqliteDatabase.open()` completes before Application constructs
`ProjectRegistrationRepository`. This guarantees that Sequelize has registered
the `Project` model before the repository reads it.

An unmanaged or failed workspace resolution prevents Application construction.
If any operation fails after the database opens, Application closes the
database and preserves the original failure. `SqliteDatabase.open()` remains
responsible for its own partial-open cleanup.

Normal composition does not use a write transaction. It does not create,
update, repair, relocate, or seed a Project. It does not initialize Session or
evidence state.

## Context access boundary

`workspaceContext` remains private Application state. The CLI does not receive
a generic context getter. Future project-scoped Application operations use the
context internally or inject it into the service that owns the operation.

## Lifecycle boundary

One CLI operation creates one Application and closes it in the CLI's existing
`finally` boundary. Application is not a server and does not own a persistent
runtime between invocations.

## Established design sources

- [`WorkspaceContextService`](workspace/workspace-context.service.ts.md)
- [`WorkspaceContext`](../workspace-context.md)
- [`ProjectRegistrationRepository`](storage/sqlite/repositories/project-registration.repository.ts.md)
