# `src/application.ts`

> Pseudocode artifact. Non-executable reference shape.
>
> Inherited baseline copied from the earlier Fixed Local Project Context unit.
> Its create-or-load Project flow, `llm-wiki-local` key, Session initialization,
> fixed branch, and no-inspection boundary conflict with the unified accepted
> design. Use it as review evidence only until the Application issue is
> resolved and this artifact is revised.

This artifact narrows `Application` to the fixed local project-context outcome.
It describes one complete CLI invocation. It does not describe a server
startup, general project registration, evidence intake, or later application
operations.

```ts
// intentionally illustrative pseudocode

type FixedLocalProjectConfiguration = Readonly<{
  key: "llm-wiki-local"
  rootPath: "/Users/liadgoren/Repositories/llm-wiki"
  repositoryRootPath: "/Users/liadgoren/Repositories/llm-wiki"
  branch: "master"
}>

type LocalApplicationConfiguration = Readonly<{
  databasePath:
    "/Users/liadgoren/Repositories/llm-wiki/.llm-wiki-dev/state.sqlite"
  project: FixedLocalProjectConfiguration
}>

class Application {
  PRIVATE CONSTRUCTOR(
    private readonly sqliteDatabase: SqliteDatabase,
    private readonly workspaceContext: WorkspaceContext
  ) {}

  STATIC async create(
    configuration: LocalApplicationConfiguration
  ): Promise<Application> {
    sqliteRuntime = await SqliteRuntime.initialize()
    sqliteDatabase = await SqliteDatabase.open({
      databasePath: configuration.databasePath,
      runtime: sqliteRuntime
    })

    TRY
      establish the compatible application schema
      // OPEN: SQLite schema lifecycle issue

      construct Project Registration Store with sqliteDatabase
      // OPEN: exact store representation and operation contract

      construct SessionMaintenanceStateRepository with sqliteDatabase
      construct SessionMaintenanceLifecycleService with state repository

      workspaceContext = await sqliteDatabase.writeTransaction(transaction => {
        registrationResult = ask Project Registration Store to create or load:
          configuration.project.key
          configuration.project.rootPath
          configuration.project.repositoryRootPath
          using transaction

        // OPEN: exact compatibility rules for an existing registration

        IF registrationResult disposition is "created"
          await SessionMaintenanceLifecycleService.initializeNewProject(
            registrationResult.project.identity,
            transaction
          )
        ELSE
          await SessionMaintenanceLifecycleService.requireInitializedProject(
            registrationResult.project.identity,
            transaction
          )

        return WorkspaceContext {
          projectReference: registrationResult.project.identity,
          projectRoot: registrationResult.project.rootPath,
          workingDirectory: registrationResult.project.rootPath,
          repository: {
            location: registrationResult.project.repositoryRootPath,
            branch: {
              kind: "active",
              name: configuration.project.branch
            }
          }
        }
      })

      return new Application(sqliteDatabase, workspaceContext)

    CATCH failure
      close sqliteDatabase while preserving the original failure
      fail the invocation with a safe diagnostic
  }

  close(): Promise<void> {
    return sqliteDatabase.close()
  }
}
```

## Invocation boundary

Every valid local CLI command creates one `Application`, executes one
operation, and closes it. Each invocation repeats context initialization.
Compatible durable state returns the same Project identity and equivalent
fixed `WorkspaceContext` without duplicate Project or Session state.

A new Project and its initial Session maintenance state commit in one
`IMMEDIATE` transaction. An existing Project must already have compatible
Session maintenance state. The invocation does not repair missing or
incompatible state.

The fixed branch is an invocation fact. It enters `WorkspaceContext` but not
the durable Project row. No filesystem or Git inspection occurs in this unit.

## Ownership boundary

`Application` owns invocation composition, transaction coordination,
construction of the fixed `WorkspaceContext`, partial-composition cleanup, and
final database cleanup. It does not absorb Project persistence or Session
lifecycle behavior.
