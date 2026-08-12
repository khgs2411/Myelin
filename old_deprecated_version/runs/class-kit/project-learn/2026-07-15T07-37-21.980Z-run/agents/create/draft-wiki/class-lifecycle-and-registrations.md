# Class Lifecycle And Registrations

Concrete classes are the registerable, cancellable, and attendable operational unit in ClassKit; templates and schedules only provide defaults or generate concrete classes. This page is grounded in the supplied backend migrations, Edge Functions, SDK source, and two registration regression tests.

## Concrete class lifecycle

`class_kit.classes` separates publication from operational lifecycle:

| Contract | Supported values | Effect |
| --- | --- | --- |
| `status` | `draft`, `published` | Only published classes are available for ordinary discovery and registration. `management.classes.publish()` and `.draft()` are explicit, permission-guarded commands (`classes.publish` / `classes.draft`). |
| `lifecycle_status` | `created`, `in_progress`, `completed`, `cancelled` | A class starts as `created`. Attendance start changes it to `in_progress`; attendance completion changes it to `completed`; management cancellation changes it to `cancelled`. A cancelled or completed class cannot be started, and only an `in_progress` class can be completed. |
| `visibility` | `public`, `hidden`, `members_only` | `public` is discoverable to anonymous callers when published and not cancelled. `members_only` requires a signed-in active membership for discovery/registration. `hidden` is never registerable. |

The current public-read policy allows published, non-cancelled `public` classes; authenticated product users can also read published, non-cancelled `members_only` classes only with an active membership. `classes.list/get` additionally shape caller-safe results, exposing `canRegister`, `canCancelRegistration`, and the caller's registration state rather than relying on website-side eligibility calculations (`class-kit-api/supabase/migrations/20260702121000_public_class_discovery_non_cancelled.sql`, `class-kit-api/supabase/functions/class-kit-classes/index.ts`).

Management creation supports three concrete-class sources:

- Manual: `management.classes.create()` without `templateId`; no schedule provenance.
- Template-backed manual: the optional template supplies omitted defaults, but the resulting class remains standalone.
- Schedule-generated: schedule generation owns `scheduleId`, `templateId`, `generatedForDate`, and `sourceTimezone`; manual create rejects those source fields.

`management.classes.cancel()` is not deletion. It sets `lifecycle_status` to `cancelled`, stores optional cancellation reason/exposure metadata in the Edge Function, cancels each live (`pending` or `approved`) registration, and restores consumed membership stock for approved registrations. Publication/drafting only changes `status`; it does not cancel registrations (`class-kit-api/supabase/migrations/20260607160000_registration_engine.sql`, `class-kit-api/supabase/functions/class-kit-classes/index.ts`).

## Customer registration gate and outcomes

`classes.register(classId)` requires resolved product context, a signed-in **active product user**, and a registerable concrete class. The RPC gate order is:

1. Lock and resolve the class in the current product; reject missing classes.
2. Require `published`, `created`, future-starting, and non-`hidden` class state. This rules out draft, cancelled, in-progress, completed, already-started, and hidden classes.
3. Require an active `class_kit.users` membership row for the caller.
4. Enforce capacity against approved registrations only.
5. Load the caller's active membership grant. If `membership_requirement = required` **or** `visibility = members_only`, reject without one.
6. Choose registration status and, for approvals with a grant, consume stock atomically.

`membership_requirement` values are `none` and `required`. `registration_policy` values and outcomes are:

| Policy | No active membership grant | Active membership grant |
| --- | --- | --- |
| `auto_approve` | `approved` if all earlier gates pass | `approved`; stock is consumed only for stock-based grants |
| `member_auto_approve` | `pending`, unless an earlier required-membership/members-only gate rejects | `approved`; stock is consumed only for stock-based grants |
| `approval_required` | `pending`, unless an earlier required-membership/members-only gate rejects | `pending` |

Registration rows use `pending`, `approved`, `rejected`, or `cancelled`. Only one live `pending`/`approved` row may exist per class and user. Capacity counts `approved` rows, so pending requests do not reserve capacity. An approved registration records its membership grant and stock consumption; stock-based (`stock` or `limited_stock`) grants decrement by one and fail with `membership_stock_depleted` when empty. The targeted pgTAP regression test proves the `member_auto_approve` distinction: a non-member is pending, a member is approved with stock consumed, `auto_approve` approves a non-member, and required membership rejects a non-member (`class-kit-api/supabase/tests/member_auto_approve_registration.sql`).

