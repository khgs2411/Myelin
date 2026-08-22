# `src/capture/capture-adapter.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/capture-adapter.ts`

`CaptureAdapter` is the provider-specific validation and normalization boundary.
It converts exactly one provider-native activity into exactly one
provider-neutral outcome. It does not establish provider or channel identity,
resolve workspace context, construct durable evidence, or invoke acceptance.

```ts
// intentionally illustrative pseudocode

type ProviderNativeActivity = Readonly<{
  mediaType: string
  content: string
}>

type SourceReplayDraft = Readonly<{
  scheme: string
  key: string
}>

type ProviderObservationDraft = Readonly<{
  providerSessionReference?: string
  providerInteractionReference?: string
  nativeEventKind: string
  sourceReplay?: SourceReplayDraft
  providerOccurredAt?: normalized timestamp
  content: string
  workingDirectory: string
  rawSource: ProviderNativeActivity
}>

type CaptureIgnoreReason = Readonly<{
  code: string
  safeDiagnostic: string
}>

type CaptureNormalizationFailure = Readonly<{
  code: string
  safeDiagnostic: string
}>

type CaptureNormalizationResult =
  | Readonly<{
      kind: "evidence"
      observation: ProviderObservationDraft
    }>
  | Readonly<{
      kind: "ignored"
      reason: CaptureIgnoreReason
    }>
  | Readonly<{
      kind: "rejected"
      failure: CaptureNormalizationFailure
    }>

interface CaptureAdapter {
  normalize(activity: ProviderNativeActivity): CaptureNormalizationResult
}

CONTRACT CaptureAdapter.normalize
  INPUT exactly one provider-native activity with its original serialized content

  validate the required provider contract before admitting evidence

  IF the media type or serialized content cannot satisfy the selected provider contract
    return one rejected outcome with a safe failure

  IF the input is valid but carries no admitted evidence
    return one ignored outcome with a safe reason

  IF the input contains supported evidence content
    preserve its native provenance and exact raw source
    return one provider-neutral evidence outcome

  never establish provider or capture-channel identity
  never read the clock or machine workspace
  never persist evidence or invoke maintenance
```

## Vocabulary and invariants

- `ProviderNativeActivity.content` is the exact serialized content received by
  the capture entry point. The CLI does not parse and reserialize it first.
- `providerSessionReference` identifies the provider-native session when the
  provider supplies one. It is not a workspace coordinate.
- `providerInteractionReference` preserves a provider-native interaction
  coordinate when supplied. Codex maps `turn_id`; Claude Code can map
  `prompt_id`. It does not define application Session Memory scope.
- `nativeEventKind` preserves the provider's classification for provenance. It
  does not become provider-neutral product meaning.
- `sourceReplay` is present only when the adapter can derive a reliable stable
  key from provider coordinates. Its versioned scheme and key become acceptance
  metadata after the capture service adds the application-owned source domain.
  It is not part of `EvidenceOrigin`.
- `providerOccurredAt` is present only when the provider supplies an event
  time. `EvidenceAcceptanceService` later assigns the separate application-owned
  `receivedAt` time when it accepts new evidence.
- `content` is the normalized evidence string. The adapter does not assign a
  provider-neutral semantic content kind.
- `workingDirectory` is the provider-observed activity directory. It is
  required for project matching, but it is not resolved project identity or
  authority.
- `rawSource` preserves the original media type and content for integrity,
  replay, and later adapter improvements. It is never included in a safe
  diagnostic or ordinary capture result.
- An `ignored` result identifies valid input that creates no evidence. A
  `rejected` result identifies input that does not satisfy the selected
  provider contract. Neither diagnostic contains the native activity.
- One normalization call returns one outcome. A future provider-native batch
  needs an explicit batch boundary rather than an implicit one-to-many mapper.

## Ownership boundary

The adapter owns provider payload parsing, required-field validation, native
event interpretation, reliable replay-key derivation when provider coordinates
permit it, raw-source preservation, and conversion into one provider-neutral
outcome.

It does not own the provider or channel route that selected it. That route is
an immutable application-composition fact. The adapter also does not inspect
machine state, select Session maintenance policy, resolve project or workstream
identity, append evidence, or curate any memory product.
