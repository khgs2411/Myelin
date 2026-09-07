# EvidenceAdapterFactory

> Pseudocode artifact. Non-executable reference shape.

Preparation-boundary revision, approved 2026-09-07: the [active unit](../../2026-09-07-stored-development-evidence-preparation/pseudocode/evidence-preparation.md)
supersedes source-specific preparation adapters and factory selection below.
Capture supplies normalized evidence; ingestion constructs prepared input directly.
The prepared-input contract and other ingestion behavior remain in force.

Accepted name and contract. Proposed filename: evidence-adapter.factory.ts;
source directory remains undecided.

```typescript
class EvidenceAdapterFactory {
  public Create(captureSourceKey: CaptureSourceKey): IEvidenceAdapter;
}
```

The factory maps supported capture source keys to implementations of
[IEvidenceAdapter](evidence.adapter.ts.md). Unsupported sources raise a clear
error; there is no generic fallback. Agent provider and model configuration do
not participate in this selection.

EvidenceIngestionService resolves the adapter before requesting a claimed batch
from EvidenceManager. Unsupported sources therefore fail without creating leases.

CodexEvidenceAdapter is the accepted intended Codex implementation. This artifact
does not invent its exact capture source key or native payload handling. Concrete
registrations must use established capture source identities when implemented.
No runtime adapter or factory is implemented here.
