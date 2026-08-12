# Memberships And Entitlements

ClassKit documents a product-scoped membership ledger that grants a user either stock, time-limited, or unlimited class entitlement; it is separate from product access and is enforced by the backend during registration.

## Evidence status

This snapshot contains only authored documentation. It has no `class-kit-api/`, `class-kit-sdk/`, migrations, Edge Function source, RPC definitions, or regression tests. The behavior below is therefore a **documented contract awaiting implementation and test verification**, not verified-current runtime behavior. The checkout evidence identifies the snapshot as `master` at commit `4f55d94506f181d179f705173ecd54606b44c90c` with an `origin` remote; this conflicts with the local-only/no-remote statement in [Repository Structure](../target-repo/docs/repositories/structure.md) and needs review.

## Boundary: product access is not entitlement

`class_kit.users` records whether an authenticated identity is a member of the resolved product, including its product role and status. A platform administrator is not implicitly a product user. Product access is established separately from the membership entitlement ledger described here. [Backend API](../target-repo/docs/api/backend-api.md) says open products may create or confirm product membership for eligible signed-in users, while invite-only products require active product access before that membership can activate. OAuth success proves global identity, not product access.

The membership-grant ledger answers a different question: whether that product user has an active class entitlement. `profile.get()` is the customer-facing read: it returns all of the caller's grants, `has_active_membership`, and the grant selected by `get_active_membership_grant`. Operational dashboards use `management.memberships.*`; websites must not call membership Edge Functions directly. See [Class API Map](../target-repo/docs/api/class-api-map.md) and [Client SDK](../target-repo/docs/sdk/client-sdk.md).

## Membership types and modes

The currently documented membership-type modes are:

| Mode | Entitlement configuration documented | Registration/stock implication documented |
| --- | --- | --- |
| `stock` | `defaultStock`, optionally overridden per grant by `totalStock`. | A stock-based entitlement; the backend owns stock consumption and restoration. |
| `limited_stock` | `defaultStock` plus the type's time-limited behavior; per-grant validity and stock overrides are documented. | Stock-based and time-limited; exact validity/default-resolution rules need implementation evidence. |
| `limited` | `defaultDurationDays`, optionally overridden by `validFrom` and `validUntil`. | Time-limited; no stock behavior is documented. |
| `infinite` | No default stock or duration is documented. | Unlimited entitlement; exact active-grant selection and registration effects need implementation evidence. |

Only the mode inventory and configuration fields are documented. The supplied docs do not define mode ranks, the precise meaning of an expired/zero-stock grant for every mode, or the complete grant-status enum. A type's `mode` is backend-owned after creation and is not an update input. Managers can create, update, deactivate, and list types through `management.memberships.*`; deactivation changes operational availability, but the snapshot does not establish its effect on already-active grants or pending registrations.

## Grant lifecycle and ledger

The documented manager operations and their intended outcomes are:

| Operation | Intended transition/outcome | Authority and ledger effect |
| --- | --- | --- |
| `grant` | Creates a grant after the backend validates the product user, active type, stock, and validity rules. | Product membership management; the exact new-grant status and ledger event name are not documented. |
| `setForUser` / `set_membership` | No active grant: create one. Same active type: update it in place and reset `remaining_stock` from the resolved requested/default total for stock modes. Different active type: mark the prior grant `replaced`, then create the requested active grant. | Requires `memberships.manage`; records `membership_set`. This is the default “make this user have this membership” operation. |
| `upgrade` | Replaces the active grant only when the requested type has a higher membership-mode rank. Same-rank and lower-rank requests are rejected. | Narrow lifecycle operation, not a general override. The rank ordering is not documented. |
| `revoke` | Records revocation of a membership grant in the ledger. | Exact resulting grant status, registration consequences, and event vocabulary are not documented. |
| `adjustStock` / `adjust_membership_stock` | For an active stock-based grant, apply a non-zero integer delta to `remaining_stock` only. It can produce a balance above entitlement, for example `9 / 8`. | Requires `memberships.adjust_stock`; records `manager_adjustment`; does not change `total_stock`, validity dates, type, or other entitlement properties. |

