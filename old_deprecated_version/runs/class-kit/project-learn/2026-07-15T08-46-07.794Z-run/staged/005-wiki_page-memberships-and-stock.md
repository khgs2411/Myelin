# Memberships and stock

ClassKit memberships are product-scoped grants that determine member visibility, membership-required registration eligibility, member auto-approval, and—when applicable—the remaining class-registration balance.

## Model and eligibility

`class_kit.membership_types` defines reusable product-local types. A type has a name, one of four immutable modes, optional mode-appropriate defaults, and `active` or `inactive` status. The manager API will not change a type's mode after creation; deactivation marks it inactive rather than deleting it. Only an active type for the requested product can issue a grant (`repo:class-kit-api/supabase/functions/class-kit-memberships/index.ts`, `repo:class-kit-api/supabase/migrations/20260607132920_membership_ledger.sql`).

A grant snapshots the selected type's mode and its resolved validity/stock values. The database permits at most one grant with `status = 'active'` per `(product_id, user_id)`; grants are also tied to an active product-user when granted, upgraded, or set. Grant statuses are `active`, `inactive`, `revoked`, `replaced`, and `expired`, although the current SQL does not automatically turn an elapsed active grant into `expired`.

The authoritative active-grant query (`get_active_membership_grant`) requires, in this order of predicate evaluation: matching product and user; `status = 'active'`; `valid_until` absent or later than now; and `remaining_stock` absent or greater than zero. This is the predicate used by class visibility and registration. It does **not** check `valid_from <= now`, so a future-dated active grant is currently eligible before its stated start time. An active row whose validity has elapsed or whose balance is zero is ineffective for eligibility but still has `active` status and still occupies the one-active-grant unique index.

## Modes and resolved values

| Mode | Validity | Stock | Grant outcome |
| --- | --- | --- | --- |
| `stock` | No end date is required. | Requires a positive `total_stock`; uses the type's positive `default_stock` if the manager does not supply it. | `remaining_stock` starts at total stock and each approved registration consumes one. |
| `limited_stock` | Requires `valid_until`, either supplied or derived from the type's positive `default_duration_days`. | Requires positive total stock, resolved like `stock`. | Eligible only while both the validity and remaining-stock predicates hold. |
| `limited` | Requires `valid_until`, supplied or derived from `default_duration_days`. | Always null. | Time-limited but not balance-limited; registration records zero stock consumption. |
| `infinite` | No end date is required. | Always null. | Neither time nor stock limits eligibility. |

For `stock` and `limited_stock`, an omitted positive stock source is rejected. For `limited` and `infinite`, the grant-value routine clears total and remaining stock even if a caller supplied stock. Type creation/update accepts positive integers only; defaults irrelevant to the mode must be null. A type can therefore be saved without the required default, but a later grant must then supply the required value or fails.

## Registration and access-gate precedence

Registration first locks and validates the class (published, not cancelled/in-progress/completed, future start, and not hidden), then requires an active product user, then checks approved capacity, then resolves the active grant. A class with `membership_requirement = 'required'`, or `visibility = 'members_only'`, rejects a user without that effective grant with `membership_required`. Thus membership eligibility is evaluated after class/user/capacity gates but before registration-policy selection (`repo:class-kit-api/supabase/migrations/20260701084833_fix_member_auto_approve_registration.sql`).

The supported registration policies determine the result once the eligibility gate passes:

| Policy | Effective member | No effective member when membership is not required |
| --- | --- | --- |
| `auto_approve` | Approved immediately; stock is consumed only if the selected grant is stock-bearing. | Approved immediately with no grant/stock use. |
| `member_auto_approve` | Approved immediately; a stock-bearing grant consumes one unit. | Pending approval. |
| `approval_required` | Pending approval. | Pending approval. |

The SQL regression `repo:class-kit-api/supabase/tests/member_auto_approve_registration.sql` covers all material distinctions above: a non-member under `member_auto_approve` is pending, a member is approved with one stock unit consumed, `auto_approve` accepts a non-member, and required membership rejects the non-member.

`members_only` visibility uses the same effective-grant predicate in the class Edge Function, but it additionally requires the authenticated product user to be active before membership is checked (`repo:class-kit-api/supabase/functions/class-kit-classes/index.ts`).

## Grant transitions and manager boundary

All membership operations resolve product context in the `class-kit-memberships` Edge Function. `memberships.manage` is required to create/update/deactivate types and to grant, set, upgrade, or revoke a grant; `memberships.adjust_stock` is separately required for a balance adjustment. Listing types, one user's grants, or ledger entries requires product role level 75. The supported SDK facade is `client.management.memberships` in `repo:class-kit-sdk/src/manager/manager-api.ts` and `repo:class-kit-sdk/src/client/class-kit-client.ts`.

- `grant` creates a new active grant and records `membership_granted`; it conflicts if any active-status grant already exists, including one that is logically expired or depleted.
- `upgrade` requires an existing active-status grant and only accepts a strictly higher mode rank: `stock` (1), `limited_stock` (2), `limited` (3), then `infinite` (4). It marks the old grant `replaced`, creates the new grant, and records `membership_upgraded` with prior-grant metadata.
- `setForUser` is the general manager correction path. For the same membership type it overwrites resolved validity and stock on the existing active grant; for a different type it marks the old grant `replaced` and creates a new one. It records `membership_set`, including previous and resulting entitlement values.
- `revoke` only targets an active-status grant, marks it `revoked`, and records `membership_revoked` with the negative remaining balance (or zero for non-stock grants).
- `adjustStock` only targets an active `stock` or `limited_stock` grant with initialized stock. Its delta must be a non-zero integer and cannot reduce remaining stock below zero. It changes **remaining** stock only—not `total_stock`—and records `manager_adjustment`.

## Stock and ledger behavior

Approved registrations consume exactly one unit from stock-bearing grants, atomically requiring a positive remaining balance; a depleted balance produces `membership_stock_depleted`. Non-stock grants are attached to registrations but consume zero. Pending registrations consume nothing until a manager approves them. Registration rows persist the grant id and `stock_consumed` amount, while `membership_ledger` appends a product/user/grant event with optional class and registration links.

Cancellation writes `registration_cancelled`. It restores consumed stock only for an approved registration with stock consumption when the class has not started, unless a force-restore path is used; the cancellation metadata records whether stock was restored. Class-cancellation restoration is separately represented by `class_cancelled_restore`. The ledger event vocabulary is: `membership_granted`, `membership_upgraded`, `membership_revoked`, `membership_set`, `class_registration`, `registration_cancelled`, `class_cancelled_restore`, and `manager_adjustment`.

## Known gaps

- The snapshot has targeted regression coverage for member-auto-approval but no dedicated SQL regression suite for all mode-resolution rules, grant/upgrade/set/revoke transitions, adjustment limits, expiry, or restoration paths.
- `valid_from` is stored and accepted by the manager API but is absent from the active-grant predicate; future-dated grants are currently effective. Likewise, elapsed/depleted grants remain `active` in storage and can block a fresh `grant` through the partial unique index. These behaviors need an explicit product decision or lifecycle coverage.
- The backend and Edge Function include `membership_set`, but the SDK's exported `MembershipEventType` union omits it (`repo:class-kit-sdk/src/manager/manager-api.ts`). SDK consumers cannot type the full ledger vocabulary without a cast.
