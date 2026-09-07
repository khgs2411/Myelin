# `src/providers/codex/codex-capture.adapter.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended source path from the existing Codex capture design; this adapter is
not implemented. This narrow extension records the approved role mapping.
It does not move Codex runtime delivery into this roadmap item.

```typescript
class CodexCaptureAdapter implements ICaptureAdapter {
  public normalize(input: unknown): CaptureResult {
    // Validate input using the established supported hook contract.
    // Extend the existing event-specific normalization:
    // UserPromptSubmit -> speakerRole: "user"; content from prompt.
    // Stop -> speakerRole: "assistant"; content from last_assistant_message.
    // Keep the existing native event kind and other capture fields.
    // Preserve complete serialized source material and replay coordinates.
  }
}
```

This supersedes the older Codex pseudocode's statement that capture does not
assign conversation roles. Unsupported hook events still fail under the existing
contract; null is not a fallback that admits unsupported events.

Role comes from the supported event, not an interpretation of message text.
Quoted speakers inside that text do not change the event's source role.
Nullable or empty message content remains subject to EvidenceManager admission.
