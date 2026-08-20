# `src/application.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/application.ts`

`Application` is the stable provider-neutral façade over our app's public
behaviors. Its static `create` factory method owns process-scoped composition;
its application-service dependencies remain private implementation details.

```ts
// intentionally illustrative pseudocode

type ProviderIdentity = Readonly<{
  key: string
}>

RULES ProviderIdentity
  key is the stable application-owned identity key for one provider
  example key: "codex"
  key does not identify a model, provider version, or capture channel
  key selects a provider contract; it does not authenticate the caller

type CaptureProviderConfiguration = {
  invocationContext: CaptureInvocationContext
  settings: unknown // provider-specific input validated during composition
}

type AgentExecutionProviderConfiguration = {
  provider: ProviderIdentity
  settings: unknown // provider-specific input validated during composition
}

type SqliteRuntimeConfiguration =
  validated packaged-runtime selection consumed only by SqliteRuntime

type SqliteApplicationConfiguration = Readonly<{
  databasePath: absolute application-state file path
  runtime: SqliteRuntimeConfiguration
}>

type RuntimeApplicationConfiguration = {
  captureProvider: CaptureProviderConfiguration
  agentExecution: AgentExecutionProviderConfiguration
  sqlite: SqliteApplicationConfiguration
  // OPEN: remaining machine configuration joins this shape when designed
}

class Application {
  PRIVATE CONSTRUCTOR dependencies {
    evidenceCaptureService
    queryService
    evidenceInsertionService
    sqliteDatabase
    // OPEN: application-service owner for project registration
  }

  STATIC async create(
    configuration: RuntimeApplicationConfiguration
  ): Promise<Application> {
    sqliteRuntime = await SqliteRuntime.initialize(configuration.sqlite.runtime)
    sqliteDatabase = await SqliteDatabase.open({
      databasePath: configuration.sqlite.databasePath,
      runtime: sqliteRuntime
    })

    captureAdapter = construct the capture-provider capability selected by:
      configuration.captureProvider.invocationContext.route.provider
    construct SQLite repositories with the same sqliteDatabase instance
    workspaceContextService = construct with its persistence dependencies
    evidenceAcceptanceService = construct with its persistence dependencies

    agentAdapter = construct the configured agent-execution capability

    evidenceCaptureService = construct with:
      configuration.captureProvider.invocationContext
      captureAdapter
      workspaceContextService
      evidenceAcceptanceService
    evidenceInsertionService = construct with:
      workspaceContextService
      evidenceAcceptanceService
    queryService = construct with its dependencies
    // OPEN: construct the project-registration owner once its source boundary
    // is shaped

    return new Application({
      evidenceCaptureService,
      queryService,
      evidenceInsertionService,
      sqliteDatabase,
      project registration owner
    })
  }

  bootstrapProject(
    input: ProjectBootstrapInput
  ): Promise<ProjectBootstrapResult> {
    delegate to the OPEN project-registration owner
  }

  capture(input: CaptureInput): Promise<CaptureResult> {
    return evidenceCaptureService.capture(input)
  }

  query(input: QueryInput): Promise<QueryResult> {
    return queryService.query(input)
  }

  insertEvidence(
    input: EvidenceInsertionInput
  ): Promise<EvidenceAcceptanceReceipt> {
    return evidenceInsertionService.insert(input)
  }

  close(): Promise<void> {
    return sqliteDatabase.close()
  }
}

type CaptureInput = {
  nativeActivity: ProviderNativeActivity
}

type ProjectIdentity = positive integer assigned by SQLite

type CanonicalDirectoryPath = absolute, filesystem-normalized real path

type ProjectBootstrapInput = Readonly<{
  directoryPath: string
}>

type ProjectBootstrapResult = Readonly<{
  projectIdentity: ProjectIdentity
  rootPath: CanonicalDirectoryPath
  repositoryRootPath?: CanonicalDirectoryPath
  disposition: "created" | "already-registered"
}>
```

## Ownership boundary

`Application.create` owns asynchronous dependency construction and returns one
application instance per process. It initializes the packaged SQLite runtime,
opens one process-scoped `SqliteDatabase`, and injects that same instance into
the process's SQLite repositories. `Application.close` releases the database
connection during CLI cleanup.

For a capture invocation, the CLI resolves the explicitly declared provider and
channel into one immutable `CaptureInvocationContext` before composition.
`Application.create` uses its route to construct one matching `CaptureAdapter`,
then injects both the invocation context and adapter directly into
`EvidenceCaptureService`. The adapter does not declare a second provider
identity. Agent execution remains independently configured; there is no
application-wide provider.

The instance owns the stable operation names and delegates each operation to
the service that owns its workflow.

`bootstrapProject` is provider-neutral. It registers one exact directory in
the `Project` model as an oversight root and returns its immutable
SQLite-assigned identity. Git-backed projects also return their bundled
repository root. The source file and concrete application-service owner for
this registration workflow remain `OPEN`; `Application` does not absorb that
workflow merely because it exposes the operation.

It does not expose its services, normalize native activity, curate memory, or
persist evidence or project registration directly. `EvidenceCaptureService` receives
one adapter and therefore does not perform runtime provider lookup.
