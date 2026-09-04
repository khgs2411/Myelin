# `src/providers/codex/codex-capture.adapter.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/providers/codex/codex-capture.adapter.ts`

`CodexCaptureAdapter` validates and normalizes the accepted
`UserPromptSubmit` and `Stop` payload shapes. The automatic and fixture routes
use this same adapter instance or equivalent composition.

```ts
type CodexUserPromptSubmitInput = Readonly<{
  hook_event_name: "UserPromptSubmit"
  session_id: string
  turn_id: string
  cwd: string
  model: string
  permission_mode: CodexPermissionMode
  transcript_path: string | null
  prompt: string
  agent_id?: string
  agent_type?: string
}>

type CodexStopInput = Readonly<{
  hook_event_name: "Stop"
  session_id: string
  turn_id: string
  cwd: string
  model: string
  permission_mode: CodexPermissionMode
  transcript_path: string | null
  last_assistant_message: string | null
  stop_hook_active: boolean
}>

class CodexCaptureAdapter implements CaptureAdapter {
  normalize(activity: ProviderNativeActivity): CaptureNormalizationResult {
    require activity.mediaType is "application/json"
    parse activity.content as one JSON object

    MATCH payload.hook_event_name
      "UserPromptSubmit"
        validate CodexUserPromptSubmitInput

        IF payload identifies provider-internal agent activity
          return ignored("codex.provider-internal-prompt")

        IF payload.prompt has no non-whitespace content
          return ignored("codex.empty-user-message")

        return evidence({
          kind: "conversation.user-message",
          nativeEventKind: "UserPromptSubmit",
          providerSessionReference: payload.session_id,
          providerInteractionReference: payload.turn_id,
          sourceReplay: codexHookReplay(payload),
          providerOccurredAt: absent,
          content: payload.prompt,
          workingDirectory: payload.cwd,
          rawSource: activity
        })

      "Stop"
        validate CodexStopInput

        IF payload.last_assistant_message is null or has no non-whitespace content
          return ignored("codex.empty-assistant-message")

        return evidence({
          kind: "conversation.assistant-message",
          nativeEventKind: "Stop",
          providerSessionReference: payload.session_id,
          providerInteractionReference: payload.turn_id,
          sourceReplay: codexHookReplay(payload),
          providerOccurredAt: absent,
          content: payload.last_assistant_message,
          workingDirectory: payload.cwd,
          rawSource: activity
        })

      OTHERWISE
        return ignored("codex.unsupported-hook-event")
  }
}

FUNCTION codexHookReplay(payload)
  return {
    scheme: "codex-hook/v1",
    key: stable digest of canonical tuple {
      session: payload.session_id,
      turn: payload.turn_id,
      event: payload.hook_event_name
    }
  }
```

Unknown additive fields remain in `rawSource`. The adapter does not read
`transcript_path`, invent occurrence time, resolve a Project, or establish
`codex.hook` or `development.fixture` identity.
