# `src/application.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/application.ts`

Only the capture-related revision to the existing `Application` is shown.

```ts
class Application {
  public static async Create(configuration): Promise<Application> {
    sqliteDatabase = await open existing process-scoped SQLite runtime

    return new Application(sqliteDatabase, configuration)
  }

  public async capture(
    input: TrustedCaptureInput
  ): Promise<ReadonlyArray<CapturedEvidenceReference>> {
    TRY
      require a non-empty nativeInputs array
        otherwise throw ApplicationError("capture:invalid-input")
      captureAdapterFactory = new CaptureAdapterFactory()
      adapter = captureAdapterFactory.create(input.sourceKey)

      captureResults = input.nativeInputs map in order:
        adapter.normalize(nativeInput)

      workspaceContextService = compose existing workspace resolution owner
      evidenceItemRepository = new EvidenceItemRepository(sqliteDatabase)
      evidenceCaptureService = new EvidenceCaptureService(
        workspaceContextService,
        evidenceItemRepository
      )

      return await evidenceCaptureService.captureBatch({
        sourceKey: input.sourceKey,
        results: captureResults
      })
    CATCH cause
      IF cause is ApplicationError with an accepted capture code
        throw cause
      throw new ApplicationError("capture:failed", { cause })
  }
}
```

`Application.Create` opens shared runtime resources only. Each operation
constructs only its required object graph. The factory constructs only the
selected adapter. Query and targeted insertion do not create capture entities.

`Application` knows the factory and the `ICaptureAdapter` contract. It does not
import, construct, or store concrete capture adapters.

`TrustedCaptureInput` contains the entry-established `sourceKey` and a
non-empty ordered `nativeInputs: readonly unknown[]`. The entry owns input
acquisition; Application owns normalization through the selected adapter.
The ordered `CapturedEvidenceReference` array is the capture receipt. The
fixture uses this same operation.

This revises the current implementation's creation-time workspace resolution.
Capture resolves each input directory during the operation. Existing database
initialization, partial-open cleanup, and `close()` remain required.

Capture returns the ordered receipt on success and rejects with an ApplicationError
on failure. The accepted failure meanings are:

| Failure | Meaning |
| --- | --- |
| `capture:unsupported-source` | No adapter exists for the trusted source |
| `capture:invalid-input` | Invalid native input or empty batch |
| `capture:unmanaged-workspace` | A working directory has no managed Project |
| `capture:mixed-project-batch` | Items resolve to different Projects |
| `capture:replay-conflict` | Existing replay identity has different source format or bytes |
| `capture:failed` | Context resolution, digest computation, or persistence fails |

Errors carry safe diagnostics without native content. The local fixture command
reports failure and exits unsuccessfully. It emits a capture receipt only after
successful persistence. Failed batches add no rows or sequence advances.

The CLI owns output and cleanup failures after this operation succeeds. Those
failures do not become capture errors or invalidate the returned receipt.
