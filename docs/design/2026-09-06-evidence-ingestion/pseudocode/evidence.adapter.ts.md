# Evidence adapter

> Pseudocode artifact. Non-executable reference shape.

Accepted interface: IEvidenceAdapter. Proposed filename:
evidence.adapter.ts; source directory remains undecided.

```typescript
interface IPreparedEvidenceItem {
  readonly evidenceId: number;
  readonly content: string;
  readonly nativeEventKind: string;
  readonly nativeSessionReference: string | null;
  readonly nativeInteractionReference: string | null;
  readonly nativeOccurredAt: string | null;
}

interface IEvidenceAdapter {
  Prepare(evidence: readonly EvidenceItem[]): readonly IPreparedEvidenceItem[];
}
```

EvidenceIngestionService selects the source preparation adapter using
captureSourceKey, then passes the claimed batch's evidence array in its existing
projectSequence order. EvidenceItem is the existing concrete SQLite model.

The adapter interprets native source material and prepares curator input. It
preserves evidence IDs, source attribution, and available session/interaction
relationships. It does not need attempt identity or lease data, and does not
select or invoke the execution provider. EvidenceManager retains lease ownership.

## Prepared Output

Return one prepared item per input EvidenceItem, preserving input order and
evidence identity. Content renders native source material into readable text
for the curator while preserving meaning, speaker attribution, and relevant
uncertainty. Preparation does not curate or summarize away evidence.

Preserve nativeEventKind and available session/interaction references and source
timestamps. Missing references or timestamps remain null. Do not replace a
missing source timestamp with receipt time.

Ingestion already knows captureSourceKey; do not repeat it on each prepared
item. Original bytes and workspace snapshots remain accessible through
evidenceId. The common output lets execution adapters consume curator input
without decoding provider-native payloads.

Source preparation and configured agent execution remain independent.
[EvidenceAdapterFactory](evidence-adapter.factory.ts.md) selects the adapter.
CodexEvidenceAdapter is the accepted intended Codex implementation; its native
format handling is not designed in this artifact.
