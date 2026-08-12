# `src/capture/capture-adapter.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/capture-adapter.ts`

`CaptureAdapter` is the provider-specific validation and normalization boundary.
It converts exactly one provider-native activity into exactly one
provider-neutral outcome. It does not establish provider or channel identity,
resolve workspace context, construct durable evidence, or invoke ingestion.

```ts
// intentionally illustrative pseudocode

type ProviderNativeActivity = Readonly<{
  mediaType: string
  content: string
}>

type ProviderContextHints = Readonly<{
  projectReference?: string
  workingDirectory?: string
}>

type ProviderMessageContent =
  | Readonly<{
      kind: "user.message"
      text: string
    }>
  | Readonly<{
      kind: "assistant.message"
      text: string
    }>

type ProviderObservationDraft = Readonly<{
  sourceEventReference: string
  providerSessionReference?: string
  providerTurnReference?: string
  nativeEventKind: string
  providerOccurredAt?: normalized timestamp
  content: ProviderMessageContent
  contextHints: ProviderContextHints
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
- `sourceEventReference` is stable across repeat delivery of the same native
  activity. Extraction or deterministic derivation remains provider-specific.
- `providerSessionReference` identifies the provider-native session when the
  provider supplies one. It is not a workspace coordinate.
- `providerTurnReference` preserves a provider-native turn coordinate when the
  provider supplies one. It supports correlation and stable event references;
  it does not define application Session Memory scope.
- `nativeEventKind` preserves the provider's classification for provenance. It
  does not become provider-neutral product meaning.
- `providerOccurredAt` is present only when the provider supplies an event
  time. The capture entry point supplies the separate application-owned
  `capturedAt` timestamp.
- `ProviderMessageContent` contains only the currently established evidence
  kinds. Another content kind requires a concrete capture source.
- `contextHints` contains only coordinates found in the provider payload.
  Hints are not resolved project or workspace identity and are not authority.
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
event interpretation, stable source-event correlation, raw-source preservation,
and conversion into one provider-neutral outcome.

It does not own the provider or channel route that selected it. That route is
an immutable application-composition fact. The adapter also does not inspect
machine state, select maintenance policy, resolve project or workstream
identity, append evidence, or curate any memory product.
