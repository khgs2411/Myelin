# Session Memory Entry — Feature Shape

This unit maps the accepted ownership of immutable recent-work memory and its
lifecycle. It covers the first item in Roadmap Step 3.

Open design frontier: [Open Design Issues](design-issues.md).

## Feature Map

```text
captured evidence
  -> [Evidence curator] : proposes new coherent recent-work entries
      -> [Session Memory] : immutable entry table in SQLite
          -> evidence linking table -> original EvidenceItem rows
          -> Project foreign key

new memories + existing memories retrieved through content-only semantic/vector search
  -> [Memory reviewer] : re-qualification, retirement, supersession, promotion proposals
      -> [Session Memory] : separate mutable lifecycle table, one row per entry
      -> durable-product candidates

successful destination publication
  -> permits promotion-based Session retirement

[Evidence curator] -X-> existing-memory lifecycle decisions
[Evidence curator] -X-> direct canonical storage writes
[Memory reviewer] -X-> direct canonical storage writes
```

Evidence for the map: accepted design in [project context](../../../CONTEXT.md)
and application-owned validation in the [product overview](../../../README.md).
The map shows responsibility and data relationships, not a transaction sequence.

## Design Item Catalog

| Owner | Representation |
| --- | --- |
| [Session Memory](#session-memory) | semantic |
| [Evidence curator](#evidence-curator) | semantic |
| [Memory reviewer](#memory-reviewer) | semantic |

## New Or Revised Files Or Owners

### Session Memory

**Representation:** semantic product owner; canonical entries reside in SQLite.

**Evidence:** user decisions recorded in [project context](../../../CONTEXT.md);
accepted product scope in [README.md](../../../README.md#memory-products).

Owns immutable entries containing one coherent fact needed for recent-work
continuity, with supporting context and original evidence links. It owns
applicability and active lifecycle. Retirement and supersession do not rewrite
entry content. Its active set is short-lived and normally below 100 entries;
this is not a hard limit. Promotion justifies retirement only after the
destination accepts and publishes durable memory.

Application services use concrete Sequelize entry and lifecycle models directly.
No separate read interfaces or mapping DTOs intervene. The entry table is
immutable; the lifecycle table holds one mutable row per entry, linked by
`entryId`. State, reason, and superseding-entry reference are top-level lifecycle
fields. Evidence: accepted user decisions in the
[entry model](pseudocode/session-memory-entry.model.ts.md) and
[lifecycle model](pseudocode/session-memory-lifecycle.model.ts.md).

Verified implementation: initialized relational models exist in
[SessionMemoryEntry](../../../src/storage/sqlite/models/session-memory-entry.model.ts)
and [SessionMemoryLifecycle](../../../src/storage/sqlite/models/session-memory-lifecycle.model.ts).
Evidence membership is stored by
[SessionMemoryEvidence](../../../src/storage/sqlite/models/session-memory-evidence.model.ts).
[Migration 3](../../../src/storage/sqlite/sqlite-schema.ts) establishes foreign
keys, join indexes, immutable membership, same-Project constraints, and exactly
one lifecycle per committed entry. Application services load related concrete
models through Sequelize associations.

The entry has no `applicability` field. Evidence IDs provide access to original
workspace snapshots; workspace metadata stays outside searchable content.
Evidence: explicit user decision recorded in the
[entry contract](pseudocode/session-memory-entry.model.ts.md#content-and-search).

The entry has one non-empty `content` field and no title or summary. Only
`content` supplies semantic/vector search through sqlite-vec. Evidence: explicit
user decision recorded in the [entry contract](pseudocode/session-memory-entry.model.ts.md#content-and-search).

### Evidence curator

**Representation:** semantic agent responsibility.

**Evidence:** explicit user separation recorded in [project context](../../../CONTEXT.md).

Reviews evidence and curates new Session entries. Its output requires
application validation. Existing-memory lifecycle and promotion decisions
belong to the Memory reviewer.

### Memory reviewer

**Representation:** semantic agent responsibility.

**Evidence:** explicit user separation recorded in [project context](../../../CONTEXT.md).

Compares new memories with retrieved existing memories. Re-qualifies all
retrieved results and proposes retirement, supersession, or durable-memory
candidates. Search provides comparison material; the agent makes the decisions.
Background maintenance can reassess relevance during a work session.

## Admission Rule

Each owner and relationship comes from accepted product boundaries or explicit
user decisions. Relational storage is implemented. Agentic curation and review
remain accepted product responsibilities.
