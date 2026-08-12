# Registration and attendance lifecycle

Registration connects an active product user to a concrete class, while attendance is a separate management workflow over the class participants; the implementation artifacts needed to verify their exact rules are absent from this snapshot.

## Evidence status

`repository-identity.json` identifies the supplied checkout as `class-kit` on `master` at `4f55d94506f181d179f705173ecd54606b44c90c`. The mounted `target-repo/` contains API/design documentation but none of the assigned implementation or regression-test paths:

- `class-kit-api/supabase/functions/class-kit-register-class/index.ts`
- `class-kit-api/supabase/functions/class-kit-manage-registrations/index.ts`
- `class-kit-api/supabase/functions/class-kit-attendance/index.ts`
- `class-kit-api/supabase/migrations/20260607160000_registration_engine.sql`
- `class-kit-api/supabase/tests/member_auto_approve_registration.sql`
- `class-kit-api/supabase/tests/pending_registration_cancellation.sql`

Accordingly, this page distinguishes the retained documentation's claimed interface from verified behavior. Exact enum values, transition guards, approval precedence, capacity and membership effects, and cancellation-cutoff calculation are **not verified**.

## Claimed product boundary and access gates

The retained API map assigns customer self-service registration to `class-kit-register-class` and management review to `class-kit-manage-registrations`; attendance belongs to `class-kit-attendance` under `management.attendance.*`, not `management.classes.*` ([`docs/api/backend-api.md`](../target-repo/docs/api/backend-api.md), [`docs/api/class-api-map.md`](../target-repo/docs/api/class-api-map.md)).

| Caller and operation | Documented gate | Documented outcome | Verification |
| --- | --- | --- | --- |
| Customer: `register` or self `cancel` | Authenticated product context and an active product user | The backend/RPC performs the registration or cancellation; callers cannot supply another user's identity. | Guard and RPC source absent. |
| Manager: registration reads | Product-manager level `75` in the guard audit | Read pending/class registration data. | Historical guard audit only. |
| Manager: registration mutations | Current audit says `requireProductManager`; target state is product key `registrations.manage` | Approve, reject, cancel, approve rejected, or allow re-registration. | Current guard cannot be confirmed. |
| Manager: attendance reads | Product-manager level `75` in the guard audit | List a class's attendance participants. | Historical guard audit only. |
| Manager: attendance mutations | Current audit says `requireProductManager`; target state is product key `attendance.manage` | Start, update, add participants, or complete attendance. | Current guard cannot be confirmed. |

The guard audit explicitly separates its **Current Guard** from a later **Target Guard**. It therefore cannot establish that permission-key migration has happened. This conflicts with `docs/api/class-api-map.md`, which labels the management APIs “Available”; without Edge Function source, the current authorization contract needs review.

## Registration lifecycle (documentation claim, not implementation verification)

The documented registration status vocabulary is `pending`, `approved`, and `rejected`. `approved` is the accepted/active registration state used for `registeredUsersCount`; `pendingRegistrationCount` is waiting-for-approval count. The plan also describes manager-side cancellation and re-registration recovery, but does not provide a complete verified status enum or state machine in this snapshot.

| Requested transition or outcome | Retained documentation says | What remains unknown |
| --- | --- | --- |
| User registers | Registration policy decides whether the request is accepted or requires approval; backend owns capacity, membership eligibility/stock, and response shape. | The policy values, their precedence, and all failure outcomes. |
| `pending -> approved` | Management `approve` supports it. | Capacity/stock reservation and concurrency behavior. |
| `rejected -> approved` | The API map says management `approve` can cover it; a plan says the function may translate to internal `approve_rejected`. | Whether this is current behavior, and whether re-approval has extra gates. |
| `pending -> rejected` | Management `reject` supports it. | Rejection reason contract and resource restoration. |
| `approved -> rejected` | The API map says management `reject` supports it and owns restoration side effects. | Whether the migration/RPC currently supports it and the exact restoration behavior. |
| Stale pending request | `list_pending` is documented to reject pending registrations for ended or cancelled classes before returning the queue, while leaving approved, rejected, cancelled, upcoming, and in-progress registrations unchanged. | Actual class-state enum, cleanup transaction behavior, and test coverage. |

The available plan documents additional raw actions—`cancel`, `approve_rejected`, and `allow_reregister`—but proposes hiding them from the product SDK behind only `approve` and `reject` ([`docs/design/2026-06-22-class-kit-api-pattern/plans/06-management-registrations.md`](../target-repo/docs/design/2026-06-22-class-kit-api-pattern/plans/06-management-registrations.md)). Treat those raw actions as an unverified backend surface, not a supported public contract.

## Eligibility, approval, and cancellation precedence

The only defensible ordering from the retained prose is:

1. Resolve product context and authenticate the caller; self-service requires an active product user.
2. For a registration request, the backend applies class registration policy, approval policy, capacity, membership entitlement/stock, and lifecycle validity.
3. The result becomes a registration state; only approved active registrations contribute to the documented registered-user count.
4. Self-cancellation is evaluated by backend-owned cancellation-cutoff and restoration behavior.
5. Manager review uses a separate management authority gate and transition RPC.

This is a documentation-level ordering, not proof of transaction ordering or of which condition wins when several fail. In particular, the source needed to establish whether membership is checked before capacity, whether pending requests reserve capacity or stock, how automatic approval is selected, and whether a cancelled class overrides the cutoff is missing.

`cancellationCutoff` appears only as an optional controlled class-detail field in planning material. No retained source defines its type, supported values, timezone handling, comparison rule, or the cancellation result at/before/after the boundary. Do not implement a client-side cutoff policy from this page.

## Attendance workflow (documentation claim, not implementation verification)

The retained API map names these management operations and RPCs:

| Operation | Claimed action / RPC | Claimed responsibility |
| --- | --- | --- |
| List participants | `list_class` | Read attendance participant records for a class. |
| Start attendance | `start` / `start_class_attendance` | Start the attendance session; planning pseudocode says it transitions the class to `in_progress` and creates participants from approved registrations. |
| Update attendance | `update_attendance` / `update_class_participant_attendance` | Change one participant's attendance status. |
| Add walk-in | `add_walk_in` / `add_class_walk_in` | Create a participant outside normal registration. |
| Add trial | `add_trial` / `add_class_trial_participant` | Create a trial participant. |
| Complete attendance | `complete` / `complete_class_attendance` | Finish the attendance session; planning pseudocode says it transitions the class to `completed`. |

The planning pseudocode calls `start` and `complete` lifecycle commands and says RPCs must reject unsupported lifecycle transitions. It does **not** establish the current class-state enum, all valid start/complete sources, participant kinds, attendance-status enum, idempotency, or how registration changes after start affect the roster. Those are known gaps until the attendance migration, function, and tests are available.

## Known gaps and required evidence

- Obtain the six assigned source/test paths, plus `20260607170000_attendance_engine.sql`, from the registered ClassKit repository; they are not present in `target-repo/` at this snapshot.
- Verify every registration and attendance enum, transition matrix, error/result code, and database constraint from migrations/RPCs rather than planning prose.
- Verify automatic-approval eligibility, membership mode/stock effects, capacity accounting, rejection/cancellation restoration, and concurrent-request behavior with the supplied SQL tests and any adjacent regressions.
- Verify cancellation-cutoff schema, timezone semantics, exact boundary comparison, and its precedence relative to class cancellation/end state.
- Reconcile the API docs’ “Available” labels with plans marked “Ready For Implementation,” and replace historical `requireProductManager`/target-permission notes with the actual Edge Function guards.