Managers can list a user's grants and a bounded ledger, optionally filtered by user. Current-user profile reads include the caller's grant details but do not permit self-service grant changes.

## Stock accounting invariants

The documented model distinguishes a grant's entitlement (`total_stock`) from its current balance (`remaining_stock`). `setForUser` is an entitlement-setting operation for stock modes because it resets the balance from the resolved total. `adjustStock` is a balance correction only; it must not mutate total entitlement or validity. The docs explicitly assign stock consumption and restoration to backend registration and transition RPCs, so clients must not decrement or restore balances optimistically as authoritative state.

The available evidence does not define the stock-consumption point (registration request, approval, or another accepted state), whether each membership mode consumes stock, idempotency behavior, concurrency/atomicity guarantees, or the exact restoration matrix for cancellation, rejection, class cancellation, and re-registration.

## Registration eligibility and gate ordering

Customer registration is `classes.register(classId)`, backed by `class-kit-register-class` and `register_for_class`. The backend, not the SDK, owns class visibility, registration policy, approval policy, capacity, membership checks, membership stock, cancellation cutoffs, and response shaping. A product website should render its available response state but must not precompute final eligibility.

The documents establish these relationships:

| Condition or transition | Documented outcome |
| --- | --- |
| Signed-in caller without an active product user/access path | Registration is described as for the current product user; product-access lifecycle rules apply before the profile or customer flow can act. Exact registration error/status is not documented. |
| Class membership requirement | Exposed as an optional customer class-detail field; backend performs the final membership check. Exact requirement values and matching rules are not documented. |
| Capacity and approval policy | Backend-owned registration rules. Registration transitions include manager approval/rejection, but the exact policy enum and whether stock is consumed before approval are not documented. |
| Manager approves/rejects | Backend transition RPCs own capacity, stock consumption/restoration, rejection recovery, and invalid transitions. Approval supports `pending -> approved` and, where valid, `rejected -> approved`; rejection supports `pending -> rejected` and `approved -> rejected`. |
| Customer cancels | The cancellation RPC owns cutoff and restoration behavior; the restoration conditions are not enumerated. |
| Manager cancels class | The dedicated class-cancellation RPC owns registration restoration; exact membership/stock consequences need source and tests. |
| Pending registration for ended/cancelled class | `listPending` rejects it through the transition RPC and omits it from the queue. It leaves approved, rejected, cancelled, upcoming, and in-progress-class registrations untouched. |

The supplied docs support the intended gate sequence, but not a complete precedence matrix: resolve origin/product; authenticate; enforce product-access policy and active product-user state; authorize the operation; then apply class state, eligibility/membership, capacity, approval, and stock transitions atomically. They do **not** show which error or state wins when more than one gate fails, nor whether membership eligibility precedes capacity or approval-policy evaluation.

## Known gaps

- No implementation, migration/RPC definitions, or regression tests are present, so no membership or registration behavior is verified-current.
- The full membership-grant status enum, active-grant selection rules, validity boundary semantics, mode-rank ordering, and type-deactivation effects are undocumented in this snapshot.
- The exact semantics of `stock` versus `limited_stock`, including consumption rules and zero/expired behavior, need schema/RPC evidence.
- Registration policy, membership-requirement, class-state, and registration-status enum inventories are incomplete.
- The precedence and error/status outcome between access, active product membership, entitlement eligibility, capacity, approval policy, and class state are not established; transaction/locking and idempotency coverage are also absent.
- No source establishes the complete stock consumption/restoration matrix for initial registration, approval, rejection, customer cancellation, class cancellation, stale-pending cleanup, or re-registration.
- Repository identity needs review: `repository-identity.json` reports a remote-backed checkout, while `docs/repositories/structure.md` says the parent documentation repository should be local-only with no remote.
