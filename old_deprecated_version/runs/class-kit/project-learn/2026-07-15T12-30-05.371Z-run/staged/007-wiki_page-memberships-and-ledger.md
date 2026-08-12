# Membership types, grants, and ledger

ClassKit models a reusable membership type separately from a user-specific grant, and records entitlement and stock changes in a product-scoped membership ledger.

## Ownership and access

Membership state belongs to the resolved product. The browser-facing manager surface is `client.management.memberships` in `class-kit-sdk/src/client/class-kit-client.ts`; it invokes the `class-kit-memberships` Edge Function rather than allowing a website to query membership tables or RPCs directly.

The function first resolves authenticated product context. Membership type and grant mutations (`createType`, `updateType`, `deactivateType`, `grant`, `setForUser`, `upgrade`, and `revoke`) require the product-scoped `memberships.manage` permission. `adjustStock` instead requires the distinct `memberships.adjust_stock` permission. Listing types, a user's grant history, or the ledger requires the product level-75 manager gate. The database RPCs are service-role-only; their active-product-user and active-type checks remain the authority even after the Edge Function permission check.

Membership rows are product-local: a type, grant, and ledger entry each carries `product_id`, and grants and ledger rows also require a matching `(product_id, user_id)` product-user row. A grant can be created or set only for an **active** product user and from an **active** membership type. Deactivating a type prevents future grants but does not itself change existing grants.

## Types and modes

A membership type has a name, immutable mode, optional defaults, and status `active` or `inactive`. The API permits changing a type's name and applicable defaults, but rejects a mode change. Defaults must be positive integers when supplied; the API rejects a stock default for non-stock modes and a duration default for non-time-limited modes.

| Mode | Type defaults that apply | Grant validity | Grant stock and registration outcome |
| --- | --- | --- | --- |
| `stock` | `default_stock` may supply the grant total. | No end date is required. | Total stock must resolve to a positive value. Each approved registration consumes one remaining unit. |
| `limited_stock` | `default_stock` and `default_duration_days` may supply missing grant values. | `valid_until` must be supplied directly or resolved from the duration default. | Total stock must resolve to a positive value; approved registrations consume one remaining unit. |
| `limited` | `default_duration_days` may supply a missing end date. | `valid_until` must resolve to a value. | `total_stock` and `remaining_stock` are forced to `null`; registrations consume no stock. |
| `infinite` | Neither stock nor duration default applies. | No end date is required. | `total_stock` and `remaining_stock` are forced to `null`; registrations consume no stock. |

The grant-value resolver sets `remaining_stock` to the resolved total on creation/set. A positive stock value is mandatory for `stock` and `limited_stock`; a validity end is mandatory for `limited` and `limited_stock`. Passing stock for `limited` or `infinite` does not retain it, because the RPC resolves both stock columns to `null`.

## Grant state and effective membership

Grants preserve their mode, validity range, stock values, and one of five statuses: `active`, `inactive`, `revoked`, `replaced`, or `expired`. The current RPCs explicitly create `active` grants and change active grants to `revoked` or `replaced`; `inactive` and `expired` are supported stored states, but no inspected manager action transitions a grant into either state.

Only one `active` grant may exist for a product user, enforced by the partial unique index. The effective-grant lookup, used by registration, member-only class visibility, product context, and profile responses, requires all of the following:

1. The grant is for the requested product and user.
2. Its status is `active`.
3. `valid_until` is absent or later than the current time.
4. `remaining_stock` is absent or greater than zero.

Thus an expired timestamp or exhausted stock makes a still-`active` row ineffective. `valid_from` is persisted but is not checked by the inspected effective-grant lookup, so a future `valid_from` does not currently delay effectiveness; this is an implementation fact that should be reviewed if `valid_from` is meant to be an entitlement start gate.

### Grant, upgrade, set, revoke, and adjust

- `grant` requires there to be no active grant. The database's one-active index rejects a second active grant.
- `upgrade` requires an existing active grant and a strictly higher mode rank: `stock` (1), `limited_stock` (2), `limited` (3), then `infinite` (4). It marks the old grant `replaced`, creates a new grant, and does not support lateral or downgrade changes.
- `setForUser` is the manager's replacement-safe operation. With the same type it updates the existing active grant in place; with a different type it marks the prior grant `replaced` and creates a new active grant. It can also create the first active grant. It recalculates resolved validity and stock rather than preserving prior consumption.
- `revoke` requires an active grant, marks it `revoked`, and removes it from effective membership.
- `adjustStock` only accepts a non-zero integer for an active `stock` or `limited_stock` grant with initialized stock. It changes **only** `remaining_stock`, never `total_stock`, and rejects reductions below zero. `limited` and `infinite` grants are not adjustable.

## Registration, eligibility, and stock precedence

