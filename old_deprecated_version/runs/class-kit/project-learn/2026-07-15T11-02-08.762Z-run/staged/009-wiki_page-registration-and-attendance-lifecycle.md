# Registration and attendance lifecycle

Registration connects an active product user to a scheduled class; attendance is a manager-controlled lifecycle that builds and updates a separate participant roster.

## Registration contract and gate order

The self-service `class-kit-register-class` function first requires resolved, authenticated product context with an active product user. Its `register` and `cancel` actions always use that caller's user ID, so a caller cannot operate on another person's registration (`class-kit-register-class/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-register-class/index.ts`)).

`register_for_class` locks the class and applies these gates in order:

1. The class must exist in the resolved product, be `published`, visible (not `hidden`), have lifecycle other than `cancelled`, `in_progress`, or `completed`, and start in the future.
2. The caller must have an active legacy product-user row. The Edge Function independently enforces the active product-context membership gate before invoking the RPC.
3. Approved registrations must be fewer than capacity. Pending registrations do not count.
4. An active membership grant is required when `membership_requirement = required` or `visibility = members_only`.
5. Registration policy determines the initial state. A partial unique index permits only one live (`pending` or `approved`) registration per class/user.

The stored registration states are `pending`, `approved`, `rejected`, and `cancelled`. Only `approved` registrations count toward capacity. The supported policy outcomes are:

| `registration_policy` | Active membership grant | Initial result |
| --- | --- | --- |
| `auto_approve` | either | `approved` |
| `member_auto_approve` | yes | `approved` |
| `member_auto_approve` | no | `pending` |
| `approval_required` | either | `pending` |

For an approved registration with an active grant, `stock` and `limited_stock` modes consume one unit; other grant modes consume none. A missing, inactive, expired, or depleted grant causes the relevant membership/stock error rather than a successful approval. This implementation order means capacity is checked before membership eligibility, while approval policy is evaluated only after both gates (`20260701084833_fix_member_auto_approve_registration.sql` (`repo:class-kit-api/supabase/migrations/20260701084833_fix_member_auto_approve_registration.sql`)). The member-auto-approval regression test verifies the member/non-member outcomes and required-membership rejection (`member_auto_approve_registration.sql` (`repo:class-kit-api/supabase/tests/member_auto_approve_registration.sql`)).

## Cancellation and manager review

Self-cancellation accepts only the caller's own `pending` or `approved` registration. A pending registration can cancel regardless of the product cancellation cutoff. An approved registration is rejected when `now() >= starts_at - products.registration_cancellation_cutoff_hours`; the public function never enables its internal force-restore option. Cancellation writes `cancelled`; it restores consumed stock only when the class has not started. The pending-after-cutoff behavior is covered by regression evidence (`20260702055851_allow_pending_registration_cancellation_after_cutoff.sql` (`repo:class-kit-api/supabase/migrations/20260702055851_allow_pending_registration_cancellation_after_cutoff.sql`), `pending_registration_cancellation.sql` (`repo:class-kit-api/supabase/tests/pending_registration_cancellation.sql`)).

`class-kit-manage-registrations` requires product level 75 for list actions and the exact `registrations.manage` key for mutations. Its public actions are `list_pending`, `list_registered`, `list_class`, `approve`, `reject`, `cancel`, `approve_rejected`, and `allow_reregister`. Before a mutation it requires an open class (upcoming and published), except that it permits only `reject` of a `pending` registration when a class is ended or cancelled. `list_pending` first rejects such stale pending rows and then returns the refreshed queue.

At the underlying RPC boundary, `approve` requires `pending`; `approve_rejected` requires `rejected`; both reject a live replacement, re-run registerability and capacity checks, and consume membership stock when applicable. `reject` accepts `pending` or `approved`; rejecting an approved row records its decision and restores stock only before class start. `cancel` accepts `pending` or `approved`; `allow_reregister` requires `rejected` and records recovery metadata without itself changing the state. The Edge Function maps an `approve` request for a rejected row to `approve_rejected` (`class-kit-manage-registrations/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-manage-registrations/index.ts`), `20260622150445_class_api_pattern_foundation.sql` (`repo:class-kit-api/supabase/migrations/20260622150445_class_api_pattern_foundation.sql`)).

## Attendance lifecycle

All attendance actions require resolved product context. `list_class` requires product level 75; `start`, `update_attendance`, `add_walk_in`, `add_trial`, and `complete` require the exact `attendance.manage` key. The participant model has `registered`, `walk_in`, and `trial` kinds, and each participant's attendance status is either `present` or `absent`.

| Action | Preconditions and outcome |
| --- | --- |
| `start` | Class must be `published` and lifecycle `created` or `in_progress`; `created` becomes `in_progress`. It upserts one registered participant for every approved registration, with requested default status `present` or `absent` (default `absent`). It rejects cancelled or completed classes. Repeating start refreshes existing registered participants to the requested default. |
| `update_attendance` | Participant must belong to the product and its class must be `in_progress` or `completed`; sets its status to `present` or `absent`. |
| `add_walk_in` | Class must be `in_progress`; user must be an active product user and have no pending or approved registration for the class. It creates one walk-in participant with requested status (default `present`). |
| `add_trial` | Class must be `in_progress`; a nonblank trial name is required. It creates a trial participant with status `present`; the optional contact is normalized to null when blank. |
| `complete` | Class must be `in_progress`; changes lifecycle to `completed`. |

The database prevents duplicate registered participants by registration and duplicate registered/walk-in user participants by class. Attendance operations lock the relevant class or participant, so class lifecycle is the transition gate that follows permission/access evaluation (`class-kit-attendance/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-attendance/index.ts`), `20260607170000_attendance_engine.sql` (`repo:class-kit-api/supabase/migrations/20260607170000_attendance_engine.sql`)).

## Known gaps

- The snapshot has registration regression tests but no located automated test for attendance authorization, transition boundaries, participant uniqueness, roster refresh on repeated start, or post-completion updates. The attendance contract is current function/migration evidence, not regression-test-confirmed behavior.
- Manager mutation gating is enforced both in the Edge Function's open-class check and in the RPC's status-specific checks; no regression test in this snapshot exercises their combined precedence.
- The explicit cutoff comparison is verified in source and the pending-cancellation regression, but no located test covers the exact equality boundary for approved cancellations or force restoration.
