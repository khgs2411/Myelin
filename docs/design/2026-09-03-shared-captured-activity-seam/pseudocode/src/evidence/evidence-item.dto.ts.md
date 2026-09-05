# `src/evidence/evidence-item.dto.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/evidence/evidence-item.dto.ts`

`EvidenceItemDto` is the complete immutable input to evidence persistence. It
exists after adapter normalization and workspace resolution.

```ts
type EvidenceItemDto = Readonly<{
  captureSourceKey: CaptureSourceKey
  workspaceContext: WorkspaceContext
  nativeEventKind: string
  nativeSessionReference?: string
  nativeInteractionReference?: string
  nativeOccurredAt?: NormalizedTimestamp
  normalizedContent: string | null
  replay: Readonly<{
    scheme: string
    key: string
  }>
  sourceMaterial: NativeSourceMaterial
}>
```

The DTO contains no SQLite identity, project-local sequence, or receipt time.
`EvidenceItemRepository` assigns those persistence facts.
