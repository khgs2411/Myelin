# Attendance lifecycle

Attendance is a manager-facing, product-scoped workflow that moves a published class from `created` to `in_progress` and then `completed`, while recording registered, walk-in, and trial participants in `class_kit.class_participants`.

## Access and API boundary

The SDK exposes the workflow as `client.attendance`: `listForClass`, `start`, `updateParticipant`, `addWalkIn`, `addTrial`, and `complete` ([`class-kit-sdk/src/client/class-kit-client.ts`](../target-repo/class-kit-sdk/src/client/class-kit-client.ts)). Each call reaches the `class-kit-attendance` Edge Function, which first resolves product context and requires an authenticated bearer-token user. It then applies the action authorization before invoking its service-role RPC or query ([`class-kit-api/supabase/functions/class-kit-attendance/index.ts`](../target-repo/class-kit-api/supabase/functions/class-kit-attendance/index.ts)).

| Action | Required authorization | Resulting operation |
| --- | --- | --- |
| `list_class` | product permission level at least `75` (or platform-level fallback) | Lists the class's participants ordered by creation time. |
| `start`, `update_attendance`, `add_walk_in`, `add_trial`, `complete` | product-scoped `attendance.manage` | Executes the corresponding attendance RPC. |

Thus access is evaluated before the attendance state rules. Product-context resolution/authentication precedes both: an unresolved product, missing token, or unauthorized caller cannot reach the state transition. The permission catalog records the same per-action contract in [`20260612122000_permission_requirement_catalog.sql`](../target-repo/class-kit-api/supabase/migrations/20260612122000_permission_requirement_catalog.sql).

## State and transition contract

`classes.lifecycle_status` supports `created`, `cancelled`, `in_progress`, and `completed`; attendance uses all four values ([`20260607134535_template_class_core.sql`](../target-repo/class-kit-api/supabase/migrations/20260607134535_template_class_core.sql)). Its supported transitions and outcomes are implemented by [`20260607170000_attendance_engine.sql`](../target-repo/class-kit-api/supabase/migrations/20260607170000_attendance_engine.sql):

| Operation | Class preconditions | Outcome |
| --- | --- | --- |
| Start | Class belongs to the resolved product; `status = published`; lifecycle is `created` or `in_progress`. | `created` becomes `in_progress`; approved registrations are materialized as registered participants. Calling again while `in_progress` is permitted and re-applies the default attendance status to every materialized registered participant. |
| Start | Lifecycle is `cancelled` or `completed`, or the class is not published. | Rejected (`class_lifecycle_not_startable` or `class_not_published`). |
| Complete | Class belongs to the product and is `in_progress`. | Becomes `completed`. |
| Complete | Any other lifecycle state. | Rejected (`class_lifecycle_not_completable`). |
| Update attendance | Participant and its class belong to the product; lifecycle is `in_progress` or `completed`. | Changes the participant's status. |
| Update attendance | Lifecycle is `created` or `cancelled`. | Rejected (`class_attendance_not_started`). |

The attendance status enum is only `present` and `absent`. Start defaults every approved registration to `absent` unless `default_attendance_status` is supplied; updating a participant defaults to `absent` when the request omits `attendance_status`. Unsupported values are rejected at the Edge Function and again by the SQL RPC. Although completion prevents adding people and prevents another start, it deliberately does **not** make existing attendance immutable: `update_attendance` remains valid after completion.

## Participant kinds and identity invariants

The participant table permits exactly three `participant_kind` values, with database checks and indexes preventing invalid identity combinations and duplicates.

| Kind | Required identity | How it is created | Attendance outcome |
| --- | --- | --- | --- |
| `registered` | Non-null product user and registration; no trial fields. | `start` selects only registrations whose status is `approved`. | Initial status is the start default (`absent` unless supplied); repeated start overwrites it with that default. One participant per registration. |
| `walk_in` | Non-null active product user; no registration or trial fields. | `add_walk_in` while the class is `in_progress`. | Defaults to `present`; callers may explicitly supply `absent`. One registered-or-walk-in participant per class/user. |
| `trial` | No user or registration; nonblank name; optional contact. | `add_trial` while the class is `in_progress`. | Always starts `present`; this action has no attendance-status input. Multiple trials may share a name. |

For a walk-in, the user must be active in `class_kit.users` for the product, and must not have a `pending` or `approved` registration for that class. That live-registration check takes precedence over insertion and returns `walk_in_has_live_registration`; the uniqueness index then converts a duplicate existing registered/walk-in participant into `participant_already_exists`. A rejected or cancelled registration does not trigger the live-registration guard. Trial creation has no product-user, membership, or registration eligibility gate beyond a nonblank trimmed name.

## Approval, eligibility, and membership precedence

Registration eligibility and membership are upstream concerns. Registration creation requires an active product user, capacity, and (when required by class visibility or membership requirement) an active membership grant; its policy then yields `approved` or `pending` ([`20260607160000_registration_engine.sql`](../target-repo/class-kit-api/supabase/migrations/20260607160000_registration_engine.sql)). Attendance does not rerun those checks. At start, approval is the decisive registration gate: only `approved` rows enter the participant roster; `pending`, `rejected`, and `cancelled` rows do not.

The effective precedence is therefore:

1. Product resolution and authenticated caller, then per-action authorization.
2. Product/class or product/participant identity lookup.
3. Class lifecycle and publication gate for the requested attendance action.
4. For registered participants, approved registration status; earlier membership/eligibility only matters insofar as it produced that status.
5. For a walk-in, active product-user state and absence of a live registration; for a trial, nonblank name.
6. Participant uniqueness and the final status write.

Attendance participants are product-scoped, and the registered participant's composite foreign key binds its registration, class, product, and user together. Deleting that registration deletes the participant; ordinary registration status changes are not a deletion and this migration contains no participant cleanup for them.

## Visibility and direct data access

The participants table has RLS. Authenticated users can read their own participant rows; product managers and platform administrators can read participant rows for their scope. The Edge Function instead uses the service-role client after its explicit authorization checks. Direct mutation through the public, anonymous, or authenticated database roles is not granted for the attendance RPCs; only `service_role` receives execute permissions in the attendance migration.

## Known gaps

- There is no attendance-focused regression script under `class-kit-api/supabase/tests`; the four current SQL regressions cover member auto-approval, pending cancellation, schedule backfill, and product truncation. The truncation test only incidentally inserts and deletes a participant.
- The snapshot has no automated evidence for concurrent starts, concurrent walk-in insertion, post-start registration cancellation/rejection, or the intended operator experience of reopening an in-progress attendance session. Current behavior is documented from the migration, including its observable repeated-start reset semantics.
- The current Edge Function validates request shapes and maps database errors, but the available tests do not verify its HTTP error mapping or its permission boundary end-to-end.
