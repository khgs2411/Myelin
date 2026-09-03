# `WorkspaceContext`

> Pseudocode artifact. Non-executable reference shape.
>
> Superseded by the
> [unified WorkspaceContext artifact](../../2026-09-03-fixed-local-project-context/pseudocode/workspace-context.md).

`WorkspaceContext` is a semantic application value. Accepted design does not
require a standalone source-file destination. The value carries resolved scope
to project-aware operations without exposing persistence or resolution logic.

```ts
// intentionally illustrative pseudocode

type ProjectIdentity = private positive integer assigned by SQLite
type ProjectKey = validated user-assigned immutable public key
type CanonicalDirectoryPath = absolute, filesystem-normalized real path

type WorkspaceContext = Readonly<{
  project: Readonly<{
    identity: ProjectIdentity
    key: ProjectKey
    rootPath: CanonicalDirectoryPath
  }>

  workingDirectory: CanonicalDirectoryPath

  repository?: Readonly<{
    rootPath: CanonicalDirectoryPath
    branch:
      | Readonly<{
          kind: "active"
          name: string
        }>
      | Readonly<{
          kind: "unavailable"
          safeDiagnostic: string
        }>
  }>
}>
```

## Construction invariants

- Project identity, key, root, and optional repository root originate from one
  existing durable Project registration.
- `workingDirectory` is canonical and belongs to the resolved Project scope.
- `repository` is absent when the Project has no registered repository root.
- When `repository` exists, branch observation records either an active branch
  or a safe unavailable result. An unavailable branch does not invalidate the
  resolved Project context.
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

- [Workspace context service](../../2026-08-12-our-app/pseudocode/src/workspace/workspace-context.service.ts.md)
- [Project identity boundary](../../2026-09-02-ingestion-boundaries/pseudocode/project-identity.md)
- [Local Project Seed](../../2026-09-03-local-project-seed/feature-shape.md)
