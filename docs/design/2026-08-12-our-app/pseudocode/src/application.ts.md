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

type RuntimeApplicationConfiguration = {
  captureProvider: CaptureProviderConfiguration
  agentExecution: AgentExecutionProviderConfiguration
  // OPEN: persistence and machine configuration join this shape when designed
}

class Application {
  PRIVATE CONSTRUCTOR dependencies {
    evidenceCaptureService
    queryService
    evidenceInsertionService
    // OPEN: application-service owner for project registration
  }

  STATIC create(
    configuration: RuntimeApplicationConfiguration
  ): Application {
    captureAdapter = construct the capture-provider capability selected by:
      configuration.captureProvider.invocationContext.route.provider
    workspaceContextService = construct the workspace-context capability

    agentAdapter = construct the configured agent-execution capability

    evidenceCaptureService = construct with:
      configuration.captureProvider.invocationContext
      captureAdapter
      workspaceContextService
      evidenceIngestionService
    queryService and evidenceInsertionService = construct with their dependencies
    // OPEN: construct the project-registration owner once its source boundary
    // is shaped

    return new Application({
      evidenceCaptureService,
      queryService,
      evidenceInsertionService,
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
  ): Promise<EvidenceInsertionResult> {
    return evidenceInsertionService.insert(input)
  }
}

type CaptureInput = {
  nativeActivity: ProviderNativeActivity
}

type ProjectIdentity = Readonly<{
  value: string
}>

type RepositoryIdentity = Readonly<{
  value: string
}>

type CanonicalDirectoryPath = absolute, filesystem-normalized real path

type ProjectBootstrapInput = Readonly<{
  directoryPath: string
}>

type ProjectBootstrapResult = Readonly<{
  projectIdentity: ProjectIdentity
  rootPath: CanonicalDirectoryPath
  repositoryReference?: RepositoryIdentity
  disposition: "created" | "already-registered"
}>
```

## Ownership boundary

`Application.create` owns dependency construction and returns one application
instance per process. For a capture invocation, the CLI resolves the explicitly
declared provider and channel into one immutable `CaptureInvocationContext`
before composition. `Application.create` uses its route to construct one
matching `CaptureAdapter`, then injects both the invocation context and adapter
directly into `EvidenceCaptureService`. The adapter does not declare a second provider
identity. Agent execution remains independently configured; there is no
application-wide provider.

The instance owns the stable operation names and delegates each operation to
the service that owns its workflow.

`bootstrapProject` is provider-neutral. It registers one exact directory as an
oversight root and returns an application-owned immutable identity. The source
file and concrete application-service owner for this registration workflow
remain `OPEN`; `Application` does not absorb that workflow merely because it
exposes the operation.

It does not expose its services, normalize native activity, curate memory, or
persist evidence or project registration directly. `EvidenceCaptureService` receives
one adapter and therefore does not perform runtime provider lookup.
