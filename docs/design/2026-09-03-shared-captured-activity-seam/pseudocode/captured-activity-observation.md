# Captured Activity Observation

> Pseudocode artifact. Non-executable reference shape.

This boundary records the provider-neutral observation that exists after
source-specific parsing and before evidence-candidate construction.

```ts
type CapturedActivityKind =
  | "conversation.user-message"
  | "conversation.assistant-message"

type CapturedActivityObservation = Readonly<{
  kind: CapturedActivityKind
  nativeEventKind: string
  providerSessionReference?: string
  providerInteractionReference?: string
  sourceReplay?: SourceReplayDraft
  providerOccurredAt?: NormalizedTimestamp
  content: string
  workingDirectory: string
  rawSource: ProviderNativeActivity
}>

CONTRACT one normalized source event
  preserve nativeEventKind separately from product kind
  preserve exactly one normalized content-bearing event
  never combine the user and assistant observations
  never infer product kind inside shared ingestion
```

`kind` is product meaning. `nativeEventKind` is source provenance. The current
Codex mapping is:

```text
UserPromptSubmit -> conversation.user-message
Stop             -> conversation.assistant-message
```

`workingDirectory` is a source fact used before ingestion to resolve
`WorkspaceContext`. `providerOccurredAt` remains absent when the source does
not provide a trustworthy event time.

Trusted capture-source identity and resolved `WorkspaceContext` accompany the
observation at the ingestion call. They are not caller-asserted observation
fields. Durable evidence identity, project sequence, acceptance time, and
acceptance result do not belong to this observation.

For automatic capture, `rawSource.content` is the exact JSON received from the
installed hook invocation. For fixture capture, it is the exact controlled
Codex-shaped JSON supplied to the adapter. The `development.fixture` route
identity states that Codex did not emit the controlled payload.
