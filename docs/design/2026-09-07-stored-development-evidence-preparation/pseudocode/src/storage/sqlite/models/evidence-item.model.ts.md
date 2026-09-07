# `src/storage/sqlite/models/evidence-item.model.ts`

> Pseudocode artifact. Non-executable reference shape.

Focused addition to the existing EvidenceItem entity. Accepted design:
speakerRole identifies the source speaker and permits `user`, `assistant`, or
null when attribution is unknown. It is immutable evidence metadata.

```typescript
class EvidenceItem extends Model<...existing model parameters...> {
  // Existing fields remain.
  public declare speakerRole: "user" | "assistant" | null;
}

// Within the existing model attribute definition:
speakerRole: {
  type: DataTypes.TEXT,
  allowNull: true,
  columnName: "speaker_role",
}
```

The existing schema owner, `src/storage/sqlite/sqlite-schema.ts`, must represent
this nullable field on evidence_items through its migration mechanism. Existing
rows have unknown attribution; do not infer a role from their text or rewrite
raw source material. This artifact defines the entity field, not migration SQL.

EvidenceItemRepository copies EvidenceItemDto.speakerRole into this field during
its existing batch insertion. It does not derive roles. EvidenceIngestionService
copies the stored value into IPreparedEvidenceItem.speakerRole.

The role is not a statement approval flag or a trust score. Existing source
identity, replay coordinates, native event kind, and immutability remain intact.
