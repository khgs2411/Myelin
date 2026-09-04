# `src/capture/evidence-capture.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/evidence-capture.service.ts`

`EvidenceCaptureService` coordinates one provider-contract activity from
adapter normalization through workspace resolution and shared ingestion.

```ts
type CaptureInvocationContext = Readonly<{
  sourceIdentity: EvidenceSourceIdentity
    // trusted route identity bound by Application composition
}>

type CaptureInput = Readonly<{
  nativeActivity: ProviderNativeActivity
}>

type CaptureResult =
  | Readonly<{
      kind: "accepted"
      acceptance: EvidenceAcceptanceReceipt
    }>
  | Readonly<{
      kind: "ignored"
      reason: CaptureIgnoreReason | WorkspaceContextIgnoreReason
    }>

class EvidenceCaptureService {
  constructor(
    private readonly invocationContext: CaptureInvocationContext,
    private readonly adapter: CaptureAdapter,
    private readonly workspaceContextService: WorkspaceContextService,
    private readonly capturedEvidenceIngestion: CapturedEvidenceIngestionService
  ) {}

  async capture(input: CaptureInput): Promise<CaptureResult> {
    normalization = adapter.normalize(input.nativeActivity)

    IF normalization.kind is "rejected"
      fail with normalization.failure

    IF normalization.kind is "ignored"
      return ignored(normalization.reason)

    observation = normalization.observation

    resolution = await workspaceContextService.resolve({
      workingDirectory: observation.workingDirectory
    })

    IF resolution.kind is "failed"
      fail with resolution.failure

    IF resolution.kind is "unmanaged"
      return ignored(resolution.reason)

    acceptance = await capturedEvidenceIngestion.ingest({
      sourceIdentity: invocationContext.sourceIdentity,
      observation,
      workspaceContext: resolution.context
    })

    return accepted(acceptance)
  }
}
```

Application composition creates two truthful route configurations:

```text
automatic Codex invocation -> sourceIdentity "codex.hook"
controlled fixture         -> sourceIdentity "development.fixture"
```

Both configurations use `CodexCaptureAdapter`. The payload cannot override the
route identity. This service does not parse Codex fields, construct candidates,
persist evidence directly, or execute Session curation.
