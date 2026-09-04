# Codex Turn Capture

> Pseudocode artifact. Non-executable reference shape.

This shape fixes the accepted native event granularity that the controlled
development fixture must model. It does not define the provider-neutral
observation DTO, reliable automatic delivery, or the future Codex adapter.

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

CONTRACT select captured evidence from one completed top-level turn
  receive UserPromptSubmit
  preserve its exact native JSON as the user-message source material
  identify the controlled fixture observation by:
    session_id + turn_id + "UserPromptSubmit"
  produce one user-message capture observation

  later receive Stop for the same native session_id + turn_id
  preserve its exact native JSON as the assistant-message source material
  identify the controlled fixture observation by:
    session_id + turn_id + "Stop"
  produce one assistant-message capture observation

  do not correlate both events into one synthetic evidence item
  do not use transcript_path as required evidence content
  do not invent provider occurrence time
  do not persist evidence at this provider boundary

DEVELOPMENT FIXTURE EQUIVALENCE
  receive one controlled completed-turn fixture
  create one controlled user-message observation
  create one controlled assistant-message observation
  submit them in that order through the later shared captured-activity seam
  preserve two independent replay identities
```

The shared seam will define the concrete observation type in the next roadmap
unit. This file defines only the native-to-product cardinality that seam must
support.

Roadmap Step 7 owns automatic hook installation, delivery reliability,
idempotent replay, and missed-event recovery.
