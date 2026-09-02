# `src/application.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/application.ts`

This artifact narrows `Application` to the fixed-project local prototype. It
owns one process-scoped composition and SQLite lifecycle. It makes the
development capture fixture callable without composing project discovery,
provider hooks, query, installation, or durable-memory product Inboxes.
The Project Registration Store supports many projects; only this prototype
composition selects one hard-coded project.

```ts
// intentionally illustrative pseudocode

type LocalProjectConfiguration = Readonly<{
  key: "llm-wiki-local"
  rootPath: "/Users/liadgoren/Repositories/llm-wiki"
  repositoryRootPath: "/Users/liadgoren/Repositories/llm-wiki"
  branch: "master"
}>

type LocalApplicationConfiguration = Readonly<{
  sqlite: Readonly<{
    databasePath: absolute local application-state path
  }>
  localProject: LocalProjectConfiguration
  maintenance: Readonly<{
    session: ValidatedEffectiveSessionMaintenancePolicy
  }>
}>

type LocalCaptureFixtureInput = Readonly<{
  providerSessionReference: string
  fixtureReference: string
  content: string
}>

class Application {
  PRIVATE CONSTRUCTOR(
    private readonly sqliteDatabase: SqliteDatabase,
    private readonly localProject: registered fixed local project context,
    private readonly developmentCaptureFixture: Development Capture Fixture
  ) {}

  STATIC async create(
    configuration: LocalApplicationConfiguration
  ): Promise<Application> {
    require configuration contains the one accepted local project
    require configuration.maintenance.session is already validated

    sqliteRuntime = await SqliteRuntime.initialize()
    sqliteDatabase = await SqliteDatabase.open({
      databasePath: configuration.sqlite.databasePath,
      runtime: sqliteRuntime
    })

    TRY
      construct Project Registration Store with sqliteDatabase
      construct Session maintenance lifecycle persistence with sqliteDatabase
      sessionLifecycle = construct SessionMaintenanceLifecycleService

      localProject = await sqliteDatabase.writeTransaction(transaction => {
        registration = ask Project Registration Store to create or reuse:
          the hard-coded configuration.localProject
          among its durable multi-project registrations
          using transaction

        IF registration disposition is "created"
          await sessionLifecycle.initializeNewProject(
            registration.projectIdentity,
            transaction
          )
        ELSE
          await sessionLifecycle.requireInitializedProject(
            registration.projectIdentity,
            transaction
          )

        return the registered project identity and fixed WorkspaceContext
      })

      construct evidence persistence repositories with sqliteDatabase
      construct Session maintenance policy and schedule capabilities with:
        configuration.maintenance.session
        local Project Session state
        Session maintenance persistence
        Evidence Log reader

      evidenceAcceptance = construct EvidenceAcceptanceService with:
        evidence persistence repositories
        Session maintenance schedule capability
        sqliteDatabase

      capturedEvidenceIngestion = construct CapturedEvidenceIngestionService with:
        evidenceAcceptance

      developmentCaptureFixture = construct Development Capture Fixture with:
        fixed source identity "development.fixture"
        localProject WorkspaceContext
        capturedEvidenceIngestion

      return new Application(
        sqliteDatabase,
        localProject,
        developmentCaptureFixture
      )

    CATCH failure
      await sqliteDatabase.close while preserving the original failure
      fail Application creation with a safe diagnostic
  }

  captureFixture(
    input: LocalCaptureFixtureInput
  ): Promise<EvidenceAcceptanceReceipt> {
    return developmentCaptureFixture.capture(input)
  }

  close(): Promise<void> {
    return sqliteDatabase.close()
  }
}
```

## Startup boundary

`Application.create` owns the complete startup transaction for the fixed local
Project row and its Session lifecycle state. If the Project row is new, the
same transaction initializes Session lifecycle state. If the row already
exists, startup requires compatible Session state and does not silently repair
missing durable state.

The fixed local selection is an Application-composition constraint, not a
Project Registration Store constraint. The store persists the final
multi-project Project shape. General registration, resolution, relocation, and
public project selection remain outside this local prototype operation.

The fixed Project transaction completes before evidence intake becomes
callable. Session policy synchronization remains inside later evidence
acceptance. Startup only establishes the Project and Session lifecycle
preconditions required by that path.

If composition fails after SQLite opens, `Application.create` closes the open
database before it returns the failure. A successfully created `Application`
owns that database until `close` completes.

## Operation boundary

`captureFixture` is the only application operation required by the first local
executable slice. It binds the fixed project context established at startup.
The CLI supplies only the fixture references and exact transcript content. It
cannot select another project through the operation input.

The application delegates capture behavior. It does not read transcript files,
construct CLI output, normalize provider payloads, accept evidence directly,
or execute Session maintenance.

## Accepted later extension

When Project, Personal, and Practice Memory provide their durable Inboxes,
application composition adds `TargetedMemoryInsertionService` and exposes:

```ts
// intentionally illustrative later extension

type LocalMemoryProposalInput = Readonly<{
  invocationContext: trusted CLI, MCP, or function context
  target: "project" | "personal" | "practice"
  items: non-empty ordered exact content items
  clientReference?: string
}>

proposeMemory(
  input: LocalMemoryProposalInput
): Promise<TargetedInsertionResult> {
  delegate to TargetedMemoryInsertionService with:
    fixed localProject.key
    input.invocationContext
    input.target
    input.items
    input.clientReference when present
}
```

This extension reuses the fixed project bound during startup. It does not add a
project selector, route proposals through captured evidence, or involve Session
maintenance. The method does not exist in the executable Application before
its selected product Inboxes and operation ledger can satisfy the contract.

## Ownership boundary

`Application` owns construction order, process-scoped dependency ownership,
the fixed Project and Session startup transaction, public operation delegation,
partial-startup cleanup, and final SQLite cleanup.

It does not expose repositories or services, hold global state, act as a
service locator, implement domain workflows, or infer configuration from the
current working directory or Git.
