# Session Memory Lifecycle Model

> Pseudocode artifact. Non-executable reference shape.

Owner: Session Memory. Separate lifecycle storage and direct use of concrete
Sequelize models are accepted user decisions. The initialized model exists in
[SessionMemoryLifecycle](../../../../src/storage/sqlite/models/session-memory-lifecycle.model.ts).
Sequelize configuration is omitted from this sketch.

## Model Shape

```ts
class SessionMemoryLifecycle extends Model {
  // One lifecycle row per immutable SessionMemoryEntry.
  public declare entryId: number;
  public declare state: "active" | "retired";
  public declare reason: "superseded" | "irrelevant" | "promoted" | null;
  public declare supersededByEntryId: number | null;

  // OPEN, deferred: confirmed destination publication reference.
  // The promoted transition is unavailable until this reference can be validated.
}
```

## Accepted Contract

- `entryId` links the lifecycle row to its immutable entry.
- The application can update this row. Entry content and identity do not change.
- Active rows have null `reason` and null `supersededByEntryId`.
- Retired rows require a reason.
- Reason `superseded` requires `supersededByEntryId`; other reasons require null.
- Promotion-based retirement requires confirmed durable publication, not merely
  a candidate. Its reference remains in [Open Design Issues](../design-issues.md#promotion-publication-reference).
  The user deferred that contract. The `promoted` reason describes intended
  behavior; it must not be admitted until the publication reference is supported
  and validated.
- Application services use this model directly. No separate lifecycle interface,
  nested retirement object, or redundant retirement boolean is required.

This model represents current lifecycle state. Migration 3 uses entryId as its
primary key and foreign key. The superseding-entry foreign key must reference
a different entry in the same Project. SQL constraints reject invalid state/
reason/target combinations and reject promoted retirement until its deferred
publication reference is available.

The entry and its non-empty evidence links are inserted before the lifecycle,
within one transaction. Lifecycle identity cannot change or be deleted.
No decision-history log is introduced.
