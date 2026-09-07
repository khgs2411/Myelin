# `src/evidence/evidence-manager.ts`

> Pseudocode artifact. Non-executable reference shape.

Focused extension to the existing insertion method. The admission owner and
skip behavior were selected by the user on 2026-09-07. This incremental sketch
does not replace the parent unit's selection and lease design.

```typescript
class EvidenceManager {
  public async InsertBatch(
    items: readonly EvidenceItemDto[],
  ): Promise<readonly CapturedEvidenceReference[]> {
    // Keep items whose normalizedContent contains non-whitespace text.
    // Skip null, empty, and whitespace-only values.
    // Preserve retained DTOs, content, and relative input order exactly.

    // If no items remain, return [] without calling the repository.
    // Otherwise delegate the retained batch to evidenceItemRepository.insertBatch.
    // Return its durable references; skipped items have no receipt.
  }

  // Existing lowercase insertBatch entry delegates to InsertBatch.
}
```

The shared manager applies the same rule to every capture source. It checks
normalizedContent; a non-empty serialized source payload does not substitute
for missing normalized text. It does not insert placeholder content.

The repository still owns atomic insertion, replay checks, and sequence
allocation for retained items. Its existing non-empty batch requirement is
preserved by the manager's empty-result branch.

Capture adapter validation and workspace resolution precede this method in the
current flow. This addition does not bypass those checks or turn other capture
failures into skipped items. An empty original capture request remains subject
to the existing input validation.

The user confirmed that the development fixture has not inserted evidence.
This design therefore needs no legacy contentless-row handling. The admission
rule establishes non-whitespace content for retained fixture evidence.
