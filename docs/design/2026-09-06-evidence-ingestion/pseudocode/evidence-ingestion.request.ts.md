# Evidence ingestion request

> Pseudocode artifact. Non-executable reference shape.

Proposed filename: `evidence-ingestion.request.ts`. Its source directory remains
undecided. The user accepted the two-field request during this design discussion.

```typescript
// CaptureSourceKey is the existing type from src/capture/capture-adapter.ts.
interface IEvidenceIngestionRequest {
  readonly workingDirectory: string;
  readonly captureSourceKey: CaptureSourceKey;
}
```

The CLI and maintenance flow invoke `EvidenceIngestionService` with this request.
The service passes `workingDirectory` to the existing `WorkspaceContextService`
to resolve Project and workspace context. `captureSourceKey` selects the evidence
source and its preparation adapter. It is separate from WorkspaceContext.

The service selects evidence and creates claims internally. Execution provider,
model, and batch size come from [application configuration](application.configuration.ts.md).
The request does not carry those settings or caller-selected evidence IDs.

OPEN: command syntax and threshold input construction remain with their callers.
The service result and workspace matching rules are outside this request slice.
