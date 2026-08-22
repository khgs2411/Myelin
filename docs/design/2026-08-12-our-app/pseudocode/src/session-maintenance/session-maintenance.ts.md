# `src/session-maintenance/session-maintenance.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/session-maintenance/session-maintenance.ts`

`SessionMaintenance` is the composed domain façade for Session Memory
maintenance. It groups the capabilities that belong to this domain without
merging their transaction rules or exposing persistence objects.

```ts
// intentionally illustrative pseudocode

class SessionMaintenance {
  constructor(
    readonly lifecycle: SessionMaintenanceLifecycleService,
    readonly schedule: SessionMaintenanceScheduleService
  ) {}
}
```

`SessionMaintenance` is an instance created by application composition. It is
not a static namespace, global singleton, base class, or repository container.
Its two current capability objects remain independently injectable:

```text
project bootstrap owner
  receives sessionMaintenance.lifecycle

EvidenceAcceptanceService
  receives sessionMaintenance.schedule
```

No consumer receives the complete façade when it needs only one capability.
This keeps dependency direction visible and prevents unrelated Session
maintenance operations from becoming available by convenience.

The façade owns no transaction. `lifecycle` joins the project-bootstrap
transaction. `schedule` joins the evidence-acceptance transaction and uses its
internal `SessionMaintenancePolicyService` collaborator to synchronize policy
in that same transaction. Each capability documents its own rule.

There is no public `policy` capability because no current application operation
administers policy independently. Exposing one would permit a caller to
synchronize policy in a separate transaction and recreate the commit gap that
this boundary prevents.

There is no empty `execution` capability. Claim, lease replacement,
publication, and fenced completion must first establish one coherent execution
contract. When that contract is shaped, application composition can add a
third public capability without changing the current two boundaries.
