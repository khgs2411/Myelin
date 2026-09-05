# `src/capture/capture-adapter.factory.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/capture-adapter.factory.ts`

`CaptureAdapterFactory` is the only owner of concrete capture-adapter
construction. It creates one stateless adapter for one capture operation.

```ts
type CaptureSourceKey = "codex.hook" | "development.fixture" | string

class CaptureAdapterFactory {
  public create(sourceKey: CaptureSourceKey): ICaptureAdapter {
    MATCH sourceKey
      "codex.hook"
        return new CodexCaptureAdapter()

      "development.fixture"
        return new DevelopmentCaptureAdapter()

      OTHERWISE
        // Trusted application composition is invalid.
        throw new ApplicationError("capture:unsupported-source")
  }
}
```

Adding Claude adds `ClaudeCaptureAdapter` and one construction branch here. It
does not add a branch to `Application`, `EvidenceCaptureService`, or
`EvidenceItemRepository`.

The source key comes from trusted application composition. Native input cannot
select its adapter or claim its capture source. The factory does not inspect
native input, normalize data, resolve workspace context, create services, or
cache adapter instances.

An unsupported trusted source fails before any native input is read or
normalized. The capture operation persists nothing. The factory never falls
back to another adapter and does not classify this failure as rejected
evidence.
