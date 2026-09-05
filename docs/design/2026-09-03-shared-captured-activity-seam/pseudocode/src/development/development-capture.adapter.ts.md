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

class DevelopmentCaptureAdapter implements ICaptureAdapter {
  public normalize(input: unknown): CaptureResult {
    fixture = validate input as DevelopmentCaptureInput

    return CaptureResult {
      nativeEventKind: "fixture.input",
      nativeSessionReference: fixture.fixtureReference,
      nativeInteractionReference: fixture.itemIndex as string,
      nativeOccurredAt: fixture.occurredAt,
      normalizedContent: fixture.content,
      workingDirectory: fixture.workingDirectory,
      replay: {
        scheme: "development-fixture/v1",
        key: SHA256_HEX(UTF8(JSON([
          fixture.fixtureReference,
          fixture.itemIndex
        ])))
      },
      sourceMaterial: {
        // Serialize the complete supplied native value, including unused fields.
        format: "json.v1",
        content: UTF-8 JSON with recursively sorted object keys and no extra whitespace
        // Recursively sort object keys; preserve values and array order.
        // Reject unsupported values; never silently discard or convert them.
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

Replay-key construction uses compact JSON for the fixed coordinate array in
exactly the order shown, encodes it as UTF-8, and computes SHA-256 with lowercase
hexadecimal output. Content is not a coordinate. Changed source content under
the same coordinates must still produce a replay conflict. This adapter-owned
key is separate from the repository-owned source-integrity digest.
