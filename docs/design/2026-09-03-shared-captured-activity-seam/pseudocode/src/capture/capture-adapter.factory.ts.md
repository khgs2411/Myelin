# `src/capture/capture-adapter.factory.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/capture-adapter.factory.ts`

`CaptureAdapterFactory` is the only owner of capture-adapter selection.

```ts
type CaptureSourceKey = "codex.hook" | "development.fixture" | string

class CaptureAdapterFactory {
  constructor(
    private readonly adapters: ReadonlyMap<CaptureSourceKey, CaptureAdapter>
  ) {}

  create(sourceKey: CaptureSourceKey): CaptureAdapter {
    adapter = adapters.get(sourceKey)
    require adapter exists
    return adapter
  }
}
```

Application composition registers `codex.hook` with `CodexCaptureAdapter` and
`development.fixture` with `DevelopmentCaptureAdapter`. Adding Claude adds
`ClaudeCaptureAdapter` and one registration. It does not change this class or
add a branch to `EvidenceCaptureService` or `EvidenceItemService`.

The source key comes from trusted application composition. Native input cannot
select its adapter or claim its capture source.
