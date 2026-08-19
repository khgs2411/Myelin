# `src/providers/codex/codex-capture.adapter.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/providers/codex/codex-capture.adapter.ts`

`CodexCaptureAdapter` validates and normalizes the two Codex hook events that
currently produce evidence. It preserves the exact native JSON input and does
not own hook installation, capture routing, workspace resolution, persistence,
or maintenance.

```ts
// intentionally illustrative pseudocode

type CodexPermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "dontAsk"
  | "bypassPermissions"

type CodexHookCommon = Readonly<{
  session_id: string
  cwd: string
  model: string
  permission_mode: CodexPermissionMode
  transcript_path: string | null
}>

type CodexUserPromptSubmit = CodexHookCommon & Readonly<{
  hook_event_name: "UserPromptSubmit"
  turn_id: string
  prompt: string
  agent_id?: string
  agent_type?: string
}>

type CodexStop = CodexHookCommon & Readonly<{
  hook_event_name: "Stop"
  turn_id: string
  last_assistant_message: string | null
  stop_hook_active: boolean
}>

type AdmittedCodexHookPayload = CodexUserPromptSubmit | CodexStop

class CodexCaptureAdapter implements CaptureAdapter {
  normalize(activity: ProviderNativeActivity): CaptureNormalizationResult {
    IF activity.mediaType != "application/json"
      return rejected("codex.unsupported-media-type")

    payload = parse activity.content as JSON

    IF payload is not one JSON object
      return rejected("codex.invalid-json-object")

    MATCH payload.hook_event_name
      "UserPromptSubmit"
        validate required CodexUserPromptSubmit fields and their types

        IF payload identifies a provider-internal agent through agent_id or agent_type
          return ignored("codex.provider-internal-prompt")

        IF payload.prompt contains no non-whitespace content
          return ignored("codex.empty-user-message")

        return evidence({
          sourceReplay: {
            scheme: "codex-hook/v1",
            key: stable digest of canonical tuple {
              session: payload.session_id,
              turn: payload.turn_id,
              event: payload.hook_event_name
            }
          },
          providerSessionReference: payload.session_id,
          providerInteractionReference: payload.turn_id,
          nativeEventKind: payload.hook_event_name,
          content: payload.prompt,
          workingDirectory: payload.cwd,
          rawSource: activity
        })

      "Stop"
        validate required CodexStop fields and their types

        IF payload.last_assistant_message is null or contains no non-whitespace content
          return ignored("codex.empty-assistant-message")

        return evidence({
          sourceReplay: {
            scheme: "codex-hook/v1",
            key: stable digest of canonical tuple {
              session: payload.session_id,
              turn: payload.turn_id,
              event: payload.hook_event_name
            }
          },
          providerSessionReference: payload.session_id,
          providerInteractionReference: payload.turn_id,
          nativeEventKind: payload.hook_event_name,
          content: payload.last_assistant_message,
          workingDirectory: payload.cwd,
          rawSource: activity
        })

      otherwise
        return ignored("codex.unsupported-hook-event")
  }
}
```

## Validation posture

The adapter validates every required field that it uses. Missing fields, wrong
types, an invalid permission mode, or invalid JSON reject the selected payload.
Safe diagnostics identify the failed contract without including prompt,
assistant, transcript, or raw-payload content.

Unknown fields do not reject an otherwise valid admitted event. They remain in
the exact `rawSource` so additive Codex payload changes do not silently destroy
evidence or require the CLI to understand Codex JSON.

Codex does not provide an event timestamp in these hook contracts. The adapter
therefore does not invent `providerOccurredAt`; `EvidenceIngestionService`
assigns `receivedAt` only when it accepts new evidence.

The `codex-hook/v1` replay scheme fixes the canonical tuple and digest behavior
used for Codex hook replay detection. A future change to tuple fields,
canonicalization, or digest behavior requires a new scheme. The capture service
adds the application-owned `codex.hook` replay domain; the adapter does not own
that source identity.

`transcript_path` is validated as a required nullable Codex field and preserved
in the raw source. The adapter does not read or parse the transcript. Explicit
`agent_id` or `agent_type` fields identify a provider-internal prompt and avoid
misclassifying it as a human user message.

## Admitted event surface

The installed Codex integration initially registers only `UserPromptSubmit`
and `Stop`.

`SessionStart` is not registered or normalized. Count- and elapsed-time
maintenance eligibility is evaluated when real evidence is durably accepted.
The first evidence after an elapsed-time condition becomes true performs the
check, so a provider lifecycle signal is not required.

Other Codex hook events remain unsupported until one has an established
provider-neutral evidence or application behavior.

## Provider contract references

This shape is grounded in the current official Codex hook schemas:

- [UserPromptSubmit command input](https://github.com/openai/codex/blob/main/codex-rs/hooks/schema/generated/user-prompt-submit.command.input.schema.json)
- [Stop command input](https://github.com/openai/codex/blob/main/codex-rs/hooks/schema/generated/stop.command.input.schema.json)
