# Registration, approval, and membership entitlement

Registration is a product-scoped claim on a concrete class; approval determines whether it occupies capacity, while a qualifying membership can both gate entry and supply stock that is consumed only when the registration becomes approved.

## Registration contract

`class_kit.class_registrations` records `pending`, `approved`, `rejected`, and `cancelled` states. Only `pending` and `approved` are live: the partial unique index permits at most one live registration for a `(class_id, user_id)` pair, while a later registration may exist after rejection or cancellation. The row retains its `membership_grant_id`, `stock_consumed`, approval/cancellation timestamps, and rejection-recovery audit fields. See `class-kit-api/supabase/migrations/20260607160000_registration_engine.sql` and `class-kit-api/supabase/migrations/20260609090000_registration_rejection_recovery.sql`.

The user-facing `class-kit-register-class` function requires an authenticated, active product user before it calls the service-role RPC. The RPC independently requires the same active product-user row, so inactive or absent product membership is rejected as `product_user_not_found`; the Edge Function presents the outer check as HTTP 403. Register and cancel are the only user-facing actions in `class-kit-api/supabase/functions/class-kit-register-class/index.ts`.

### Entry-gate precedence

The `register_for_class` RPC locks the class row and applies gates in this order:

1. The requested class must exist in the current product.
2. It must be registerable: `status = published`, `lifecycle_status` must be `created` (not `cancelled`, `in_progress`, or `completed`), `starts_at` must be in the future, and visibility must not be `hidden`.
3. The user must be an active product user.
4. The number of already `approved` registrations must be below capacity. Pending registrations do not reserve capacity.
5. An active qualifying membership is required when `membership_requirement = required` or `visibility = members_only`.
6. The registration policy selects `approved` or `pending`, then an approved membership-backed registration consumes stock.

This means availability is checked before membership eligibility, and required/members-only membership is checked before the approval policy. A full class therefore returns `class_capacity_full` even when the same user also lacks membership. The live-registration uniqueness check occurs on insert after those gates and yields `registration_already_exists` on conflict. The Edge Function maps the named registration failures to 400 (except nonexistent class/registration, 404, and a live-registration conflict, 409).

## Class controls and approval outcomes

The concrete class schema defines the following values in `class-kit-api/supabase/migrations/20260607134535_template_class_core.sql`:

| Control | Supported values | Effect on registration |
| --- | --- | --- |
| `status` | `draft`, `published` | Only `published` is registerable. |
| `lifecycle_status` | `created`, `cancelled`, `in_progress`, `completed` | Only `created` is registerable. |
| `visibility` | `public`, `hidden`, `members_only` | `hidden` cannot be registered; `members_only` requires a qualifying active membership. `public` adds no membership gate. |
| `membership_requirement` | `none`, `required` | `required` requires a qualifying active membership regardless of visibility. |
| `registration_policy` | `auto_approve`, `member_auto_approve`, `approval_required` | Determines the initial state after all preceding gates pass. |

Initial-state matrix after the class, product-user, capacity, and membership-required gates have passed:

| Policy | Qualifying active membership | Initial state | Stock effect |
| --- | --- | --- |
| `auto_approve` | no | `approved` | None. |
| `auto_approve` | yes | `approved` | One stock unit is consumed only for `stock` or `limited_stock`; otherwise zero. |
| `member_auto_approve` | no | `pending` | None. |
| `member_auto_approve` | yes | `approved` | One stock unit is consumed only for `stock` or `limited_stock`; otherwise zero. |
| `approval_required` | no or yes | `pending` | None until a manager approves; approval later consumes stock if the stored grant is stock-bearing. |

The membership gate overrides the otherwise-permitted no-membership cases: a non-member cannot register under any policy when the requirement is `required` or visibility is `members_only`. The regression script `class-kit-api/supabase/tests/member_auto_approve_registration.sql` verifies the key distinctions: non-members become pending under `member_auto_approve`, members are approved with consumed stock, non-members are approved under `auto_approve`, and a required-membership attempt fails.

## Membership entitlement

Membership types have `active` or `inactive` status. Membership grants have `active`, `inactive`, `revoked`, `replaced`, or `expired` status, but the supplied lifecycle functions transition active grants to `replaced` (upgrade/set replacement) or `revoked`; expiration is evaluated through `valid_until` rather than a documented background status transition. There may be only one `active` grant per product user.

