# Memberships and entitlements

Memberships are product-scoped manager-issued grants that determine whether a product user is entitled to member-only or membership-required classes and, for stock-bearing grants, how many approved registrations remain.

## Browser and authority boundary

The published browser boundary is the `@class-kit/react` SDK: `class-kit-sdk/src/index.ts` exports the client and manager API types, while `ClassKitClient.management.memberships` in `class-kit-sdk/src/client/class-kit-client.ts` maps typed calls to the `class-kit-memberships` Edge Function. Browser consumers do not write membership tables or invoke entitlement RPCs directly.

The Edge Function resolves the product and authenticated caller through `requireProductContext` before it uses the service-role client. This keeps every membership type, grant, and ledger query filtered to the resolved `product_id` in `class-kit-api/supabase/functions/class-kit-memberships/index.ts`. The database RPCs are also revoked from `anon` and `authenticated`; the Edge Function is the public operational authority.

Manager reads (`listTypes`, `listUserGrants`, and `listLedger`) require product permission level 75. Type lifecycle and grant operations require `memberships.manage`; only `adjustStock` uses the narrower `memberships.adjust_stock` permission. The manager role receives both permissions in the current permission migrations. `listLedger` accepts an optional user filter and clamps its limit to 1–100 (default 50).

## Types, modes, and active eligibility

A membership type is an active or inactive product configuration. It has a fixed `mode`, optional `default_stock`, optional `default_duration_days`, and an optional `template_id` binding. `createType` and `updateType` validate positive integer defaults; a type's mode cannot be changed after creation. A non-null template binding must reference an active template in the same product; clearing the binding restores unrestricted eligibility. Deactivating a type is a state change to `inactive`, not deletion: existing grants retain their stored mode and may remain usable, but new grants, upgrades, and sets require an active type.

| Mode | Required resolved entitlement | Active-grant effect |
| --- | --- | --- |
| `stock` | Positive stock, supplied explicitly or from `default_stock` | Eligible while `remaining_stock > 0`; no validity end is required. |
| `limited_stock` | Positive stock and a validity end, supplied explicitly or from both defaults | Eligible only while stock remains and `valid_until` is in the future. |
| `limited` | A validity end, supplied explicitly or from `default_duration_days` | Eligible until expiry; it never carries stock. |
| `infinite` | Neither stock nor validity end | Eligible without an expiry or stock balance. |

The grant resolver rejects stock-bearing modes with no positive resolved stock and limited modes with no resolved end date. For `limited` and `infinite`, it clears both `total_stock` and `remaining_stock` even if a caller supplied stock. An active grant lookup additionally requires `status = 'active'`, `valid_until` to be null or in the future, and `remaining_stock` to be null or positive. It does **not** currently test `valid_from`; a future-dated active grant is therefore eligible under the present implementation until another predicate fails.

Template binding determines whether an otherwise active grant applies to a particular class. A type with `template_id = null` is a wildcard and applies to every class, including a class without a template. A bound type applies only when the class has that exact template; it does not apply to template-less or differently templated classes. This eligibility check controls members-only discovery and `canRegister`, and it is reapplied by registration and manager approval before any stock consumption. Thus a missing grant fails a required gate as `membership_required`, whereas an active but mismatched restricted grant fails it as `membership_not_eligible`.

Grant statuses are `active`, `inactive`, `revoked`, `replaced`, and `expired`. The supported manager operations create, retain, replace, or revoke active grants; no current manager endpoint explicitly sets a grant to `inactive` or `expired`, and the active lookup does not mutate an expired row to `expired`. At most one active grant exists for a product user, enforced by a partial unique index.

## Grant lifecycle and ledger

The grant itself snapshots the selected type's mode, resolved validity, total stock, and remaining stock. The immutable-style membership ledger records the associated user, grant, actor, optional class/registration, stock delta, metadata, and timestamp. Its supported event values are:

- `membership_granted`, `membership_upgraded`, `membership_set`, `membership_revoked`, and `manager_adjustment` for manager lifecycle work;
- `class_registration`, `registration_cancelled`, and `class_cancelled_restore` for registration effects.

`grant` requires the target to be an active product user and an active membership type. It creates an active grant and records `membership_granted`; because there can only be one active grant, it conflicts if the user already has one. `upgrade` also requires an existing active grant, replaces it, and records `membership_upgraded`, but only permits a strictly higher rank: `stock` → `limited_stock` → `limited` → `infinite`.

