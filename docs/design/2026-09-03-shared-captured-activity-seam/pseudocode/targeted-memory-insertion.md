# Targeted Memory Insertion Boundary

> Pseudocode artifact. Non-executable reference shape.
>
> Consolidated from the accepted targeted-insertion boundary. Owner naming
> follows the current product README; no new insertion behavior is introduced.

This boundary describes the deliberate CLI, MCP, or function operation for
proposing content to one durable memory product. It replaces the earlier idea
that all manual insertion enters Session Memory through the Evidence Log.

```ts
// intentionally illustrative pseudocode

type DurableMemoryTarget = "project" | "personal" | "practice"

type TargetedMemoryInsertionItem = Readonly<{
  content: string
}>

type TargetedMemoryInsertionRequest = Readonly<{
  projectKey: ProjectKey
  target: DurableMemoryTarget
  items: ReadonlyArray<TargetedMemoryInsertionItem>
  clientReference?: string
}>

type TargetedMemoryInsertionInput = Readonly<{
  invocationContext: trusted context established by the CLI, MCP, or function adapter
  request: TargetedMemoryInsertionRequest
}>

CLI_ROUTE memory propose <project | personal | practice>
  derive target from the required positional route
  accept one or more ordered content sources:
    repeatable --text <content>
    repeatable --file <path>
    at most one explicit --stdin
  preserve mixed content sources in command-line occurrence order
  accept optional --request-ref as clientReference
  during the local prototype, supply the fixed project key from application context
  do not expose a configurable project selector before project generalization

TARGETED_MEMORY_INSERTION
  validate the complete request before creating any candidate
  require one known projectKey
  require target to be project, personal, or practice
  require at least one ordered item
  reject empty or whitespace-only item content
  require clientReference for MCP
  keep clientReference optional for direct human CLI use

  resolve projectKey to private ProjectIdentity and current project context
  never accept a path or SQLite identity as a request substitute

  establish insertion source from trusted invocationContext
  never accept source identity from request content

  FOR EACH item in supplied order
    preserve item.content exactly
    do not trim, summarize, classify, or rewrite it
    preserve exact text/plain source material
    compute SHA-256 over its exact UTF-8 bytes
    construct one target-specific Inbox candidate with:
      selected durable memory target
      resolved project context
      trusted insertion source
      client reference when present
      batch item index
      exact content and integrity metadata

  IF clientReference is present
    derive one operation identity from:
      trusted insertion source
      resolved ProjectIdentity
      clientReference

  delegate operation replay and atomic Inbox submission to the shared durable
    memory Inbox boundary
  return accepted or replayed with one immutable Inbox-acceptance receipt
  do not wait for target-product curation
```

The operation fingerprint includes the selected target plus the complete
ordered item content. Repeating the same source, project, and client reference
with the same request returns the original receipt. Reusing that identity with
a changed target, content, item count, or item order returns a conflict. Without
a client reference, equal content is a new intentional insertion.

The `projectKey` records the registered project context in which the proposal
was made. It also selects Project Memory ownership when `target` is `project`.
Personal and Practice Memory retain their own cross-project authority and do
not become owned by that project.

The request creates target-specific Inbox candidates, not captured
`EvidenceCandidateDto` values and not canonical memory nodes. The selected
memory product owns later validation, reconciliation, admission, rejection,
and publication. Session Memory is not a valid target or an intermediate step.

The application-owned insertion-operation ledger enforces replay across all
three targets. The selected product owns candidate persistence and every later
lifecycle state. The ledger record, complete candidate batch, and immutable
receipt commit in one SQLite transaction. Detailed contract:
[Durable Memory Inbox](durable-memory-inbox.md).
