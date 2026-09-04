# `src/capture/capture-adapter.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/capture/capture-adapter.ts`

`CaptureAdapter` converts exactly one provider-contract activity into one
provider-neutral outcome. Both automatic input and controlled fixture input use
this contract.

```ts
type ProviderNativeActivity = Readonly<{
  mediaType: string
  content: string
    // exact serialized input supplied to the adapter
}>

type SourceReplayDraft = Readonly<{
  scheme: string
  key: string
}>

type CaptureNormalizationResult =
  | Readonly<{
      kind: "evidence"
      observation: CapturedActivityObservation
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

CONTRACT normalize one activity
  validate the selected provider contract

  IF the serialized input violates that contract
    return rejected with a safe diagnostic

  IF the input is valid but contains no admitted evidence
    return ignored with a safe reason

  OTHERWISE
    assign the closed provider-neutral activity kind
    preserve exact content, working directory, native coordinates, replay input,
      optional provider time, and raw source
    return one evidence observation

  never establish capture-route identity
  never resolve WorkspaceContext
  never construct EvidenceCandidateDto
  never persist evidence
```

The trusted entry route selects the adapter and source identity. The payload
cannot claim or override that identity. A controlled Codex-shaped fixture is
valid adapter input, but its route identity remains `development.fixture`.

Detailed observation:
[Captured Activity Observation](../../captured-activity-observation.md).
