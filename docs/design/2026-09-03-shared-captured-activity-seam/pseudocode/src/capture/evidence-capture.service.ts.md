# `src/capture/evidence-capture.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/evidence-capture.service.ts`

`EvidenceCaptureService` converts normalized capture results into contextual
evidence DTOs. It does not parse native input or write SQLite.

```ts
type CaptureBatchInput = Readonly<{
  sourceKey: CaptureSourceKey
    // trusted route identity from Application composition
  results: ReadonlyNonEmptyArray<CaptureResult>
}>

class EvidenceCaptureService {
  constructor(
    private readonly workspaceContextService: WorkspaceContextService,
    private readonly evidenceItemService: EvidenceItemService
  ) {}

  async captureBatch(
    input: CaptureBatchInput
  ): Promise<ReadonlyArray<CapturedEvidenceReference>> {
    require a trusted sourceKey
    require a non-empty ordered result array

    items = input.results map in order:
      workspaceContext = await workspaceContextService.resolve(
        result.workingDirectory
      )
      require workspaceContext identifies a registered Project

      EvidenceItemDto {
        captureSourceKey: input.sourceKey,
        workspaceContext,
        nativeEventKind: result.nativeEventKind,
        nativeSessionReference: result.nativeSessionReference,
        nativeInteractionReference: result.nativeInteractionReference,
        nativeOccurredAt: result.nativeOccurredAt,
        normalizedContent: result.normalizedContent,
        replay: result.replay,
        sourceMaterial: result.sourceMaterial
      }

    require all items belong to one Project

    return evidenceItemService.insertBatch(items)
  }
}
```

All context resolution finishes before persistence begins. A failure produces
no rows. The service does not select an adapter, parse source input, read
captured evidence, retry capture, or invoke memory processing.