Membership is evaluated after broader class and product-user eligibility. In `register_for_class`, the database first finds the class, then rejects a non-registerable class (not published, cancelled/in progress/completed, started, or hidden), requires an active product user, and checks approved capacity. It then loads the effective grant.

If the class has `membership_requirement = required` **or** `visibility = members_only`, no effective grant produces `membership_required`; no registration is created and no stock can be consumed. For a class that does not require membership:

| Registration policy | Effective grant | Result | Stock effect |
| --- | --- | --- | --- |
| `auto_approve` | absent or present | `approved` | One unit only when a stock-bearing grant is present. |
| `member_auto_approve` | present | `approved` | One unit only for `stock`/`limited_stock`. |
| `member_auto_approve` | absent | `pending` | None. |
| `approval_required` | absent or present | `pending` | None until manager approval. |

The `member_auto_approve_registration.sql` database regression covers the member/non-member distinction, automatic approval, and a required-membership rejection. A manager's later approval rechecks class registerability and capacity, then consumes stock from the stored grant reference if one exists. Stock consumption locks the grant, rechecks active status and non-expired validity, decrements only stock modes with a positive balance, and returns `membership_stock_depleted` when no unit remains. This means eligibility and effective-grant checks precede approval and consumption; a class that fails an earlier gate does not consume stock.

An approved registration records `stock_consumed` as 1 for a stock-bearing grant and 0 otherwise. A registration with a non-stock effective grant still records its grant reference and a `class_registration` ledger event with delta 0. A live-registration uniqueness constraint prevents a second `pending` or `approved` registration for the same class and user.

### Cancellation and restoration

Pending and approved registrations can be cancelled by the user, but the product cancellation cutoff restricts only an approved user cancellation. The current cancellation RPC allows a pending cancellation even after the cutoff; the regression `pending_registration_cancellation.sql` verifies that distinction. For an approved registration with consumed stock, stock is restored if the class has not started or an authorized flow sets force-restore. Manager cancellation/rejection uses the same restoration rule for a future class. Cancelling a class restores consumed stock for each live approved registration, then cancels the registrations. Each cancellation/restoration path appends a ledger row, including a zero-delta row when a registration has a grant but no stock restoration occurs.

## Ledger

`class_kit.membership_ledger` is an append-only event record indexed by product, user, and newest creation time. An entry contains the product and user, optional grant, optional class and registration references, `stock_delta`, arbitrary JSON `metadata`, actor (`created_by`), and creation time. The database schema does not expose an update/delete path through the manager function; the manager surface lists entries newest first, optionally for one user, with a default limit of 50 and maximum 100.

| Event type | When written | Stock delta |
| --- | --- | --- |
| `membership_granted` | A first grant is created. | Resolved total stock, or 0. |
| `membership_upgraded` | A strictly higher-mode grant replaces an active grant. | New resolved total stock, or 0. |
| `membership_set` | `setForUser` creates, replaces, or updates a grant. | New remaining stock minus the prior remaining stock, treating absent stock as 0. |
| `membership_revoked` | An active grant is revoked. | Negative remaining stock, or 0. |
| `manager_adjustment` | A permitted remaining-stock adjustment succeeds. | Requested non-zero adjustment. |
| `class_registration` | A registration references a grant, including a pending/non-stock registration. | Negative consumed units; normally -1 for a stock consumption, otherwise 0. |
| `registration_cancelled` | User or manager cancellation/rejection writes its cancellation audit event. | Restored consumed units, or 0. |
| `class_cancelled_restore` | Class cancellation cancels live registrations. | Restored consumed units, or 0. |

The ledger's current schema includes all eight values above. There is a cross-surface typing mismatch: `membership_set` is accepted by the schema and emitted by `set_membership`/`setForUser`, but `class-kit-sdk/src/manager/manager-api.ts` omits it from its exported `MembershipEventType` union. Consumers should treat that SDK type as incomplete until it is corrected.

## Evidence and confidence

Primary implementation evidence is `class-kit-api/supabase/migrations/20260607132920_membership_ledger.sql`, with current behavior refined by `20260623163000_member_auto_approve_product_users.sql`, `20260702055851_allow_pending_registration_cancellation_after_cutoff.sql`, `20260705110018_adjust_membership_remaining_stock_only.sql`, and `20260705111440_set_membership_manager_entrypoint.sql`. The manager policy and response contract are implemented in `class-kit-api/supabase/functions/class-kit-memberships/index.ts` and surfaced by `class-kit-sdk/src/client/class-kit-client.ts`.

## Known gaps

- No inspected regression test directly covers membership type validation, grant/upgrade/set/revoke transitions, mode-value resolution, stock adjustment, ledger event content, or the one-active-grant replacement invariant.
- The SDK's exported `MembershipEventType` omits the currently emitted `membership_set` value, creating a typed public-contract mismatch.
- `valid_from` is stored and mutable through grant/set calls but is not checked by the current effective-grant query; coverage does not establish whether that is intentional.
