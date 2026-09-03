# `WorkspaceContext`

> Pseudocode artifact. Non-executable reference shape.

Implemented destinations:

- `ProjectRegistration`: `src/project/project-registration.ts`
- `WorkspaceContext`: `src/workspace/workspace-context.ts`

These immutable application values carry resolved scope to project-aware
operations without exposing persistence or resolution logic.

```ts
// intentionally illustrative pseudocode

type ProjectIdentity = private positive integer assigned by SQLite
type ProjectKey = validated user-assigned immutable public key
type CanonicalDirectoryPath = absolute, filesystem-normalized real path

type ProjectRegistration = Readonly<{
  identity: ProjectIdentity
  key: ProjectKey
  rootPath: CanonicalDirectoryPath
  repositoryRootPath?: CanonicalDirectoryPath
}>

type GitBranchContext =
  | Readonly<{
      kind: "active"
      name: string
    }>
  | Readonly<{
      kind: "unavailable"
      safeDiagnostic: string
    }>

type WorkspaceContext = Readonly<{
  project: ProjectRegistration
  workingDirectory: CanonicalDirectoryPath
  repositoryBranch?: GitBranchContext
}>
```

## Construction invariants

- `project` is one immutable registration returned by
  `ProjectRegistrationRepository`.
- `workingDirectory` is canonical and belongs to the resolved Project scope.
- `repositoryBranch` is absent when `project.repositoryRootPath` is absent.
- When `project.repositoryRootPath` exists, `repositoryBranch` records either
  an active branch or a safe unavailable result. An unavailable branch does not
  invalidate the resolved Project context.
- The value contains copied application facts. It does not retain a mutable
  Sequelize model instance.

## Ownership boundary

`WorkspaceContext` owns data shape only. It does not find or register Projects,
canonicalize paths, inspect Git, open a database, mutate Project state, manage a
Session, or accept evidence.

The context is safe to pass across project-scoped application services because
those services receive one resolved immutable scope instead of persistence
access or caller-supplied project identity.

## Established design sources

- [`WorkspaceContextService`](src/workspace/workspace-context.service.ts.md)
- [Project identity boundary](../../2026-09-02-ingestion-boundaries/pseudocode/project-identity.md)
- [Local Project Seed](../../2026-09-03-local-project-seed/feature-shape.md)
