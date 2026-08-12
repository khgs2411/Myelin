# Membership entitlements and stock

ClassKit grants at most one currently `active` membership record to a product user, and uses that record's status, expiry, and stock balance as the entitlement for members-only visibility, membership-required registration, and member auto-approval.

## Data model and modes

`class_kit.membership_types` is a product-scoped, reusable definition. It has an immutable `mode`, optional positive `default_stock`, optional positive `default_duration_days`, and `active` or `inactive` status. `class_kit.membership_grants` snapshots the type mode and resolved validity/stock values for a particular active product user; it supports `active`, `inactive`, `revoked`, `replaced`, and `expired` statuses. A partial unique index permits only one `active` grant per `(product_id, user_id)`. The user must already be an active product user when a grant is created or replaced. See `class-kit-api/supabase/migrations/20260607132920_membership_ledger.sql`.

The mode determines which values must resolve at grant time:

| Mode | Validity | Stock | Resolution |
| --- | --- | --- | --- |
| `stock` | No expiry requirement | Required, positive | Request `total_stock`, otherwise the type default; initializes `remaining_stock` to that amount. |
| `limited_stock` | Required | Required, positive | Valid-until is supplied or calculated from the type duration; stock resolves as for `stock`. |
| `limited` | Required | None | Valid-until is supplied or calculated from the type duration; stock fields are cleared. |
| `infinite` | No expiry requirement | None | Stock fields are cleared; no validity end is required. |

The resolver rejects a stock mode without a positive resolved stock and a limited mode without an explicit or default-derived end date. The API only accepts positive integer defaults and overrides; type create/update clears fields that do not apply to the chosen immutable mode. Mode cannot be changed after type creation, and deactivation only prevents future grant selection—the active-grant lookup does not require the underlying type to remain active. `class-kit-memberships` exposes `create_type`, `update_type`, and `deactivate_type` under `memberships.manage`.

## Active entitlement predicate

`get_active_membership_grant(product_id, user_id)` returns a grant only when all of the following are true:

1. It belongs to that product and user.
2. Its `status` is `active`.
3. `valid_until` is absent or strictly later than `now()`.
4. `remaining_stock` is absent or greater than zero.

This predicate is the single active-membership resolver used by registration, public/product context, and profile responses. An expired or depleted grant can remain stored with `status = 'active'`, but is not an entitlement. Conversely, the current SQL does **not** compare `valid_from` with `now()`: a future `valid_from` is stored but does not delay active-entitlement resolution. This is current implementation behavior, not an inferred product rule. See `class-kit-api/supabase/migrations/20260607132920_membership_ledger.sql` and `class-kit-api/supabase/functions/class-kit-profile/index.ts`.

## Grant lifecycle and ranking

Managers with `memberships.manage` can invoke `grant`, `upgrade`, `set_for_user`, and `revoke` through `class-kit-memberships`; each operation is product-scoped and is executed through service-role RPCs.

- **Grant** inserts a new active grant and a `membership_granted` ledger entry. It conflicts if an active grant already exists.
- **Upgrade** requires an existing active grant and a strictly higher mode rank. The current rank is `stock` (1) < `limited_stock` (2) < `limited` (3) < `infinite` (4). It marks the prior grant `replaced`, creates a new grant, and records `membership_upgraded` with prior grant/type metadata. It cannot move sideways or down the rank order.
- **Set for user** is the corrective/replacement path. With the same type it updates the existing active grant in place; with a different type it marks the old one `replaced` and inserts a new active grant. It records `membership_set`, including prior and resulting validity and stock values, and uses the change in `remaining_stock` as `stock_delta`.
- **Revoke** requires an active grant, marks it `revoked`, and records `membership_revoked`. Its ledger delta is the negative remaining balance, or zero for non-stock modes.

An inactive type cannot be newly selected by these RPCs. The schema permits `inactive` and `expired` grant statuses, but the inspected membership entrypoint supplies no actions that transition a grant to either status; expiry is enforced by the active predicate instead.

## Registration, visibility, and stock consumption

Membership eligibility is evaluated after the class and caller's active product-user record are checked, and after class capacity is checked. For a `membership_requirement = 'required'` class or a `members_only` class, a missing active grant raises `membership_required`. A class with `member_auto_approve` approves only when that active grant exists; `auto_approve` approves regardless, while other cases become `pending`. A registration persists the chosen `membership_grant_id` and its `stock_consumed` count.

Approved registrations consume one unit only for `stock` and `limited_stock` grants. The consumption update locks the grant, requires its active status and unexpired validity, and atomically updates only when `remaining_stock > 0`; otherwise it fails with `membership_stock_depleted`. `limited` and `infinite` grants consume zero stock. Pending registrations do not consume stock until manager approval; approval again uses the registration's saved grant and therefore can fail if it is no longer active, valid, or funded. `class-kit-api/supabase/migrations/20260701084833_fix_member_auto_approve_registration.sql` and `class-kit-api/supabase/migrations/20260609090000_registration_rejection_recovery.sql` contain the final registration and approval definitions.

Published `members_only` classes are also filtered at row-level security by the same active conditions, in addition to requiring an authenticated product role. `class-kit-api/supabase/migrations/20260608010000_security_rls_membership_visibility.sql` therefore makes membership both a listing/visibility gate and a registration gate where the class contract requires it.

Cancellation restores consumed stock only for an approved registration with positive consumption when the class has not started, unless a manager uses forced restoration. User cancellation is blocked after the product-defined cancellation cutoff for approved registrations unless forced; pending registrations can still be cancelled. Manager cancellation restores under the same pre-start condition. Class cancellation restores all consumed approved-registration stock. Each cancellation path records its outcome even when no stock is restored.

## Adjustments and ledger evidence

`adjust_stock` requires the distinct `memberships.adjust_stock` permission. It accepts a non-zero integer only for an active `stock` or `limited_stock` grant with initialized balances; it changes `remaining_stock` only and rejects a result below zero. It emits `manager_adjustment`. The built-in manager role receives both membership permissions in the current role-bootstrap migrations.

The operational evidence table is `class_kit.membership_ledger`, scoped to product and user. Each row records the optional grant, event type, signed `stock_delta`, optional class/registration linkage, arbitrary metadata, creator, and timestamp. The current event vocabulary is:

- `membership_granted`, `membership_upgraded`, `membership_revoked`, `membership_set`, and `manager_adjustment` for lifecycle/manager changes;
- `class_registration` for a registration attempt or approval (zero for non-stock/pending cases, negative for consumption);
- `registration_cancelled` and `class_cancelled_restore` for cancellation outcomes and any positive restoration.

Managers at product permission level 75 can list types, a user's grants, and ledger evidence; the ledger action defaults to 50 newest entries, permits a user filter, and caps the caller-supplied limit at 100. The profile endpoint exposes every grant plus the resolver-selected `active_grant` and `has_active_membership`, but it requires the caller's own active product access.

## Known gaps

- The snapshot contains no membership/registration automated regression tests, so lifecycle, locking, and cancellation behavior is verified from current migrations and function code rather than exercised test evidence.
- `valid_from` is persisted and can be set through the API, but the active-membership SQL does not check it. No current source establishes whether immediate entitlement for future-dated grants is intended.
- No inspected job or API action transitions a grant to `expired` or `inactive`; those supported statuses may be reserved for external/manual maintenance and need coverage or ownership clarification.
