# `src/development/development-capture.adapter.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/development/development-capture.adapter.ts`

`DevelopmentCaptureAdapter` converts one controlled fixture-native record into
one provider-neutral `CaptureResult`.

```ts
type DevelopmentCaptureInput = Readonly<{
  fixtureReference: string
  itemIndex: non-negative integer
  workingDirectory: string
  content: string | null
  occurredAt?: NormalizedTimestamp
}>

class DevelopmentCaptureAdapter implements CaptureAdapter {
  normalize(input: NativeCaptureInput): CaptureResult {
    require input.mediaType is the development fixture media type
    fixture = parse and validate input.content as DevelopmentCaptureInput

    return CaptureResult {
      nativeEventKind: "fixture.input",
      nativeSessionReference: fixture.fixtureReference,
      nativeInteractionReference: fixture.itemIndex as string,
      nativeOccurredAt: fixture.occurredAt,
      normalizedContent: fixture.content,
      workingDirectory: fixture.workingDirectory,
      replay: {
        scheme: "development-fixture/v1",
        key: stable digest of {
          fixtureReference: fixture.fixtureReference,
          itemIndex: fixture.itemIndex
        }
      },
      sourceMaterial: {
        mediaType: input.mediaType,
        content: input.content,
        sha256: SHA-256 of exact input.content bytes
      }
    }
  }
}
```

The adapter preserves the truthful fixture record. It does not generate Codex
fields or reuse Codex identifiers. Stable fixture coordinates support exact
replay and conflicting-replay detection.

The adapter does not establish trusted route identity, resolve Projects,
construct an `EvidenceItemDto`, persist evidence, or create memory.
