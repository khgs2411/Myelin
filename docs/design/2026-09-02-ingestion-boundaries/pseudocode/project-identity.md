# Project Identity Boundary

> Pseudocode artifact. Non-executable reference shape.

This boundary separates the stable project key used by callers from the SQLite
identity used by internal relations.

```ts
// intentionally illustrative pseudocode

type ProjectKey = opaque application-generated identifier
type ProjectIdentity = positive integer assigned by SQLite

type ProjectRegistration = Readonly<{
  identity: ProjectIdentity
  key: ProjectKey
  rootPath: CanonicalDirectoryPath
  repositoryRootPath?: CanonicalDirectoryPath
}>

type ProjectBootstrapResult = Readonly<{
  projectKey: ProjectKey
  rootPath: CanonicalDirectoryPath
  repositoryRootPath?: CanonicalDirectoryPath
  disposition: "created" | "already-registered"
}>

type ProjectResolution =
  | Readonly<{
      kind: "resolved"
      project: ProjectRegistration
    }>
  | Readonly<{
      kind: "unknown"
      safeDiagnostic: string
    }>

PROJECT_BOOTSTRAP
  create one ProjectKey when a project is first registered
  return the same key when bootstrap finds that registration again
  never return ProjectIdentity as the caller's project selector

PROJECT_RESOLUTION
  accept one ProjectKey from a CLI, MCP, function, or development-tool request
  resolve it to one current ProjectRegistration
  reject an unknown key without path fallback or implicit bootstrap

PROJECT_RELOCATION
  replace rootPath and repositoryRootPath when authorized
  preserve ProjectKey and ProjectIdentity
```

`ProjectKey` is immutable and unique within one application installation. It is
the public project selector returned by bootstrap and accepted by later
operations. It is not an authentication secret and does not grant authority.

`ProjectIdentity` remains private persistence identity. SQLite foreign keys and
project-local sequences continue to use it. A database implementation change
does not change the external project contract.

The exact key encoding and generation mechanism are implementation details as
long as they preserve opacity, stability, and sufficient uniqueness.
