# Attendance lifecycle

Attendance is a product-scoped management workflow that turns approved class registrations into a class roster, records each participant as present or absent, and completes the class session.

## Access boundary and gate order

The browser-facing command boundary is the `class-kit-attendance` Edge Function in `class-kit-api/supabase/functions/class-kit-attendance/index.ts`. Every action first requires a resolved product context and an authenticated bearer-token user. `list_class` then requires an active product role at permission level 75 or higher; the level check also accepts a platform role at that level. All state-changing actions require the active product user's `attendance.manage` permission; unlike the level check, this permission-key path does not fall back to platform permissions (`_shared/permissions.ts`).

After authorization, the Edge Function calls service-role RPCs with the resolved `product_id`. Each RPC locks and verifies the target class or participant within that product before applying its lifecycle gate. The effective precedence is therefore: authenticated product context -> action authorization -> target/product lookup -> class lifecycle gate -> participant-specific eligibility/uniqueness checks -> mutation. Direct client access to the RPCs is revoked; participant-table RLS permits authenticated self-read, manager-role read, or platform-admin read, but the supported management listing endpoint is more restrictive at level 75.

`attendance.manage` is a product-scoped permission in `20260612122000_permission_requirement_catalog.sql`; its catalog description covers starting attendance, updating participants, and completing sessions.

## Participant categories

`class_kit.class_participants` in `20260607170000_attendance_engine.sql` supports exactly three `participant_kind` values:

| Kind | Identity and source | Creation conditions | Initial attendance |
| --- | --- | --- | --- |
| `registered` | Requires `user_id` and `registration_id`; both must match the same product, class, and user registration. | Created only by `start` from registrations whose status is `approved`. | The start command's `default_attendance_status`, defaulting to `absent`. |
| `walk_in` | Requires an existing active product user; has no registration. | May be added only while the class is `in_progress`, when the user has no `pending` or `approved` registration for that class. | Request value, defaulting to `present`. |
| `trial` | Has no `user_id` or registration; requires a nonblank `trial_name`; `trial_contact` is optional and blank text is stored as null. | May be added only while the class is `in_progress`. | Always `present`; the Edge Function does not accept an attendance-status input for this action. |

A class can contain at most one `registered` participant for a registration and at most one registered-or-walk-in participant for a `(class_id, user_id)` pair. Trials have no corresponding per-user uniqueness rule. Deleting a registration cascades to its registered participant; deleting a product user cascades to registered and walk-in participants through the product-user relationship.

Attendance status has exactly two values: `present` and `absent`. The table default is `absent`; all RPCs reject other values, and the Edge Function rejects malformed supplied status values before the RPC call.

## Class and attendance transitions

Class lifecycle values are `created`, `cancelled`, `in_progress`, and `completed` (`20260607134535_template_class_core.sql`). Attendance commands apply the following transition contract:

| Command | Allowed class state | Result | Rejected conditions |
| --- | --- | --- | --- |
| `start` | `created` or `in_progress`, and class `status` must be `published` | `created` becomes `in_progress`; inserts participants for approved registrations. A repeat start while in progress is allowed and upserts the currently approved registrations, re-applying the supplied/default attendance status to those rows. | Missing class, draft class, `cancelled`, `completed`, or any unsupported lifecycle value. |
| `update_attendance` | `in_progress` or `completed` | Changes one existing participant between `present` and `absent`. | Missing participant/class, unstarted (`created`), or cancelled class; unsupported status. |
| `add_walk_in` | `in_progress` only | Creates a walk-in participant. | Missing class, inactive/nonexistent product user, user with a live (`pending` or `approved`) registration, or duplicate registered/walk-in participant. |
| `add_trial` | `in_progress` only | Creates a present trial participant. | Missing class or blank/whitespace-only trial name. |
| `complete` | `in_progress` only | Moves the class to `completed`. | Missing class or every other lifecycle state. |
| `list_class` | No attendance lifecycle gate in the endpoint | Returns existing participant rows for the scoped class ordered by `created_at`. | Authorization or query failure; an unknown class currently produces an empty list rather than a `class_not_found` error because the endpoint queries participant rows without first loading the class. |

Completion intentionally does not freeze attendance corrections: `update_attendance` accepts `completed`, while new walk-ins and trials are blocked after completion. There is no attendance command that returns a class from `completed` to `in_progress`, or that starts a cancelled class.

## Registration, membership, and eligibility relationship

Attendance start does not rerun class discovery, capacity, membership, or registration-approval policy. Those gates occur upstream when a registration is created: registration eligibility requires a published class that is not cancelled, in progress, or completed, among other registration rules (`20260607160000_registration_engine.sql`). At attendance start, the sole registration admission rule is current `status = 'approved'`; `pending`, `rejected`, and `cancelled` registrations are not rostered. Consequently, a membership grant's current state does not independently admit or remove an attendance participant—the approved registration is the attendance snapshot source. Walk-ins deliberately bypass registration and membership checks but must be active product users and must not have a live registration; trials bypass both because they are non-user participants.

## Known gaps

- The snapshot has no dedicated SQL or Edge Function regression test for starting, repeating, completing, or correcting attendance. `supabase/tests/truncate_product_admin_action.sql` only exercises participant cleanup as part of destructive product reset.
- There is no regression evidence here for concurrent `start` calls, concurrent walk-in insertion, or whether a later registration-state change is expected to remove an already-created registered participant beyond the declared registration-delete cascade.
- `list_class`'s empty result for a missing class follows its current query shape, but there is no focused test that establishes this as an intentional API contract.
