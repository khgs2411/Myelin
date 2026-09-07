# `src/evidence-ingestion/evidence-ingestion.types.ts`

> Pseudocode artifact. Non-executable reference shape.

Approved by the user on 2026-09-07: retain IPreparedEvidenceItem, add speakerRole,
and place the type with the existing ingestion contracts. This replaces its
placement beside the superseded IEvidenceAdapter interface.

```typescript
// Addition to the existing ingestion contracts file.
export interface IPreparedEvidenceItem {
  readonly evidenceId: number;
  readonly content: string;
  readonly speakerRole: "user" | "assistant" | null;
  readonly nativeEventKind: string;
  readonly nativeSessionReference: string | null;
  readonly nativeInteractionReference: string | null;
  readonly nativeOccurredAt: string | null;
}

// Existing ICuratorExecutor.Execute continues to accept:
// preparedEvidence: readonly IPreparedEvidenceItem[]
// Its configuration and untrusted return contract remain unchanged.
```

EvidenceIngestionService constructs one prepared value per claimed row in the
same order. It copies stored content and metadata without interpretation.
EvidenceManager's admission rule establishes non-whitespace content for this
development flow. Missing attribution, references, and source time remain null.

The curator receives these values, not SQLite model objects. evidenceId provides
the identity used to support memory drafts. speakerRole identifies the source
speaker; it does not determine whether a statement is true or accepted.

No new mapping class or service is introduced. Existing ingestion request,
result, executor, and curator-result contracts remain in this file.
