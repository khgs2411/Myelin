# Session Memory Entry — Design Unit

Closed by the user on 2026-09-06. This unit established the first item in Roadmap Step 3:
[Establish the Session Memory entry contract](../../../ROADMAP.md#roadmap-step-3-create-session-memory-from-accepted-evidence).

The subsequent relationship work also delivered durable entry storage. Query
workspace matching and promotion publication references remain explicitly
deferred to their owning capabilities. The next selected roadmap item is
Session evidence consumption and progress.

## Read And Continue Here

- [Feature Shape](feature-shape.md): established owners and boundaries.
- [Open Design Issues](design-issues.md): unresolved entry-contract decisions.
- [Entry model pseudocode](pseudocode/session-memory-entry.model.ts.md): provisional
  contract for discussion.
- [Lifecycle model pseudocode](pseudocode/session-memory-lifecycle.model.ts.md):
  mutable lifecycle record linked to the immutable entry.
- [Project context](../../../CONTEXT.md): settled language and user decisions.
- [Previous consolidated unit](../2026-09-03-shared-captured-activity-seam/README.md):
  capture design and historical product context.

## Scope And Authority

Define one immutable Session entry's meaning, durable identity, applicability,
evidence lineage, uncertainty, and lifecycle relationship. The baseline comes
from explicit user decisions recorded on 2026-09-05 in CONTEXT.md. Source code
establishes capture and relational storage behavior. Agentic Session curation
is not implemented.

The two agent responsibilities constrain this contract. Their prompts,
execution, review retrieval, consumption progress, publication transactions,
and scheduling belong to later work. This unit does not implement storage or
select those mechanisms. Promotion remains subject to destination publication.

This unit replaces the previous unit as the active design location for the
entry contract. Its issues take over entry validity, identity, applicability,
lineage, and immutable lifecycle questions. The previous issue list remains a
historical source for later work; it does not create a competing entry contract.

Develop one selected boundary at a time. Keep established macro design in the
Feature Shape and unresolved decisions in Open Design Issues. Add detailed
contract artifacts when decisions establish their content. No implementation
approval follows from starting this unit.

## Entry Contract Review — 2026-09-06

The two model sketches reflect the accepted entry-contract decisions:

- Immutable entry: numeric identity, Project identity, non-empty content,
  non-empty same-Project evidence references, and nullable observation time.
- Separate mutable lifecycle: one row per entry, active or retired state,
  a flat retirement reason, and a conditional superseding-entry reference.
- Application services use concrete Sequelize models directly.
- Content alone supplies semantic/vector search and preserves material
  uncertainty. Source workspace context remains accessible through evidence.

The user deferred query workspace matching and the promotion publication
reference. Both remain in Open Design Issues. Promotion-based retirement must
remain unavailable until confirmed publication can be referenced and validated.

This was a consistency review against the conversation and current artifacts,
not an independent review or runtime verification. Evidence-link storage,
Sequelize configuration, and enforcement of persistence invariants belong to
the next storage item.

## Implemented Relational Storage — 2026-09-06

The initialized concrete Sequelize models are
[SessionMemoryEntry](../../../src/storage/sqlite/models/session-memory-entry.model.ts),
[SessionMemoryEvidence](../../../src/storage/sqlite/models/session-memory-evidence.model.ts),
and [SessionMemoryLifecycle](../../../src/storage/sqlite/models/session-memory-lifecycle.model.ts).
[Migration 3](../../../src/storage/sqlite/sqlite-schema.ts) adds their tables,
foreign keys, join indexes, and integrity constraints without rewriting the
previous migrations or captured evidence.

Project has many evidence items and Session entries. Session entries have many
EvidenceItems through immutable link rows and one separate mutable lifecycle.
Lifecycle supersession references another entry in the same Project. Sequelize
associations support eager loading in both directions. The former evidenceIds
array is represented by link records and a loaded evidence association.

Within one transaction, a writer inserts the entry, its evidence links, then its
lifecycle. The lifecycle requires evidence and seals membership. A deferred
foreign key requires a lifecycle by commit. SQL rejects cross-Project links,
invalid supersession, duplicate links, unsupported promotion, and updates or
replacement of immutable entries and evidence. The publication API and curator
remain later work.

Type-checking and isolated integration checks covered real capture and replay,
ORM joins, raw-SQL constraint failures, rollback, restart, and upgrades from
migration 1 and migration 2 while preserving existing data. No unit tests ran.
The development database was inspected and copied for upgrade verification; it
was not migrated. Application startup applies the new migration when next used.
