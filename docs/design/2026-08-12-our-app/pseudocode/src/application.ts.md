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
  validated Bun 1.4 and packaged sqlite3-runtime selection
  consumed only by SqliteRuntime

type SqliteApplicationConfiguration = Readonly<{
  databasePath: absolute application-state file path
  runtime: SqliteRuntimeConfiguration
}>

type MaintenanceConfiguration = Readonly<{
  session: ValidatedEffectiveSessionMaintenancePolicy
}>

type RuntimeApplicationConfiguration = {
  captureProvider: CaptureProviderConfiguration
  agentExecution: AgentExecutionProviderConfiguration
  sqlite: SqliteApplicationConfiguration
  maintenance: MaintenanceConfiguration
  // OPEN: remaining machine configuration joins this shape when designed
}

class Application {
  PRIVATE CONSTRUCTOR dependencies {
    evidenceCaptureService
    queryService
    evidenceInsertionService
    sqliteDatabase
    // OPEN: application-service owner for project bootstrap
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
    sessionMaintenanceStateRepository = construct with sqliteDatabase
    sessionMaintenancePolicyRepository = construct with sqliteDatabase
    sessionMaintenanceRequestRepository = construct with sqliteDatabase
    sessionMaintenanceLifecycle = construct with:
      sessionMaintenanceStateRepository
    sessionMaintenancePolicy = construct with:
      sessionMaintenancePolicyRepository
    sessionMaintenanceSchedule = construct with:
      configuration.maintenance.session
      sessionMaintenancePolicy
      sessionMaintenanceStateRepository
      sessionMaintenanceRequestRepository
      evidenceLogRepository through SessionMaintenanceEvidenceReader
    sessionMaintenance = construct with:
      lifecycle: sessionMaintenanceLifecycle
      schedule: sessionMaintenanceSchedule
    workspaceContextService = construct with its persistence dependencies
    evidenceAcceptanceService = construct with:
      its evidence-acceptance persistence dependencies
      sessionMaintenance.schedule

    // OPEN: construct AgentAdapter when the first shaped memory-maintenance
    // workflow or optional query-result aggregator requires it. Core query
    // does not require agent execution.

    evidenceCaptureService = construct with:
      configuration.captureProvider.invocationContext
      captureAdapter
      workspaceContextService
      evidenceAcceptanceService
    evidenceInsertionService = construct with:
      workspaceContextService
      evidenceAcceptanceService
    queryService = construct with:
      workspaceContextService
      Session Memory query capability once shaped
      Project Memory query capability once shaped
      Personal Memory query capability once shaped
      Practice Memory query capability once shaped
    // AgentAdapter is not a QueryService dependency. An optional later query
    // result aggregator may receive it through its own application boundary.
    // OPEN: construct the project-bootstrap owner once its source boundary
    // is shaped; inject only sessionMaintenance.lifecycle

    return new Application({
      evidenceCaptureService,
      queryService,
      evidenceInsertionService,
      sqliteDatabase,
      project bootstrap owner
    })
  }

  bootstrapProject(
    input: ProjectBootstrapInput
  ): Promise<ProjectBootstrapResult> {
    delegate to the OPEN project-bootstrap owner, which uses one write
    transaction to coordinate Project registration and product-owned
    Session maintenance lifecycle initialization
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
application instance per Bun 1.4 process. It initializes the packaged SQLite
runtime, opens one process-scoped Sequelize-backed `SqliteDatabase`, and injects
that same instance into the process's SQLite repositories. It does not resolve
the database through a static singleton or service locator. It composes one
`SessionMaintenance` façade from independently injectable lifecycle and
schedule capabilities. The schedule capability receives the validated
effective Session policy and its internal policy service during composition.

`Application.close` releases the database connection during CLI cleanup.

For a capture invocation, the CLI resolves the explicitly declared provider and
channel into one immutable `CaptureInvocationContext` before composition.
`Application.create` uses its route to construct one matching `CaptureAdapter`,
then injects both the invocation context and adapter directly into
`EvidenceCaptureService`. The adapter does not declare a second provider
identity. Agent execution remains independently configured; there is no
application-wide provider.

The instance owns the stable operation names and delegates each operation to
the service that owns its workflow.

`bootstrapProject` is provider-neutral. Its delegated application owner uses
one SQLite write transaction to register one exact directory in the `Project`
model and calls `sessionMaintenance.lifecycle.initializeNewProject` for a new
project. For an already-registered project, it calls
`sessionMaintenance.lifecycle.requireInitializedProject`. The operation
returns the immutable SQLite-assigned project identity and, for Git-backed
projects, the repository root. The source file and concrete application-service
owner for this bootstrap workflow remain `OPEN`; `Application` does not absorb
that workflow merely because it exposes the operation.

Composition may hold the complete `SessionMaintenance` façade, but workflow
consumers receive only the capability they need. `EvidenceAcceptanceService`
receives `schedule`, and the project-bootstrap owner receives `lifecycle`.
`SessionMaintenancePolicyService` remains internal to scheduling. When
acceptance supplies the resolved project and its `IMMEDIATE` transaction,
scheduling synchronizes the injected effective policy before it evaluates
eligibility.

It does not expose its services, normalize native activity, curate memory, or
persist evidence or project registration directly. `EvidenceCaptureService` receives
one adapter and therefore does not perform runtime provider lookup.
