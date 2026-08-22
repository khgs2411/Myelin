# `src/session-maintenance/session-maintenance-evidence.reader.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/session-maintenance/session-maintenance-evidence.reader.ts`

`SessionMaintenanceEvidenceReader` is the narrow read port used by Session
maintenance scheduling. It supplies the raw Evidence Log time fact required
when no Session maintenance has succeeded.

```ts
// intentionally illustrative pseudocode

interface SessionMaintenanceEvidenceReader {
  requireFirstReceivedAtAfter(
    projectId: ProjectIdentity,
    sequenceExclusive: nonnegative integer,
    transaction: SqliteTransaction
  ): Promise<normalized timestamp>
}
```

The implementation returns the `received_at` value for the first Evidence Log
item in project-sequence order after `sequenceExclusive`. It does not calculate
elapsed time, inspect policy, classify eligibility, or select a maintenance
frontier.

`SessionMaintenanceScheduleService` calls this method only after it proves that
an uncovered evidence range is non-empty. A missing row is therefore an
invariant violation, not a nullable result.

The Session maintenance domain owns this port because it owns the required
fact. `EvidenceLogRepository` implements it because the Evidence Log owns the
data. Session maintenance does not own or expose the complete repository.
