# `src/session-maintenance/session-maintenance-schedule.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/session-maintenance/session-maintenance-schedule.service.ts`

`SessionMaintenanceScheduleService` owns Session request eligibility,
frontier validation, and pending-request coalescing after evidence acceptance.
It receives raw persistence facts and sends exact persistence writes.

```ts
// intentionally illustrative pseudocode

type SessionMaintenanceIntent = "policy" | "immediate"

type SessionMaintenanceScheduleResult =
  | Readonly<{
      disposition: "not-requested"
    }>
  | Readonly<{
      disposition: "created" | "coalesced"
      requestId: SessionMaintenanceRequestId
      throughSequence: ProjectEvidenceSequence
      priority: "normal" | "immediate"
    }>

class SessionMaintenanceScheduleService {
  constructor(
    private readonly effectivePolicy:
      ValidatedEffectiveSessionMaintenancePolicy,
    private readonly policyService: SessionMaintenancePolicyService,
    private readonly states: SessionMaintenanceStateRepository,
    private readonly requests: SessionMaintenanceRequestRepository,
    private readonly evidence: SessionMaintenanceEvidenceReader
  ) {}

  async afterEvidenceAccepted(
    input: Readonly<{
      projectId: ProjectIdentity
      firstAcceptedSequence: ProjectEvidenceSequence
      latestProjectSequence: ProjectEvidenceSequence
      intent: SessionMaintenanceIntent
      evaluatedAt: normalized timestamp
    }>,
    transaction: SqliteTransaction
  ): Promise<SessionMaintenanceScheduleResult> {
    policy = await policyService.synchronize(
      input.projectId,
      effectivePolicy,
      input.firstAcceptedSequence,
      transaction
    )
    sessionState = await states.requireByProjectId(
      input.projectId,
      transaction
    )
    activeRequests = await requests.listActiveByProjectId(
      input.projectId,
      transaction
    )
    running = the optional active request whose state is "running"
    pending = the optional active request whose state is "pending"

    coveredFrontier = sessionState.lastCoveredEvidenceSequence

    IF running exists
      require running.fromSequenceExclusive == coveredFrontier

    IF pending exists
      expectedPendingStart =
        running.throughSequenceInclusive when running exists,
        otherwise coveredFrontier
      require pending.fromSequenceExclusive == expectedPendingStart

    scheduledFrontier = maximum of:
      coveredFrontier
      running.throughSequenceInclusive when running exists
      pending.throughSequenceInclusive when pending exists

    IF pending exists
      updatedFrontier = pending.throughSequenceInclusive
      updatedPriority = pending.priority

      IF pending.throughSequenceInclusive < input.latestProjectSequence
        await requests.extendPendingFrontier(
          {
            requestId: pending.id,
            projectId: input.projectId,
            throughSequenceInclusive: input.latestProjectSequence
          },
          transaction
        )
        updatedFrontier = input.latestProjectSequence

      IF input.intent == "immediate" AND pending.priority == "normal"
        await requests.promotePendingPriority(
          {
            requestId: pending.id,
            projectId: input.projectId
          },
          transaction
        )
        updatedPriority = "immediate"

      return {
        disposition: "coalesced",
        requestId: pending.id,
        throughSequence: updatedFrontier,
        priority: updatedPriority
      }

    unscheduledRange =
      scheduledFrontier exclusive through input.latestProjectSequence

    IF unscheduledRange is empty
      return { disposition: "not-requested" }

    countEligible =
      unscheduledRange.count >= policy.evidenceCountThreshold

    IF sessionState.lastSuccessfulMaintenanceAt exists
      timeAnchor = sessionState.lastSuccessfulMaintenanceAt
    ELSE
      timeAnchor = await evidence.requireFirstReceivedAtAfter(
        input.projectId,
        coveredFrontier,
        transaction
      )

    timeEligible =
      input.evaluatedAt - timeAnchor >= policy.elapsedInterval
    immediateEligible = input.intent == "immediate"

    IF NOT countEligible AND NOT timeEligible AND NOT immediateEligible
      return { disposition: "not-requested" }

    priority = immediateEligible ? "immediate" : "normal"
    requestId = await requests.insertPending(
      {
        projectId: input.projectId,
        fromSequenceExclusive: scheduledFrontier,
        throughSequenceInclusive: input.latestProjectSequence,
        priority,
        sessionMaintenancePolicyRevision: policy.revision
      },
      transaction
    )

    return {
      disposition: "created",
      requestId,
      throughSequence: input.latestProjectSequence,
      priority
    }
  }
}
```

The method joins the caller's `IMMEDIATE` evidence-acceptance transaction. It
does not open, commit, roll back, or nest a transaction. This preserves atomic
policy synchronization, evidence append, request scheduling, and receipt
persistence. The commit order defines revision order when processes with
different validated effective configurations overlap. Each operation evaluates
with the exact policy snapshot returned inside its transaction.

The partial unique request indexes enforce active-state multiplicity only. This
service validates the active chain and owns contiguous, non-overlapping
frontiers and monotonic pending extension. The repositories still own the
exact guarded SQL writes.

Policy synchronization does not rewrite an existing pending request's recorded
revision. That revision caused the request. Coalescing can extend its frontier
or promote its priority, while the newly synchronized policy becomes active for
the next request that requires a fresh eligibility decision.

The first accepted evidence starts the elapsed-time clock when maintenance has
never succeeded. Time passing alone does not invoke this service. The next
accepted evidence performs the evaluation.

`immediate` is a trigger for this same path. It can create a request or promote
an existing pending request, but it never runs curation synchronously. A
running request remains frozen. Later evidence can form one pending successor.

This service does not accept evidence, store receipts, notify workers, claim
attempts, publish memory, or advance the covered frontier.
