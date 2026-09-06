# Evidence selection

> Pseudocode artifact. Non-executable reference shape.

Authority: user-approved workspace matching and unavailable-context exclusion
in this design conversation. `EvidenceManager` coordinates selection through EvidenceItemRepository and
claims through EvidenceLedgerRepository in one transaction.

```text
Resolve request.workingDirectory through WorkspaceContextService.

If current Git context is unavailable:
    Stop before claiming evidence; report that workspace scope is unavailable.

Base scope:
    evidence.projectId equals resolved Project identity
    evidence.captureSourceKey equals request.captureSourceKey exactly
    evidence.workingDirectory equals resolved canonical workingDirectory exactly

Workspace match within base scope:
    Non-Git Project:
        captured workspace also has no Git context
    Observed named branch:
        captured Git context is observed with the same branch name
        do not compare commit IDs or upstream coordinates
    Detached HEAD:
        captured Git context is observed with no branch name
        captured headCommitId equals the current detached commit ID

Exclude evidence with unavailable captured Git context.
Report its count within base scope; leave these records unclaimed.

Within the atomic selection-and-claim transaction:
    EvidenceManager supplies eligibility criteria and a shared expiry-check time.
    EvidenceItemRepository uses one query with a ledger join or existence condition:
        Apply base scope and workspace match.
        Require no ledger row, void, or processing with an expired lease.
        Apply all eligibility conditions BEFORE ordering and the limit.
        Order by projectSequence ascending and select at most batchSize records.
    EvidenceLedgerRepository claims those evidence IDs in the same transaction.
```

Exact directory matching also separates evidence captured from different
subdirectories of one Project. Named-branch matching keeps earlier commits on
that branch eligible. A null branch name alone does not establish a detached
commit match.

Unavailable captured Git context cannot be reconstructed from a later Git
lookup. Original evidence remains unchanged. Recovery is
[deferred](../design-issues.md#recovery-of-evidence-with-unavailable-git-context).

Smaller batches are valid, including odd counts. Preserve available session and
interaction coordinates without assuming that an even limit yields complete
question/answer pairs. The concrete repository filter API and final service
result representation remain in their existing design issues. SQL syntax and
indexes follow implementation evidence; the selection semantics above are accepted.