`setForUser` is the manager's idempotent replacement-style operation. With the same type it updates the existing active grant's resolved validity and balances in place; with a different type it marks the prior active grant `replaced` and creates a new one. It always records `membership_set` with prior and new entitlement metadata. `revoke` changes an active grant to `revoked` and records a negative delta equal to its remaining stock (or zero for non-stock modes). These actions are availability-changing and cannot be undone through a restore endpoint; a manager must issue or set a new grant.

`adjustStock` accepts a non-zero integer only for an active `stock` or `limited_stock` grant. It cannot reduce the balance below zero, changes **only** `remaining_stock` (not `total_stock`), and records `manager_adjustment`. This is a material entitlement change: a negative adjustment can immediately make a member ineligible, while a positive adjustment restores available registrations without changing the original issued total.

## Registration: gate precedence and user outcome

Membership is one gate in the class-registration flow, not a substitute for class, product-user, capacity, or approval rules. `register_for_class` evaluates the relevant conditions in this order:

1. The class must exist in the resolved product and be registerable: published, not cancelled/in-progress/completed, future-starting, and not hidden.
2. The caller must be an active product user.
3. Approved registrations must be below capacity.
4. The system obtains the user's active grant and evaluates template eligibility. A `membership_requirement = 'required'` class or `visibility = 'members_only'` rejects a user with no grant as `membership_required` and a user with a mismatched restricted grant as `membership_not_eligible`.
5. The registration policy determines the outcome: `auto_approve` approves anyone who passed earlier gates; `member_auto_approve` approves a user with an eligible active grant and otherwise creates a pending registration; `approval_required` creates a pending registration. For an open class with no membership requirement, a mismatched restricted grant is not attached or consumed: `auto_approve` remains approved and `member_auto_approve` remains pending.

Thus a user without an eligible grant may still be pending for a public, non-required `member_auto_approve` class, while an eligible member is immediately approved. A member's stock-bearing grant consumes one unit only on approval; limited and infinite grants approve with `stock_consumed = 0`. `auto_approve` does not require a membership and therefore approves an ineligible or non-member caller without a linked grant or stock consumption. The SQL regressions `member_auto_approve_registration.sql` and `membership_template_eligibility.sql` cover the three policy outcomes, required-membership rejection, template mismatch, and manager approval rechecks.

Approved member registrations write `class_registration` with a negative stock delta. Pending registrations with an attached grant have not consumed stock until a manager approves them. The registration response exposes the resulting status and `stock_consumed`, and class discovery uses the same active-grant predicate when it calculates member eligibility (`canRegister`).

## Cancellation and restoration consequences

Cancellation is an irreversible registration-state transition to `cancelled`, although stock may be restored. A user can cancel a pending registration even after the product cancellation cutoff; an approved registration is rejected once the cutoff is reached. Before the class begins (or when an internal caller uses force restore), cancellation restores consumed stock and records `registration_cancelled`; otherwise it records the cancellation with a zero restoration. The public SDK registration call always supplies `p_force_restore: false`.

When a manager cancels a class, approved registrations with consumed stock are restored and recorded as `class_cancelled_restore`, then live registrations become cancelled. These transitions alter user availability and, after start/cutoff without forced restoration, cannot be reversed by ordinary browser calls.

## Evidence and known gaps

Current behavior is grounded in `class-kit-api/supabase/functions/class-kit-memberships/index.ts`, `class-kit-classes/index.ts`, the membership and registration migrations (including `20260607132920_membership_ledger.sql`, `20260705110018_adjust_membership_remaining_stock_only.sql`, `20260705111440_set_membership_manager_entrypoint.sql`, and `20260719084853_membership_template_binding.sql`), the SQL regression `membership_template_eligibility.sql`, and the SDK manager facade.

Known gaps:

- The snapshot has focused SQL regression coverage for `member_auto_approve` and pending cancellation after cutoff, but not for all four membership modes, future `valid_from`, grant/set/upgrade/revoke behavior, type deactivation, ledger deltas, or stock adjustment.
- The active-grant lookup's omission of a `valid_from <= now()` predicate is implementation-grounded but lacks a focused regression test; its intended product semantics need review before it is treated as a deliberate future-entitlement feature.
- Browser manager methods cover the membership operations, but this snapshot has no focused SDK/Edge-function authorization regression proving each `memberships.manage`, `memberships.adjust_stock`, and level-75 boundary.
