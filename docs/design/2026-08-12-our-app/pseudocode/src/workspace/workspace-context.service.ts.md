# `src/workspace/workspace-context.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/workspace/workspace-context.service.ts`

`WorkspaceContextService` resolves deterministic workspace coordinates for one
capture invocation. It performs bounded local inspection. It does not perform
agentic interpretation or memory curation.

```ts
// intentionally illustrative pseudocode

type WorkspaceContextInput = Readonly<{
  observedEnvironment: {
    currentWorkingDirectory: string
  }
  providerContextHints: {
    projectReference?: string
    workingDirectory?: string
  }
}>

type WorkspaceContext = Readonly<{
  projectReference: resolved project identity
  repositoryReference: resolved repository identity
  repositoryLocation: string
  workingDirectory: string
  checkoutReference?: string
  worktreeReference?: string
  branchReference?: string
}>

class WorkspaceContextService {
  async resolve(input: WorkspaceContextInput): Promise<WorkspaceContext> {
    inspect bounded filesystem and repository facts
    reconcile provider hints with observed process facts
    return the resolved workspace coordinates
  }
}
```

## Ownership boundary

The service owns deterministic project, repository, location, checkout,
worktree, and branch resolution for the active workspace.

It does not own the provider-session reference. The capture adapter supplies
that reference as part of the normalized observation. `CaptureService` combines
the observation and `WorkspaceContext` when it constructs evidence.

The service does not inspect the complete dirty source state, decide whether
separate sessions represent the same semantic workstream, retain unresolved
evidence, or curate memory.

## Open shape

Project-identity matching rules, bounded Git inspection, and failure results
remain unresolved. These details will extend this artifact when they are
designed.
