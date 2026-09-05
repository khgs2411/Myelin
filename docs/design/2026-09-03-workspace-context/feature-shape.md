# Workspace Context — Feature Shape

> Historical source record. This unit is retired from active design.
> Continue in the [current consolidated unit](../2026-09-03-shared-captured-activity-seam/README.md).
> Its issue list controls unresolved work; this body preserves prior context.

> Superseded by the
> [unified Fixed Local Project Context unit](../2026-09-03-fixed-local-project-context/feature-shape.md).

Represent one resolved CLI invocation as an immutable project and workspace
value. The context combines identity and location from an existing Project
registration with canonical invocation facts. This unit excludes project
registration, project matching, database access, Session state, evidence state,
and mutation.

## Feature Map

```text
[Project]
  -> (identity, public key, project root, optional repository root)
      -> [WorkspaceContext]

(canonical working directory + optional branch observation)
  -> [WorkspaceContext]
      -> (project-scoped application operations)

[WorkspaceContext] -X-> (Sequelize model | database access | mutable state)
```

## Design Item Catalog

| Design item | Representation |
| --- | --- |
| [WorkspaceContext](#workspacecontext) | semantic: `WorkspaceContext` |
| [Project](#project) | exact: `src/storage/sqlite/models/project.model.ts` |

## New Or Revised Files Or Owners

### WorkspaceContext

**Representation:** semantic: `WorkspaceContext`

**Evidence:** accepted design and user requirement

Owns one immutable application value for a resolved invocation. It groups the
resolved Project identity, public key, and canonical root separately from the
canonical working directory and optional repository context. Repository
context contains the registered repository root and either the observed active
branch or a safe unavailable result.

It is not a persistence model and does not expose database access, mutable ORM
state, Session state, or evidence state.

Detailed design:
[`WorkspaceContext`](pseudocode/workspace-context.md).

## Existing Files Or Owners Relied On

### Project

**Representation:** exact: `src/storage/sqlite/models/project.model.ts`

**Evidence:** verified implementation, accepted design, and user requirement

Owns the durable Project registration that supplies the private SQLite
identity, immutable user-assigned public key, canonical project root, and
optional canonical repository root. Branch state does not belong to the
Project row.

Established baseline:
[Local Project Seed](../2026-09-03-local-project-seed/feature-shape.md).

## Admission Rule

The shape admits the immutable invocation value and the one durable owner that
supplies its registered project facts. Resolution behavior and downstream
consumers remain outside this value-model unit.
