# Curator result

> Pseudocode artifact. Non-executable reference shape.

Accepted response contract: ICuratorResult. Proposed filename: curator.result.ts;
source directory remains undecided. Agent transport and task implementation
remain with their later design work.

```typescript
interface ICuratorResult {
  readonly outcome: "completed";
  readonly memories: readonly ISessionMemoryDraft[];
}
```

ISessionMemoryDraft follows the accepted
[publication input](session-memory-manager.ts.md). EvidenceIngestionService
retains the original claimed batch as application-owned invocation context.
The agent does not supply attempt identity or redefine batch membership.

## Admission Rules

Before opening the publication transaction, require successful execution and a
response matching this structure. Validate every memory draft, including
non-empty content, at least one supporting evidence ID, membership of all
support IDs in the original batch, and the accepted observedAt rules.

An explicit completed outcome with an empty memories array is a valid no-memory
evaluation. Missing output, malformed output, failed execution, or invalid drafts
are failures, not an empty successful evaluation. Publish nothing on failure
and release still-owned claims through EvidenceManager.

The curator task must explicitly require evaluation of all prepared evidence.
The outcome field records reported completion; it cannot prove that the agent
considered every item carefully. Successful admission completes the entire
original batch, even when only some evidence supports the proposed memories.
Claim ownership is checked again in the publication transaction.