`get_active_membership_grant` returns one grant only when it is `active`, is not past `valid_until`, and has either no `remaining_stock` or a positive balance. Registration therefore treats zero-stock grants as no qualifying membership, even for a class that only needs membership rather than stock. `valid_from` is stored but is not checked by this lookup; a future-dated active grant is currently qualifying. This behavior comes from `class-kit-api/supabase/migrations/20260607132920_membership_ledger.sql`.

| Mode | Required entitlement shape | Registration effect |
| --- | --- | --- |
| `stock` | Positive total/remaining stock; no time limit required. | A qualifying grant; one unit is consumed on approval. |
| `limited_stock` | Positive stock and a validity end time (explicit or derived from default duration). | A qualifying grant while unexpired and positive; one unit is consumed on approval. |
| `limited` | A validity end time; stock fields are null. | A qualifying grant while unexpired; approval consumes zero. |
| `infinite` | No stock or expiry required; stock fields are null. | A qualifying grant; approval consumes zero. |

Membership types can be created only with positive supported defaults: stock defaults apply to `stock` and `limited_stock`; duration defaults apply to `limited` and `limited_stock`. A type mode cannot be changed through `class-kit-memberships`. Grant, upgrade, set, revoke, and stock-adjustment operations require the active product user and manager permissions; `set_for_user` is the current replacement-or-update entrypoint from `class-kit-api/supabase/functions/class-kit-memberships/index.ts` and `20260705111440_set_membership_manager_entrypoint.sql`.

For stock-bearing grants, approval locks the grant and decrements `remaining_stock` only if it remains positive. A stale, revoked, expired, or depleted grant causes `membership_required` or `membership_stock_depleted`, preventing approval. Approval of an older pending registration uses the grant id captured at registration time, so revoking/replacing that grant before approval can prevent that approval rather than silently switching to a new grant.

## State transitions, cancellation, and audit

Managers need `registrations.manage`; queue and class reads require product level 75. The management Edge Function also permits registration-changing actions only while a class is open, except it may reject a pending registration after a class has ended or been cancelled. This UI/API gate is stricter than the SQL function alone and is implemented in `class-kit-api/supabase/functions/class-kit-manage-registrations/index.ts`.

| Starting state | Actor/action | Result and entitlement effect |
| --- | --- | --- |
| New request | User `register` | `approved` or `pending` by the matrix above. |
| `pending` | Manager `approve` | Rechecks class registerability and approved capacity; becomes `approved`, consuming captured grant stock if applicable. |
| `pending` | Manager `reject` | Becomes `rejected`; no stock restoration is needed. |
| `approved` | Manager `reject` or `cancel` | Becomes `rejected` or `cancelled`; stock is restored only when stock was consumed and the class has not started. |
| `pending` or `approved` | User `cancel` | Becomes `cancelled`. A pending cancellation always remains allowed through the product cutoff; an approved cancellation is closed at `starts_at - registration_cancellation_cutoff_hours` unless the privileged RPC caller sets `force_restore`. Stock is restored only for an approved registration before start (or forced). |
| `rejected` | Manager `approve_rejected` | Rechecks no live replacement, class registerability, capacity, and captured membership stock; then becomes `approved` and records recovery metadata. |
| `rejected` | Manager `allow_reregister` | Leaves the row rejected but records recovery metadata, allowing a fresh live registration because rejected rows are not live. |
| `pending` or `approved` | Class cancellation | Becomes `cancelled`; consumed stock is restored and a ledger entry is written. |

The membership ledger is append-only evidence for `membership_granted`, `membership_upgraded`, `membership_revoked`, `membership_set`, `class_registration`, `registration_cancelled`, `class_cancelled_restore`, and `manager_adjustment`. Registration and cancellation records include class and registration ids; restoration writes a positive delta. The final event set is established in `20260705111440_set_membership_manager_entrypoint.sql` and is exposed to managers by `class-kit-memberships` `list_ledger`.

The pending-cancellation exception is regression-tested in `class-kit-api/supabase/tests/pending_registration_cancellation.sql`: a past pending registration is cancellable, while a past approved registration is rejected with `registration_cancellation_closed`.

## Known gaps

- The supplied regression scripts cover member auto-approval and the pending-versus-approved cancellation cutoff, but do not exercise manager approval/rejection recovery, live-replacement conflicts, class-cancellation restoration, or stock adjustment.
- No supplied test establishes the intended treatment of a future `valid_from` membership grant. Current SQL does not exclude it, so this page records that implementation behavior rather than product intent.
- The schema permits `inactive` and `expired` grant statuses, but the inspected grant lifecycle functions do not show an explicit transition that writes `expired`; expiry is currently enforced by `valid_until` in the active-grant lookup.
