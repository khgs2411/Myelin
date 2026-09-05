# `src/workspace/workspace-context.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/workspace/workspace-context.ts`

```ts
type WorkspaceContext = Readonly<{
  project: ProjectRegistration
  workingDirectory: CanonicalDirectoryPath
  git?: GitContext
}>

type GitContext =
  | Readonly<{
      kind: "observed"
      branchName: string | null
      headCommitId: string | null
      upstream: Readonly<{
        reference: string
        commitId: string | null
      }> | null
    }>
  | Readonly<{
      kind: "unavailable"
      safeDiagnostic: string
    }>
```

The canonical working directory supplies workspace context within its registered
Project. There is no separate Workspace entity or duplicate workspace field.
The registration supplies the Project root and optional repository root.

| Value | Meaning |
| --- | --- |
| No `git` | The registered Project has no Git repository |
| `kind: "unavailable"` | Git observation could not be obtained; the Project remains managed |
| Null `branchName` | Detached HEAD |
| Null `headCommitId` | No commit yet |
| Null `upstream` | No configured tracking reference |
| Null `upstream.commitId` | Tracking reference is configured but has no locally available commit |

WorkspaceContextService owns observation. It uses the branch's configured
upstream, including its reference (for example `origin/feature-a`), for the
remote-tracking commit. It reads local Git state without fetching. The stored
commit does not claim to be the remote server's current commit.

Git is optional. Every Git value describes state observed during capture, not
proven native event-time state. Source-supplied branch data stays separate.
The snapshot is passive and immutable; exact replay preserves the original.
File statuses, diffs, and untracked files are outside this context.

The implementation now uses this approved shape in place of
`repositoryBranch?: GitBranchContext`. Existing captured snapshots remain
unchanged; new evidence stores `git`.
