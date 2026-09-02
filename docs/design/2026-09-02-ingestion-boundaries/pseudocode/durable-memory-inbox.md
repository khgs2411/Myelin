# Durable Memory Inbox Boundary

> Pseudocode artifact. Non-executable reference shape.

This boundary keeps targeted-insertion replay and atomicity shared while each
durable memory product owns its candidate lifecycle and curation.

```ts
// intentionally illustrative pseudocode

type InboxCandidateId = opaque immutable application-generated identifier

type TargetedInsertionOperationIdentity = Readonly<{
  sourceIdentity: trusted adapter identity
  projectIdentity: ProjectIdentity
  clientReference: string
}>

type TargetedInsertionOperationFingerprint = SHA-256 over the versioned,
  canonical representation of:
    selected durable memory target
    complete ordered item content

type DurableMemoryInboxCandidate = Readonly<{
  candidateId: InboxCandidateId
  target: "project" | "personal" | "practice"
  projectContext: resolved registered project context
  sourceIdentity: trusted adapter identity
  clientReference?: string
  itemIndex: non-negative ordered batch index
  content: exact supplied text
  contentDigest: SHA-256 over exact UTF-8 content bytes
  acceptedAt: application-assigned timestamp
}>

type StoredTargetedInsertionReceipt = Readonly<{
  operationReference: opaque durable reference
  target: "project" | "personal" | "practice"
  candidateReferences: ordered ReadonlyArray<InboxCandidateId>
  acceptedAt: timestamp
}>

type TargetedInsertionResult = Readonly<{
  disposition: "accepted" | "replayed"
  receipt: StoredTargetedInsertionReceipt
}>

interface DurableMemoryInbox {
  submit(
    candidates: non-empty ordered batch for this product,
    transaction: SqliteTransaction
  ): Promise<ordered ReadonlyArray<InboxCandidateId>>
}

class TargetedMemoryInsertionService {
  constructor(
    operationLedger: TargetedInsertionOperationLedger,
    projectMemoryInbox: DurableMemoryInbox owned by Project Memory,
    personalMemoryInbox: DurableMemoryInbox owned by Personal Memory,
    practiceMemoryInbox: DurableMemoryInbox owned by Practice Memory,
    sqliteDatabase: SqliteDatabase
  ) {}

  async insert(input: validated targeted insertion input): TargetedInsertionResult {
    resolve the public ProjectKey before opening the write transaction
    establish trusted source identity from the invocation adapter
    construct the complete ordered candidate batch

    IF clientReference is absent
      open one SQLite write transaction
      submit the complete batch to exactly one selected product Inbox
      store one immutable acceptance receipt
      commit
      return disposition "accepted" with the stored receipt

    derive operation identity from:
      trusted source identity
      resolved private ProjectIdentity
      clientReference

    derive the versioned fingerprint from:
      selected target
      complete ordered item content

    open one SQLite write transaction

    IF operation identity already exists
      IF stored fingerprint differs
        return conflict without changing any Inbox

      return disposition "replayed" with the original stored receipt

    submit the complete batch to exactly one selected product Inbox
    store operation identity, fingerprint, and immutable receipt
    commit
    return disposition "accepted" with the stored receipt
  }
}
```

## Ownership

The application-owned operation ledger enforces replay across all targets. A
target is part of the fingerprint, not the operation identity. Therefore,
reusing one source, project, and client reference with another target produces
a conflict instead of creating an unrelated operation in another product.

Each product-owned Inbox persists its accepted candidates in SQLite and makes
them eligible for its own curation. Project, Personal, and Practice Memory can
use different lifecycle states, claim rules, retry behavior, rejection rules,
and maintenance implementations. The shared contract does not define or
translate those product-local lifecycles.

The ledger, selected Inbox batch, and stored receipt commit in one SQLite
transaction. A failure leaves no completed operation, partial candidate batch,
or receipt. An accepted receipt proves durable Inbox acceptance only. It does
not claim that curation ran or canonical memory changed.

Canonical Project, Personal, and Practice Memory content remains Markdown.
SQLite owns targeted-insertion replay, receipts, Inbox candidates, and
product-local maintenance metadata.
