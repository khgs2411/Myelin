# Current Pseudocode

Status: Draft

This set consolidates current design reference. It is not implementation
approval. [Feature Shape](../feature-shape.md) maps the owners;
[Open Design Issues](../design-issues.md) owns material unresolved decisions.

## Artifact Map

| Artifact | Responsibility |
| --- | --- |
| [Application](src/application.ts.md) | Operation-specific composition and the native-input capture entry |
| [Application error](src/application-error.ts.md) | Shared typed codes, safe messages, and internal causes |
| [Capture adapter contract](src/capture/capture-adapter.ts.md) | Shared source facts and serialized native bytes with a format identifier |
| [Adapter factory](src/capture/capture-adapter.factory.ts.md) | Trusted source selection and concrete construction |
| [Codex adapter](src/providers/codex/codex-capture.adapter.ts.md) | Codex-native input normalization |
| [Development adapter](src/development/development-capture.adapter.ts.md) | Fixture-native input normalization |
| [Fixture flow](development-capture-fixture.md) | Local entry through Application.capture |
| [Capture service](src/capture/evidence-capture.service.ts.md) | Resolve context and construct the ordered DTO batch |
| [Workspace context](src/workspace/workspace-context.ts.md) | Immutable Project, working directory, and optional Git snapshot |
| [Evidence DTO](src/evidence/evidence-item.dto.ts.md) | Immutable pre-persistence input |
| [Evidence repository](src/evidence/evidence-item.repository.ts.md) | Atomic insert, replay, and Project sequence |
| [Evidence model](src/storage/sqlite/models/evidence-item.model.ts.md) | Durable evidence projection |
| [Memory product contracts](product-contracts.md) | Established Session, durable-product, publication, and query boundaries |
| [Targeted insertion](targeted-memory-insertion.md) | Deliberate proposals to one durable product |
| [Durable Inbox](durable-memory-inbox.md) | Shared insertion replay and product-owned candidate persistence |

## Implemented Context

- [ProjectRegistration](../../../../src/project/project-registration.ts) exposes
  identity, user-assigned key, and canonical roots.
- [WorkspaceContext](../../../../src/workspace/workspace-context.ts) is a passive
  immutable value containing the registration, working directory, and optional
  `git` observation with branch, HEAD commit, and configured upstream.
  The implementation follows the approved snapshot shape.
- [WorkspaceContextService](../../../../src/workspace/workspace-context.service.ts)
  accepts a working-directory object and returns managed, unmanaged, or failed.
- [SqliteDatabase](../../../../src/storage/sqlite/sqlite-database.ts) and
  [SqliteSchema](../../../../src/storage/sqlite/sqlite-schema.ts) own the existing
  connection, transaction, and migration contracts.

Application capture pseudocode revises creation-time context binding. It does
not claim that this change or the capture pipeline is already implemented.

## Source Records

The [unit index](../README.md) records historical sources and issue migration.
Older capture DTO names, acceptance ledgers, startup seeding, fixed branch
configuration, and capture-time Session scheduling are not part of this set.