Customer cancellation accepts only the caller's own live registration. A pending row can be cancelled even after the product cancellation cutoff; an approved row is rejected at or after `starts_at - registration_cancellation_cutoff_hours`. Approved stock is restored only when it was consumed and the class has not started. The pending-after-cutoff behavior has a dedicated pgTAP regression test (`class-kit-api/supabase/migrations/20260702055851_allow_pending_registration_cancellation_after_cutoff.sql`, `class-kit-api/supabase/tests/pending_registration_cancellation.sql`).

## Management registration transitions

The management boundary is `management.registrations.*`; it requires product-scoped authority. Listing calls require level 75, while mutations require the explicit `registrations.manage` key (`class-kit-api/supabase/functions/class-kit-manage-registrations/index.ts`).

| Management operation | Allowed current status / class condition | Result |
| --- | --- | --- |
| `approve` | Pending registration on an upcoming, published class; rejected rows are routed to recovery approval | `approved` after rechecking live replacement, registerability, capacity, and membership stock. |
| `approve_rejected` | Rejected registration on an upcoming, published class | Re-approves under the same rechecks and records rejection-recovery metadata. |
| `reject` | `pending` or `approved` on an open class; additionally `pending` on ended/cancelled classes | `rejected`; an approved row restores consumed stock when the class has not started. |
| `cancel` | `pending` or `approved` on an open class | `cancelled`; approved rows may restore stock. |
| `allow_reregister` | Rejected row on an open class | Records recovery permission/metadata; it does not create an approval. |

The function's `listPending()` cleanup is consequential: it finds pending registrations whose class is ended (completed or past `ends_at`) or cancelled, rejects them through the same transition RPC, then omits them from the returned queue. It does not touch approved, rejected, cancelled, upcoming, or in-progress registrations. The management HTTP layer blocks approve/cancel/recovery actions once a class is no longer open, preserving only stale-pending rejection as an after-close transition.

## Attendance gates

Attendance is permission-gated through `management.attendance.*`: listing needs product level 75; all mutations need `attendance.manage`. Attendance participants are separate from registrations and have kinds `registered`, `walk_in`, or `trial`; attendance status is exactly `present` or `absent`.

| Operation | Gate and outcome |
| --- | --- |
| `start(classId, { defaultAttendanceStatus })` | Requires a published `created` class; changes it to `in_progress` and creates/updates one registered participant for every approved registration using the default (`absent` by default, or `present`). Re-running during `in_progress` is permitted and refreshes those registered participants. |
| `updateParticipant(participantId, { attendanceStatus })` | Allowed only while the class is `in_progress` or `completed`. |
| `addWalkIn(classId, { userId, attendanceStatus })` | Requires `in_progress`, an active product user, and no live pending/approved registration for that user; duplicate registered/walk-in identities are rejected. |
| `addTrial(classId, { name, contact })` | Requires `in_progress` and a nonblank name; creates a participant without a product user id and marks it `present`. |
| `complete(classId)` | Requires `in_progress`; changes lifecycle to `completed`. |

Thus attendance cannot begin on draft, cancelled, or completed classes, and completing the class closes attendance additions even though existing participant status updates remain allowed on a completed class (`class-kit-api/supabase/migrations/20260607170000_attendance_engine.sql`, `class-kit-api/supabase/functions/class-kit-attendance/index.ts`).

## SDK boundary

Customer websites use `classes.list/get/register/cancelRegistration`; operational dashboards use `management.classes.*`, `management.registrations.*`, and `management.attendance.*`. The SDK is not the security boundary: Edge Functions resolve product and identity, then enforce product membership and permission guards before calling service-only RPCs. See `docs/api/class-api-map.md`, `docs/api/backend-api.md`, and `docs/sdk/client-sdk.md` for the public contract surface.

## Known gaps

- The supplied checkout has regression SQL only for member auto-approval and pending cancellation after cutoff. It has no targeted regression tests for registration gate precedence across visibility, capacity, state, stock, and approval; management stale-pending cleanup and recovery transitions; class-cancellation restoration; or attendance lifecycle/participant invariants.
- Current behavior is derived from migrations and Edge Function source, but this snapshot does not include evidence of a full local migration/test run or deployed database function definitions. Those checks are needed to confirm migration-order and runtime parity.
- `classes` creation/update accepts `status` as an ordinary input as well as exposing publish/draft commands, which conflicts with the documentation rule that publication transitions should be command-only. The source behavior is documented above; the intended boundary needs review.
