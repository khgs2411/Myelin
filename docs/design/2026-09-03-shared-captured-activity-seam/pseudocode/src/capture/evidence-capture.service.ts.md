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
  public constructor(
    private readonly workspaceContextService: WorkspaceContextService,
    private readonly evidenceItemRepository: IEvidenceItemRepository
  ) {}

  public async captureBatch(
    input: CaptureBatchInput
  ): Promise<ReadonlyArray<CapturedEvidenceReference>> {
    require a trusted sourceKey
    require a non-empty ordered result array
      otherwise throw ApplicationError("capture:invalid-input")

    items = input.results map in order:
      resolution = await workspaceContextService.resolve({
        workingDirectory: result.workingDirectory
      })
      IF resolution.kind == "failed"
        fail capture with ApplicationError("capture:failed")
      require resolution.kind == "managed"
        otherwise throw ApplicationError("capture:unmanaged-workspace")
      workspaceContext = resolution.context
        // Git state observed during capture, not proven event-time state.

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
      otherwise throw ApplicationError("capture:mixed-project-batch")

    return evidenceItemRepository.insertBatch(items)
  }
}
```

All context resolution finishes before persistence begins. A failure produces
no rows. The service does not select an adapter, parse source input, read
captured evidence, retry capture, or invoke memory processing.

Captured Git context describes the state observed during capture, not the
state at the native event time. A delayed event from branch A can therefore
have a capture-time observation of branch B. Any branch supplied by the source
remains separate source data; it does not replace the observed workspace
context. Exact replay returns the existing evidence and preserves its original
workspace snapshot.
