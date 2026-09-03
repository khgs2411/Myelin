# `src/workspace/workspace-context.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/workspace/workspace-context.service.ts`

`WorkspaceContextService` resolves one supplied working directory against the
existing Project registrations. It constructs an immutable `WorkspaceContext`
without creating or mutating durable state.

```ts
// intentionally illustrative pseudocode

type WorkspaceContextInput = Readonly<{
  workingDirectory: string
}>

type WorkspaceContextIgnoreReason = Readonly<{
  code: "workspace.unmanaged-project"
  safeDiagnostic: string
}>

type WorkspaceContextFailure = Readonly<{
  code:
    | "workspace.invalid-working-directory"
    | "workspace.missing-working-directory"
    | "workspace.inaccessible-working-directory"
  safeDiagnostic: string
}>

type WorkspaceContextResolution =
  | Readonly<{
      kind: "managed"
      context: WorkspaceContext
    }>
  | Readonly<{
      kind: "unmanaged"
      reason: WorkspaceContextIgnoreReason
    }>
  | Readonly<{
      kind: "failed"
      failure: WorkspaceContextFailure
    }>

class WorkspaceContextService {
  constructor(
    private readonly projectRegistrationRepository:
      ProjectRegistrationRepository
  ) {}

  async resolve(
    input: WorkspaceContextInput
  ): Promise<WorkspaceContextResolution> {
    canonicalWorkingDirectory = canonicalize input.workingDirectory with the
      runtime filesystem

    IF input is invalid, does not exist, is not a directory, or is inaccessible
      return failed with the matching safe working-directory diagnostic

    registrations =
      await projectRegistrationRepository.listRegistrations()

    matchingProjects = registrations whose rootPath:
      equals canonicalWorkingDirectory
      OR is a directory-boundary ancestor of canonicalWorkingDirectory

    IF matchingProjects is empty
      return unmanaged with code "workspace.unmanaged-project"

    project = matching Project with the most specific rootPath
    repositoryBranch = absent

    IF project.repositoryRootPath is present
      observe the active Git branch for project.repositoryRootPath

      IF Git reports one active branch
        repositoryBranch = {
          kind: "active",
          name: reported branch name
        }
      ELSE
        repositoryBranch = {
          kind: "unavailable",
          safeDiagnostic: safe branch diagnostic
        }

    return {
      kind: "managed",
      context: {
        project,
        workingDirectory: canonicalWorkingDirectory,
        repositoryBranch
      }
    }
  }
}
```

## Resolution boundary

The caller supplies the working directory. The service canonicalizes it and
matches canonical Project roots by directory boundaries, not string prefixes.
When registered roots overlap, the most specific root owns the invocation.

A valid directory outside every registered Project is unmanaged. Invalid,
missing, non-directory, or inaccessible input is a failed resolution. A
`ProjectRegistrationRepository` read failure remains an infrastructure failure
for Application to report safely; it does not become unmanaged activity.

## Repository branch boundary

The registered `repositoryRootPath` identifies the repository whose active
branch is observed. When no repository root is registered,
`WorkspaceContext.repositoryBranch` is absent.

Git failure, detached state, or an unavailable active branch produces
`repositoryBranch.kind = "unavailable"`. These conditions do not invalidate the
resolved Project.

Git observation describes the current invocation. It does not mutate durable
Project state, discover another repository, or correlate linked worktrees.

## Ownership boundary

`WorkspaceContextService` owns filesystem canonicalization, Project-scope
matching, branch observation, and `WorkspaceContext` construction. It does not
own registration persistence, Project mutation, Session state, evidence state,
provider-session identity, or durable-memory selection.

This unit exposes only `resolve(WorkspaceContextInput)`. Project-key resolution
for targeted insertion belongs to its separate insertion boundary.

## Established design sources

- [`WorkspaceContext`](../../workspace-context.md)
- [`ProjectRegistrationRepository`](../storage/sqlite/repositories/project-registration.repository.ts.md)
