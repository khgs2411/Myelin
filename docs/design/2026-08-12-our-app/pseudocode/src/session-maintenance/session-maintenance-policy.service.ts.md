# `src/session-maintenance/session-maintenance-policy.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/session-maintenance/session-maintenance-policy.service.ts`

`SessionMaintenancePolicyService` synchronizes one project's validated,
effective Session maintenance configuration into immutable policy revisions.
It is the internal Session scheduling collaborator that decides whether a new
revision is required through the caller's acceptance transaction.

```ts
// intentionally illustrative pseudocode

type ValidatedEffectiveSessionMaintenancePolicy = Readonly<{
  evidenceCountThreshold: positive integer
  elapsedInterval: normalized positive duration
  configurationDigest: string
}>

class SessionMaintenancePolicyService {
  constructor(
    private readonly policies: SessionMaintenancePolicyRepository
  ) {}

  async synchronize(
    projectId: ProjectIdentity,
    effectivePolicy: ValidatedEffectiveSessionMaintenancePolicy,
    firstAcceptedSequence: ProjectEvidenceSequence,
    transaction: SqliteTransaction
  ): Promise<SessionMaintenancePolicySnapshot> {
    latest = await policies.findLatestByProjectId(projectId, transaction)

    IF latest exists
      AND latest.evidenceCountThreshold
        == effectivePolicy.evidenceCountThreshold
      AND latest.elapsedInterval == effectivePolicy.elapsedInterval
      AND latest.configurationDigest == effectivePolicy.configurationDigest
      return latest

    IF latest does not exist
      require firstAcceptedSequence == 1
      otherwise fail with incompatible durable state

    nextPolicy = {
      projectId,
      revision: latest.revision + 1 when latest exists, otherwise 1,
      evidenceCountThreshold: effectivePolicy.evidenceCountThreshold,
      elapsedInterval: effectivePolicy.elapsedInterval,
      configurationDigest: effectivePolicy.configurationDigest
    }

    await policies.insertRevision(nextPolicy, transaction)
    return nextPolicy
  }
}
```

The service joins the `IMMEDIATE` transaction supplied by
`SessionMaintenanceScheduleService`. It does not open, commit, roll back, or
nest a transaction. The caller serializes policy synchronization, evidence
acceptance, request scheduling, and receipt persistence as one unit. The
composite policy primary key remains the final guard against duplicate
revisions.

The caller supplies already validated canonical effective values and their
digest. This service does not read or parse YAML, combine configuration scopes,
or select a project. Returning to values used by an older policy still creates
a new latest revision because only the latest row is compared. The digest is
therefore not a uniqueness key.

The schedule service calls `synchronize` only for an acceptance operation that
contains newly accepted evidence. It uses the exact returned snapshot for that
operation's eligibility decision and any new request. A stored operation replay
returns its stored receipt before synchronization, and a replay-only new
operation does not create a policy revision.

Policy absence is valid only when the operation's first newly accepted sequence
is the project's first sequence. If later evidence exists without a policy row,
the service reports incompatible durable state instead of silently recreating
revision one.

This service is not exposed as `sessionMaintenance.policy`. No current behavior
requires policy administration outside evidence-driven Session scheduling.
