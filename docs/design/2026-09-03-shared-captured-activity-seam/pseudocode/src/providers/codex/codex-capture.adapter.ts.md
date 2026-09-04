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

class CodexCaptureAdapter implements CaptureAdapter {
  normalize(input: NativeCaptureInput): CaptureResult {
    require input.mediaType is "application/json"
    parse input.content as one JSON object

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
        key: stable digest of {
          session_id: payload.session_id,
          turn_id: payload.turn_id,
          hook_event_name: payload.hook_event_name
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

The native event name locates content. It does not assign conversation roles,
pair events, or assign memory meaning. The adapter preserves each valid
supported input, including absent or empty normalized text.

The adapter does not know the entry route, select an adapter, resolve Projects,
construct an `EvidenceItemDto`, or persist rows.
