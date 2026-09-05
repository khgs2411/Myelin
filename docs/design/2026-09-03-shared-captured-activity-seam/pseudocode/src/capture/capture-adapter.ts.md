# `src/capture/capture-adapter.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/capture-adapter.ts`

`ICaptureAdapter` is the common normalization contract for all capture sources.
Adapters are stateless, synchronous parsers.

```ts
type NativeSourceMaterial = Readonly<{
  format: string
  content: Uint8Array
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
  sourceMaterial: NativeSourceMaterial
}>

interface ICaptureAdapter {
  normalize(input: unknown): CaptureResult
}
```

One valid native input produces one result. The adapter preserves all valid
input. It does not decide whether the content deserves memory.

The current contract preserves the complete native value supplied to the
adapter. Object input retains every field and value, including fields that
normalization does not use. Original JSON whitespace and object-key order are
not guaranteed. String and byte input remain exact.

Each adapter owns source-specific serialization. Validation must not discard
unused fields from the value used to construct sourceMaterial. Normalized
content remains a separate projection. NativeSourceMaterial carries the
serialized bytes and a format identifier that describes how to decode them.
Shared persistence stores those bytes without parsing provider formats.
EvidenceItemRepository computes the SHA-256 integrity digest over the serialized content
before opening its write transaction. Adapters do not supply source-integrity digests.
Serialization is deterministic. Adapters recursively sort object keys while
preserving every field, value, and array order. Strings and bytes remain exact.
The format identifier includes the encoding version.

Within one replay identity, the format and content bytes must both match.
A difference in either rejects the batch. Identical content under a different
replay identity can represent a separate event.

The accepted formats are:

| Native input | Format | Stored content |
| --- | --- | --- |
| JSON-compatible object | `json.v1` | UTF-8 JSON with recursively sorted object keys and no extra whitespace |
| String | `string.v1` | UTF-8 JSON string literal, including quotes and escapes |
| Bytes | `bytes.v1` | Exact supplied bytes |

Each adapter selects the format for its native input. It rejects unsupported
values before serialization. Serialization must not silently discard or convert
values. Decoding `string.v1` restores the complete string value. Shared
persistence stores the format and bytes without decoding them.

An adapter performs no I/O and owns no database, workspace, or memory-service
dependency. One adapter instance exists only for its capture operation.

The adapter validates and narrows `unknown` to its private native input type.
The result does not claim trusted route identity, Project identity, durable
evidence identity, or memory meaning. Provider-specific and fixture-specific
types remain inside their adapter implementations.

Before returning CaptureResult, the adapter validates required source facts and
replay coordinates and ensures lossless serialization of its accepted native
value. Validation does not assess usefulness as memory.

Rejected native input throws ApplicationError("capture:invalid-input").

Adapters construct replay keys as lowercase hexadecimal SHA-256 over UTF-8
compact JSON arrays of fixed coordinates:

| Replay scheme | Ordered coordinate array |
| --- | --- |
| `development-fixture/v1` | `[fixtureReference, itemIndex]` |
| `codex-hook/v1` | `[session_id, turn_id, hook_event_name]` |

Array order and coordinate types are preserved. Content is excluded. The
repository combines the resulting key and scheme with trusted capture source
and Project identity. This adapter-owned replay hash is distinct from the
repository-owned integrity digest of complete source content.
