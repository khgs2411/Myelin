# `src/capture/capture-adapter.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/capture-adapter.ts`

`CaptureAdapter` is the common normalization contract for all capture sources.

```ts
type NativeCaptureInput = Readonly<{
  mediaType: string
  content: string
    // exact serialized input in the format owned by this adapter
}>

type CaptureResult = Readonly<{
  nativeEventKind: string
  nativeSessionReference?: string
  nativeInteractionReference?: string
  nativeOccurredAt?: NormalizedTimestamp
  normalizedContent: string | null
  workingDirectory: string
  replay: Readonly<{
    scheme: string
    key: string
  }>
  sourceMaterial: Readonly<{
    mediaType: string
    content: string
    sha256: string
  }>
}>

interface CaptureAdapter {
  normalize(input: NativeCaptureInput): CaptureResult
}
```

One valid native input produces one result. The adapter preserves all valid
input. It does not decide whether the content deserves memory.

The result does not claim trusted route identity, Project identity, durable
evidence identity, or memory meaning. Provider-specific and fixture-specific
types remain inside their adapter implementations.
