# Registrations and eligibility

Registrations are product-scoped records whose database functions establish eligibility, approval, capacity, membership-stock, and recovery behavior; the browser reaches them through the registration Edge Functions rather than direct table access.

The inspected checkout is `master` at `4f55d94506f181d179f705173ecd54606b44c90c`, with the recorded `origin` remote; see [repository identity](../state/repository-identity.json). This page follows the later migration overrides, not superseded versions of the registration functions.

## Registration record and entry points

`class_kit.class_registrations` belongs to one product, class, and user. Its supported status values are `pending`, `approved`, `rejected`, and `cancelled`. A partial unique index permits at most one live (`pending` or `approved`) registration for a class/user pair; rejected and cancelled rows remain history and can be followed by a new registration.

The customer function, `class-kit-register-class`, accepts `register` (the default) and `cancel`. It first requires resolved product context and an active product-user record, then calls the privileged database RPC as that user. Database errors for non-registerable classes, inactive product users, missing membership, depleted stock, and full capacity become 400 responses; a duplicate live registration is a 409. See `class-kit-api/supabase/functions/class-kit-register-class/index.ts` and `class-kit-api/supabase/migrations/20260607160000_registration_engine.sql`.

Managers use `class-kit-manage-registrations`. Listing pending, approved, or class registrations needs product level 75; state-changing actions need the explicit `registrations.manage` permission. Its supported actions are `approve`, `reject`, `cancel`, `approve_rejected`, and `allow_reregister`. The manager response deliberately presents a stored `cancelled` status as `rejected`, so clients of that endpoint must not infer the persisted status from its display value. See `class-kit-api/supabase/functions/class-kit-manage-registrations/index.ts`.

## Ordered customer eligibility gates

`register_for_class` locks the class row and evaluates gates in this order. Failure stops the process before later policy decisions or stock consumption.

| Order | Gate | Required outcome |
| --- | --- | --- |
| 1 | Product/class identity | The class must exist under the resolved product, otherwise `class_not_found`. |
| 2 | Class registerability | The class must be `published`, have lifecycle `created`, start in the future, and not have `hidden` visibility. `draft`, `cancelled`, `in_progress`, `completed`, already-started, and hidden classes fail as `class_not_registerable`. |
| 3 | Product access | The caller must have an active `class_kit.users` product-user record, otherwise `product_user_not_found`. The Edge Function performs the same active-user check before the RPC. |
| 4 | Capacity | Only approved registrations count. If that count is at least `capacity`, the request fails as `class_capacity_full`; pending registrations do not reserve a place. |
| 5 | Required membership | The active, unexpired grant lookup must return a grant when `membership_requirement` is `required` or visibility is `members_only`; otherwise the request fails as `membership_required`. |
| 6 | Approval policy | Only after the preceding gates does the policy determine `approved` or `pending`. |
| 7 | Stock | Only an immediately approved registration with a membership grant attempts stock consumption. |

`members_only` is distinct from `hidden`: a members-only class can be registered for by an eligible member, while a hidden class is never registerable through this path. This precedence means membership does not make a hidden, past, cancelled, in-progress, completed, or draft class registerable.

## Class policy values and outcomes

The class schema supports publication `draft` or `published`; lifecycle `created`, `cancelled`, `in_progress`, or `completed`; visibility `public`, `hidden`, or `members_only`; membership requirement `none` or `required`; and registration policy `auto_approve`, `member_auto_approve`, or `approval_required`. The registerability helper gives state and visibility gates precedence over membership and approval policy.

| Policy after eligibility | Caller has active grant | Result | Stock behavior |
| --- | --- | --- | --- |
| `auto_approve` | No | `approved` | No grant is recorded or consumed. |
| `auto_approve` | Yes | `approved` | The grant is recorded; stock is consumed only if its mode is stock-bearing. |
| `member_auto_approve` | No | `pending` when membership is optional | No stock is consumed. If membership is required by visibility or requirement, the earlier membership gate rejects instead. |
| `member_auto_approve` | Yes | `approved` | The grant is recorded and applicable stock is consumed. |
| `approval_required` | No | `pending` when membership is optional | No stock is consumed. |
| `approval_required` | Yes | `pending` | The grant is recorded, but stock waits for manager approval. |

