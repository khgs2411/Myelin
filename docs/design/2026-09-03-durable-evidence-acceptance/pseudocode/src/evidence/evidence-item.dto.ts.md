# `src/evidence/evidence-item.dto.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/evidence/evidence-item.dto.ts`

This artifact currently shapes only `EvidenceCandidateDto`: the immutable,
provider-neutral captured-evidence value supplied before durable acceptance.
The accepted-item extension remains outside this review boundary.

```ts
// intentionally illustrative pseudocode

type EvidenceSourceIdentity = Readonly<{
  key: string
    // stable application-owned identity for a trusted capture source,
    // for example "development.fixture" or a later provider adapter
}>

type EvidenceOrigin = Readonly<{
  kind: "capture"
  source: EvidenceSourceIdentity
  event: Readonly<{
    nativeKind: string
    sessionReference?: string
    interactionReference?: string
  }>
}>

type EvidenceSourceMaterial = Readonly<{
  mediaType: string
  content: string
    // exact content-bearing input before capture normalization
  integrity: Readonly<{
    algorithm: "sha256"
    digest: string
      // digest of the exact UTF-8 bytes of sourceMaterial.content
  }>
}>

type EvidenceCandidateDto = Readonly<{
  origin: EvidenceOrigin
  content: string
    // normalized evidence content; acceptance preserves it without
    // trimming, interpretation, or further normalization
  workspaceContext: WorkspaceContext
  occurredAt?: NormalizedTimestamp
    // supplied only when the capture source provides trustworthy event time
  sourceMaterial: EvidenceSourceMaterial
}>
```

## Candidate meaning

One `EvidenceCandidateDto` represents one normalized, content-bearing capture
observation. An acceptance batch contains candidates; a candidate is not a
batch.

`origin` identifies the trusted capture source and preserves normalized source
event coordinates. Provider-specific fields that do not have a shared meaning
remain inside `sourceMaterial.content` rather than becoming top-level contract
fields.

`content` is the evidence string intended for later processing.
`sourceMaterial` preserves the exact content-bearing input for audit and future
re-normalization. The two values can match, as they do for the initial
development transcript fixture, but the contract does not require them to
match.

`workspaceContext` is resolved before candidate construction. It binds the
candidate to the registered Project, invocation directory, and available Git
branch observation. Evidence acceptance does not resolve or change this
context.

## Ownership boundary

The capture-ingestion boundary constructs the candidate. Evidence acceptance
validates and admits it. Session maintenance later consumes accepted evidence;
Session Memory does not own or construct this pre-acceptance value.

Project, Personal, and Practice Memory targeted insertion uses product-owned
Inbox candidates. It does not construct `EvidenceCandidateDto` values.

The following values do not belong to `EvidenceCandidateDto`:

- SQLite evidence identity;
- project-local evidence sequence;
- acceptance or receipt time;
- source replay identity;
- Session maintenance intent or state; and
- Session, Project, Personal, or Practice Memory content or state.

Source replay identity describes delivery of a candidate. It belongs beside
the candidate in the acceptance command. Evidence identity, project sequence,
and acceptance time are assigned only after durable admission.

## Open implementation boundary

The exact `NormalizedTimestamp` representation and runtime validation owner
remain governed by the active design issues. They do not change the established
candidate ownership or field meanings above.
