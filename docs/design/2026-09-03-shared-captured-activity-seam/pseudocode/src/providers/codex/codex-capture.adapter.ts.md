# `src/providers/codex/codex-capture.adapter.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/providers/codex/codex-capture.adapter.ts`

`CodexCaptureAdapter` converts one supported Codex hook payload into one
provider-neutral `CaptureResult`.

```ts
type CodexUserPromptSubmitInput = Readonly<{
  hook_event_name: "UserPromptSubmit"
  session_id: string
  turn_id: string
  cwd: string
  prompt: string
  // other verified Codex fields remain provider-local
}>

type CodexStopInput = Readonly<{
  hook_event_name: "Stop"
  session_id: string
  turn_id: string
  cwd: string
  last_assistant_message: string | null
  // other verified Codex fields remain provider-local
}>

class CodexCaptureAdapter implements ICaptureAdapter {
  public normalize(input: unknown): CaptureResult {
    payload = validate input as CodexUserPromptSubmitInput | CodexStopInput

    MATCH payload.hook_event_name
      "UserPromptSubmit"
        validate CodexUserPromptSubmitInput
        normalizedContent = payload.prompt

      "Stop"
        validate CodexStopInput
        normalizedContent = payload.last_assistant_message

      OTHERWISE
        fail as unsupported Codex capture input

    return CaptureResult {
      nativeEventKind: payload.hook_event_name,
      nativeSessionReference: payload.session_id,
      nativeInteractionReference: payload.turn_id,
      nativeOccurredAt: absent,
      normalizedContent,
      workingDirectory: payload.cwd,
      replay: {
        scheme: "codex-hook/v1",
        key: SHA256_HEX(UTF8(JSON([
          payload.session_id,
          payload.turn_id,
          payload.hook_event_name
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

The native event name locates content. It does not assign conversation roles,
pair events, or assign memory meaning. The adapter preserves each valid
supported input, including absent or empty normalized text.

The adapter does not know the entry route, select an adapter, resolve Projects,
construct an `EvidenceItemDto`, or persist rows.

Replay-key construction uses compact JSON for the fixed coordinate array in
exactly the order shown, encodes it as UTF-8, and computes SHA-256 with lowercase
hexadecimal output. Content is not a coordinate. Changed source content under
the same coordinates must still produce a replay conflict. This adapter-owned
key is separate from the repository-owned source-integrity digest.