The current implementation specifically corrected an earlier behavior that approved non-members under `member_auto_approve`. The regression in `class-kit-api/supabase/tests/member_auto_approve_registration.sql` verifies that an optional non-member remains pending, a member is approved with one unit of stock consumed in its fixture, an `auto_approve` non-member is approved, and a required-membership non-member is rejected.

## Membership and stock effects

The active-grant lookup and stock consumer require a grant with status `active` and `valid_until` either null or in the future. A missing/expired/inactive grant is therefore not eligible for required membership and cannot support member auto-approval. For a recorded active grant:

| Grant mode | At approval | If no positive stock remains |
| --- | --- | --- |
| `stock` | Consume one unit. | Reject with `membership_stock_depleted`. |
| `limited_stock` | Consume one unit. | Reject with `membership_stock_depleted`. |
| `limited` | Consume zero units. | No stock gate applies. |
| `infinite` | Consume zero units. | No stock gate applies. |

Every registration associated with a grant writes a `membership_ledger` `class_registration` event, including a zero `stock_delta` for a pending registration or a non-stock mode. Approval consumes stock atomically after the registration row is created; a stock failure rolls back the transaction rather than leaving an approved registration without stock. Later restoration writes a ledger event with a positive delta when stock is returned.

## Manager transitions and recovery

The manager Edge Function permits normal state changes only while the class is published and temporally upcoming. The exception is a `reject` of a pending registration when the class is ended or cancelled; pending-list retrieval automatically applies that stale-pending rejection. The RPC itself enforces the following transitions.

| Action | Allowed stored status | Result and effects |
| --- | --- | --- |
| `approve` | `pending` | Rechecks class registerability and capacity, consumes any linked grant stock, then marks `approved` with `approved_at`. |
| `reject` | `pending` or `approved` | Marks `rejected` and records rejection metadata. Rejecting an approved registration restores consumed stock only before the class starts. |
| `cancel` | `pending` or `approved` | Marks `cancelled`; an approved registration restores consumed stock only before the class starts. |
| `approve_rejected` | `rejected` | Requires no separate live replacement, rechecks registerability/capacity, consumes linked stock, and returns to `approved` with recovery metadata. |
| `allow_reregister` | `rejected` | Leaves the historical row `rejected` and records recovery metadata, allowing the user to make a new registration because rejected rows are not live. |

The current RPC contract is from `class-kit-api/supabase/migrations/20260622150445_class_api_pattern_foundation.sql`, which supersedes the narrower earlier manager function in `20260607160000_registration_engine.sql`.

## Customer cancellation and class cancellation

Customers may cancel only their own `pending` or `approved` registration. The product field `registration_cancellation_cutoff_hours` is non-negative and defines the cutoff as `starts_at - cutoff_hours`.

- A pending registration can be cancelled at any time, including after the cutoff and after the class starts.
- An approved registration cannot be customer-cancelled at or after the cutoff unless the privileged call sets `p_force_restore`; it receives `registration_cancellation_closed`.
- Cancelling an approved registration restores its previously consumed stock only if the class has not started, or the privileged call forces restoration. A pending cancellation has no consumed stock to restore.
- Manager rejection/cancellation follows the same pre-start restoration condition but has no customer cutoff check.
- `cancel_class_with_registration_restoration` marks every live registration for the class cancelled and restores stock for every approved stock-consuming registration, then marks the class lifecycle `cancelled`.

`class-kit-api/supabase/tests/pending_registration_cancellation.sql` exercises the customer-cutoff distinction: a pending registration on a past class cancels successfully, while an approved registration past the cutoff fails with `registration_cancellation_closed`.

## Known gaps

- The inspected SQL regressions cover member auto-approval and the pending-versus-approved cancellation cutoff, but do not directly cover capacity races, stock depletion/rollback, manager rejection of approved registrations, rejection recovery, manager stale-pending cleanup, or class-wide cancellation restoration.
- The manager endpoint applies an additional temporal UI/API guard before the database RPC. Its exception for rejecting stale pending rows is implementation-backed, but no inspected regression test covers that endpoint behavior.
- No test was inspected for the customer-facing implication of mapping stored `cancelled` registrations to `rejected` in manager endpoint responses.
