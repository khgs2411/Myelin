# `src/workspace/workspace-context.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/workspace/workspace-context.service.ts`

`WorkspaceContextService` determines whether one normalized provider activity
belongs to a project our app oversees. For managed activity it attaches the
registered project and repository identity plus the active Git branch when one
is available. It does not discover projects, persist registrations, perform
agentic interpretation, or curate memory.

```ts
// intentionally illustrative pseudocode

type WorkspaceContextInput = Readonly<{
  workingDirectory: string
}>

type ProjectIdentity = Readonly<{
  value: string
}>

type RepositoryIdentity = Readonly<{
  value: string
}>

type CanonicalDirectoryPath = absolute, filesystem-normalized real path

type OverseenProject = Readonly<{
  projectIdentity: ProjectIdentity
  rootPath: CanonicalDirectoryPath
  repository?: Readonly<{
    reference: RepositoryIdentity
    location: CanonicalDirectoryPath
  }>
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

type WorkspaceRepositoryContext = Readonly<{
  reference: RepositoryIdentity
  location: CanonicalDirectoryPath
  branch: GitBranchContext
}>

type WorkspaceContext = Readonly<{
  projectReference: ProjectIdentity
  projectRoot: CanonicalDirectoryPath
  workingDirectory: CanonicalDirectoryPath
  repository?: WorkspaceRepositoryContext
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
  async resolve(
    input: WorkspaceContextInput
  ): Promise<WorkspaceContextResolution> {
    validate and canonicalize input.workingDirectory

    IF the working directory is invalid, missing, or inaccessible
      return failed with a safe workspace diagnostic

    consult durable overseen-project registrations

    IF no registered root contains canonical working directory
      return unmanaged("workspace.unmanaged-project")

    project = most specific registered root containing canonical working directory
    repository context = absent

    IF project has registered repository information
      read the active Git branch by running Git with:
        working directory = canonical working directory

      repository context = project repository reference and location plus:
        active branch when Git succeeds
        unavailable branch context with a safe diagnostic when Git fails

    return managed WorkspaceContext using:
      project.projectIdentity
      project.rootPath
      canonical working directory
      repository context when present
  }
}
```

## Ownership boundary

The service owns deterministic registration matching and active-branch
observation for the matched project. It matches canonical paths by directory
boundaries rather than string prefixes. When registered roots overlap, the
most specific root owns the activity.

Project registration supplies identity and oversight scope before capture. The
service never creates a project from hook activity. Git tooling describes the
active branch but does not recreate repository identity or expand the exact
bootstrapped root. Git commands receive the canonical activity directory
explicitly; the application does not change its process-wide working directory.

The provider-supplied working directory is the only capture coordinate used to
select a project. A valid directory outside every registered root is expected
unmanaged activity and is ignored without persistence. An invalid, missing, or
inaccessible directory is a workspace failure rather than unmanaged activity.

A bootstrapped non-Git folder produces a managed context without a `repository`
value. Its evidence remains project-scoped. If registered Git information
exists but branch inspection fails, the managed context records an unavailable
branch and capture may continue.

It does not own the provider-session reference. The capture adapter supplies
that reference as part of the normalized observation. `EvidenceCaptureService` combines
the observation and `WorkspaceContext` when it constructs evidence.

The service does not inspect source state, decide whether separate sessions
represent the same semantic workstream, retain unmanaged activity, or curate
memory. Version one does not discover or correlate linked Git worktrees.

## Open shape

The durable project-registration owner, repository-identity matching across
clones and forks, and relocation operation remain unresolved. These details
will extend this artifact when they are designed.
