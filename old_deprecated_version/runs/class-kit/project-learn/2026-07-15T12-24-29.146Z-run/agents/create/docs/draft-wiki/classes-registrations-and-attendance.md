# Classes, registrations, and attendance

A class is the registerable operational entity. Customer reads are caller-safe; management reads are permission-gated. Explicit lifecycle commands are `publish`, `draft`, and `cancel`; cancellation records metadata and invokes backend restoration behavior rather than deleting the class. Customer registration and cancellation remain backend-owned for visibility, policy, capacity, membership, stock, and cutoff decisions.

Registration review uses `approve` and `reject`. The documented transition set includes `pending -> approved`, `rejected -> approved` where valid, and `pending|approved -> rejected`; pending registrations for ended or cancelled classes are auto-rejected before the pending list is returned. Approval/rejection owns capacity and stock side effects.

Attendance is a separate class-session lifecycle: start, list/update participants, optionally add a walk-in or trial, then complete. Participant attendance values are `present` and `absent`. Access/eligibility and registration policy are evaluated before approval; approval changes registration state and related stock/capacity; attendance does not replace registration eligibility.

Evidence: `target-repo/docs/api/class-api-map.md`, `target-repo/docs/sdk/client-sdk.md`, `target-repo/docs/api/backend-api.md`. Missing: source and tests for every class state, registration condition, transition rejection, restoration, and attendance completion rule.

