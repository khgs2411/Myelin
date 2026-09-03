# Fixed Local Project Context — Open Design Issues

Established design context: [Feature Shape](feature-shape.md).

This artifact owns the material unresolved design frontier. When an issue
resolves, its accepted result moves into the controlling Feature Shape or
pseudocode artifact, and the issue is removed in the same authorized update.

## Issue Index

| Issue | Status | Provisional candidates |
| --- | --- | --- |
| [Project registration read contract](#project-registration-read-contract) | `OPEN` | none |
| [Workspace resolution contract reconciliation](#workspace-resolution-contract-reconciliation) | `OPEN` | none |
| [Application context composition contract](#application-context-composition-contract) | `OPEN` | none |

## Registration Read Boundary

### Project registration read contract

**Evidence:** verified implementation, accepted design, and user requirement

**Exposed by:** `WorkspaceContextService` must resolve a canonical working
directory against durable Project registrations, but no executable
`ProjectRegistrationStore` contract exists.

**Established:**

- `Project` remains the durable registration authority.
- `ProjectRegistrationStore` reads existing registrations only for this unit.
- It returns immutable application facts without exposing a mutable Sequelize
  model.
- `WorkspaceContextService` owns directory-boundary matching and most-specific
  Project selection.
- Normal invocation never creates, updates, relocates, or repairs a Project.

**Unresolved:** Which exact store representation and read operation provide the
registered Project facts required for deterministic matching?

**Time to address:** Before `WorkspaceContextService` can receive registered
Project facts without accessing Sequelize directly.

## Workspace Resolution Boundary

### Workspace resolution contract reconciliation

**Evidence:** accepted design and user requirement

**Exposed by:** The
[inherited workspace-service pseudocode](pseudocode/src/workspace/workspace-context.service.ts.md)
defines the earlier flat `WorkspaceContext`, retains a project-root resolution
operation, and does not include the public Project key. The unified shape now
establishes a nested context built from an existing registration and the
invocation working directory.

**Established:**

- `WorkspaceContextService` owns path canonicalization, registration matching,
  branch observation, and `WorkspaceContext` construction.
- The local CLI supplies a working directory.
- The service returns managed, unmanaged, or failed resolution without durable
  mutation.
- A branch-observation failure does not invalidate a managed Project context.

**Unresolved:** Which exact input, result, and dependency contract replaces the
stale portions of the inherited service pseudocode for this unit?

**Time to address:** Before the service pseudocode can control implementation.

## Application Composition Boundary

### Application context composition contract

**Evidence:** verified implementation, accepted design, and user requirement

**Exposed by:** The implemented `Application` owns only database lifecycle. Its
[inherited pseudocode](pseudocode/src/application.ts.md) creates or loads a
fixed Project and initializes Session state, which conflicts with the accepted
read-only resolution boundary.

**Established:**

- Each CLI invocation creates one `Application` and closes it after one
  operation.
- `Application` opens the existing local database and resolves the invocation
  working directory through `WorkspaceContextService`.
- It makes one immutable `WorkspaceContext` available to the project-scoped
  operation.
- It never seeds, registers, updates, repairs, or relocates a Project.
- Session and evidence state remain outside this unit.

**Unresolved:** Which exact `Application.create` input and public context-access
contract bind the CLI working directory to one resolved `WorkspaceContext`?

**Time to address:** Before Application can compose and expose the fixed local
project context.
