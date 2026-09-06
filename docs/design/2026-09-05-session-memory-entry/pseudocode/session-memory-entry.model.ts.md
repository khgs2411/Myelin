# Session Memory Entry Contract

> Pseudocode artifact. Non-executable reference shape.

Owner: Session Memory. Application services use the concrete Sequelize model
directly. There is no separate entry interface or read-mapping DTO.
The initialized model exists in
[SessionMemoryEntry](../../../../src/storage/sqlite/models/session-memory-entry.model.ts).
The model uses relational evidence links; this sketch omits Sequelize configuration.

Authority: [project context](../../../../CONTEXT.md) and the accepted entry
dimensions discussed during this unit. Open representations remain in
[Open Design Issues](../design-issues.md).

## Model Shape

```ts
class SessionMemoryEntry extends Model {
  // Accepted: application-assigned numeric identity, allocated at persistence.
  // The curator does not supply it. Retirement and supersession preserve it.
  public declare id: number;

  // One owning Project; matches the persisted evidence Project identity.
  public declare projectId: number;

  // Accepted: non-empty text; no separate title or summary.
  // One coherent recent-work fact, with context needed to continue correctly.
  // Preserve material uncertainty, evidence limits, and contradictions in text.
  // A source claim must remain identifiable as a claim.
  // The only entry field used for semantic/vector search through sqlite-vec.
  public declare content: string;

  // Accepted: a non-empty collection of persisted EvidenceItem.id values.
  // Every referenced item belongs to this entry's Project.
  // Original evidence supports this entry; another memory is not its evidence.
  // A loaded association, not a SQLite array column or creation attribute.
  public declare evidence?: NonAttribute<EvidenceItem[]>;

  // Accepted: time of the most recent observation that supports this fact.
  // Memory creation or a newer mention alone does not refresh this time.
  // UTC timestamp in ISO 8601 format.
  // null when the most recent supporting observation's time is unknown.
  public declare observedAt: string | null;

  // Entry fields remain immutable after persistence.
  // Mutable lifecycle belongs to the separate SessionMemoryLifecycle model.
}
```

## Content And Search

`content` alone represents the memory's textual meaning. It is non-empty and
contains the context needed to continue correctly. There is no separate title
or summary. The user accepted content as the only entry field used for
semantic/vector search with the existing sqlite-vec capability.

Other fields preserve identity, Project ownership, evidence, and time. They are not
additional semantic/vector search content. This decision does not select
metadata filters, ranking, embedding configuration, or index storage.
Workspace metadata remains outside searchable content. The accepted entry
contract has no `applicability` field. Its evidence IDs provide access to the
original workspace snapshots without duplicating them on the entry.

## Query Direction For Later Design

PROVISIONAL query direction supplied by the user: construct the query's
WorkspaceContext, filter evidence_items by relevant workspace properties, and
join the matching evidence to Session entries through evidence IDs. Semantic/
vector search uses entry content within the resulting scope.

Exact matching rules belong to Step 4 query design. They do not block removal
of `applicability` from this contract. Query design can revisit the entry
contract if it establishes a missing requirement.

## Evidence Qualification In Content

The accepted contract has no separate `qualification` field. Content preserves
uncertainty, evidence limits, and contradictions when they change the memory's
meaning. It distinguishes hypotheses and source claims from established
outcomes. Evidence IDs provide access to supporting sources.

This keeps material qualification visible when the content is read or searched.
Accurate attribution alone does not qualify a statement for Session Memory;
the entry must still help a later agent continue the work. This decision
settles entry representation, not the later curator's admission procedure.

## Identity

The application assigns a numeric ID when it persists a validated entry.
Each new entry receives its own ID. Superseding entries and the entries they
supersede retain distinct identities. Retirement does not change identity.
This accepted contract follows the numeric identity convention of EvidenceItem;
identity does not depend on content, subject, or provider session.

## Lifecycle Relationship

The entry can remain active, be re-qualified, be retired, or be superseded.
Those decisions preserve the entry's immutable content. Supersession relates
an older entry to a newer memory. Promotion can justify retirement only after
the destination product accepts and publishes durable memory.

A separate [SessionMemoryLifecycle model](session-memory-lifecycle.model.ts.md)
has one row per entry, linked by entryId. The application updates that row as
lifecycle decisions change. It does not update the entry fields or published evidence membership.

Application services consume Sequelize models directly, without mapping fetched
records to separate interfaces. This does not grant agents direct database
access. Entry immutability must be enforced by persistence; TypeScript field
annotations alone do not enforce it. Migration 3 enforces entry and published evidence-link immutability.

## Evidence And Time Boundary

The curator works from persisted evidence. `EvidenceItemDto` supplies capture
facts before persistence; `EvidenceItem` adds durable identity, Project order,
and receipt time. Entry lineage refers to those durable evidence identities.
Application services use the concrete model records directly.

The curator selects supporting evidence IDs. The application validates the
references before publication. This lineage decision was accepted during the
entry-contract discussion. References preserve access to original content,
workspace snapshots, and source timestamps without copying those facts into
the entry. Several evidence items can support one coherent memory.

`observedAt` means the time of the most recent supporting observation. This
definition was accepted during the entry-contract discussion. For observations
from Monday and Wednesday curated on Friday, it is Wednesday. A newer message
that merely mentions the subject does not refresh the observation time.

`nativeOccurredAt` is optional source event time. `receivedAt` is evidence
receipt time. Source timestamps must correspond to observations supporting the
fact; taking the newest timestamp from all related messages is insufficient.
The accepted representation is a UTC timestamp in ISO 8601 format, or `null`
when the most recent supporting observation's time is unknown. With dated and
undated observations, do not automatically choose the latest known timestamp;
it might describe an earlier observation. Preserve unknown time as `null`.
Do not substitute receipt time. Memory creation time describes a separate
event; adding its field and defining its assignment remain provisional.

## Subject And Workstream Correlation

The accepted entry contract has no subject or workstream identifier. Content
supplies semantic matching, projectId supplies Project ownership, and evidence links
preserve source session, interaction, and workspace context. No separate
workstream entity or identifier assignment process is introduced.

The Memory reviewer determines whether retrieved memories concern the same work.
Provider sessions and branches are not automatically semantic workstreams.
Entries retain independent identities; accepted supersession decisions establish
explicit replacement relationships through the lifecycle model.

No confidence score or automatic age-based retirement rule is selected here.

## Relational Publication Boundary

Evidence references reside in `session_memory_evidence`, with a composite key
of entryId and evidenceId. Loaded `evidence` values are concrete EvidenceItem
models. Consumers can read their IDs directly. An unloaded association is
undefined; it is not an empty evidence collection.

A writer uses one transaction to insert the entry, its same-Project evidence
links, and finally its lifecycle. Creating the lifecycle requires at least one
link and seals membership. A deferred reverse foreign key requires the lifecycle
by commit. Failed construction leaves no partial canonical entry.

The association-only `project` and `lifecycle` properties can also be loaded.
They are excluded from inferred persisted attributes with NonAttribute.
