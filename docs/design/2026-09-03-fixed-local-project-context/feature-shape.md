# Fixed Local Project Context — Feature Shape

Resolve each Application-backed repository-local CLI operation from its working
directory to one existing Project registration and construct an immutable
`WorkspaceContext`. This unit excludes project registration, bootstrap,
relocation, installation, Session state, evidence intake, provider capture,
and linked-worktree correlation.

## Feature Map

```text
(CLI invocation working directory)
  -> [Application]
      -> [SqliteDatabase] : open and close invocation database
      -> [WorkspaceContextService] : resolve working directory
          -> [ProjectRegistrationRepository] : read Project registrations
              -> [Project]
          -> (canonical path and active Git branch observation)
          -> [WorkspaceContext]
      -> (project-scoped application operation with WorkspaceContext)

[Application] -X-> (create | update | repair Project registration)
[WorkspaceContextService] -X-> (persist Project | Session | evidence state)
[WorkspaceContext] -X-> (Sequelize model | database access | mutable state)
```

## Design Item Catalog

| Design item | Representation |
| --- | --- |
| [Application](#application) | exact: `src/application.ts` |
| [ProjectRegistrationRepository](#projectregistrationrepository) | exact: `src/storage/sqlite/repositories/project-registration.repository.ts` |
| [WorkspaceContextService](#workspacecontextservice) | exact: `src/workspace/workspace-context.service.ts` |
| [WorkspaceContext](#workspacecontext) | exact: `src/workspace/workspace-context.ts` |
| [Project](#project) | exact: `src/storage/sqlite/models/project.model.ts` |
| [SqliteDatabase](#sqlitedatabase) | exact: `src/storage/sqlite/sqlite-database.ts` |

## New Or Revised Files Or Owners

### Application

**Representation:** exact: `src/application.ts`

**Evidence:** verified implementation, accepted design, and user requirement

Owns one complete CLI invocation composition. It opens the process-scoped
database, supplies the invocation working directory to
`WorkspaceContextService`, makes the resolved `WorkspaceContext` available to
the project-scoped operation, and closes the database. It retains the context
privately rather than exposing a generic context getter. Normal composition
does not create, update, or repair a Project registration.

Detailed design:
[`Application`](pseudocode/src/application.ts.md).

### ProjectRegistrationRepository

**Representation:** exact:
`src/storage/sqlite/repositories/project-registration.repository.ts`

**Evidence:** verified implementation, accepted design, and user requirement

Owns read access to durable Project registrations for context resolution. It
lists immutable `ProjectRegistration` values and does not expose mutable
Sequelize models. It does not register, relocate, update, or repair Projects
during a normal invocation. Workspace membership and branch observation remain
with `WorkspaceContextService`.

Detailed design:
[`ProjectRegistrationRepository`](pseudocode/src/storage/sqlite/repositories/project-registration.repository.ts.md).

### WorkspaceContextService

**Representation:** exact: `src/workspace/workspace-context.service.ts`

**Evidence:** verified implementation, accepted design, and user requirement

Owns deterministic working-directory resolution. It canonicalizes the supplied
directory, matches it to the most specific registered Project root by directory
boundaries, observes the active Git branch when the Project has a registered
repository root, and constructs `WorkspaceContext`.

A valid directory outside all registered roots is unmanaged. Invalid, missing,
or inaccessible input is a resolution failure. Branch observation failure
produces an unavailable branch result without invalidating the resolved
Project.

Detailed design:
[`WorkspaceContextService`](pseudocode/src/workspace/workspace-context.service.ts.md).

### WorkspaceContext

**Representation:** exact: `src/workspace/workspace-context.ts`

**Evidence:** verified implementation, accepted design, and user requirement

Owns one immutable application value for a resolved invocation. It separates
one immutable `ProjectRegistration` from the canonical working directory and
optional observed repository branch. The registration retains the durable
repository root; `WorkspaceContext` does not duplicate it.

It does not expose database access, mutable ORM state, Session state, or
evidence state.

Detailed design:
[`WorkspaceContext`](pseudocode/workspace-context.md).

## Existing Files Or Owners Relied On

### Project

**Representation:** exact: `src/storage/sqlite/models/project.model.ts`

**Evidence:** verified implementation, accepted design, and user requirement

Owns the durable registration that supplies the private SQLite identity,
immutable user-assigned public key, canonical Project root, and optional
canonical repository root. Branch state does not belong to the Project row.

Established baseline:
[Local Project Seed](../2026-09-03-local-project-seed/feature-shape.md).

### SqliteDatabase

**Representation:** exact: `src/storage/sqlite/sqlite-database.ts`

**Evidence:** verified implementation and accepted design

Owns the process-scoped Sequelize connection, schema establishment, SQLite
capability validation, transaction support, and cleanup boundary used by one
Application invocation.

## Admission Rule

The shape admits the invocation composition owner, resolution owner, durable
registration reader, immutable result value, and the two implemented
persistence owners required to produce one trustworthy local project context.
Later project operations consume this context without acquiring project
resolution or persistence authority.
