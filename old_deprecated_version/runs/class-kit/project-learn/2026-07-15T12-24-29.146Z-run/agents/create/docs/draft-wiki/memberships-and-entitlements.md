# Memberships and entitlements

Membership types use the documented modes `stock`, `limited_stock`, `limited`, and `infinite`. Stock defaults apply to stock-based types; duration defaults apply to time-limited types. Grants, active state, validity, and stock are backend-owned eligibility inputs for registration.

`setForUser` is the manager's default entitlement-edit action: it creates a grant when none is active, updates an active grant of the same type in place and resets stock from the requested/default total, or replaces an active grant of another type. `upgrade` is narrower: it permits only lower-rank to higher-rank replacement. `adjustStock` requires a non-zero integer on an active stock-based grant, changes only `remainingStock`, and writes a ledger event; it may exceed the original entitlement and never changes `totalStock` or validity dates. Revoke records the grant lifecycle in the ledger.

Precedence is documented as active product user, active membership type, stock/validity rules, then the mutation-specific mode/rank guard. Registration decisions consume or restore stock through backend-owned registration transitions rather than direct client calculations.

Evidence: `target-repo/docs/sdk/client-sdk.md`, `target-repo/docs/api/class-api-map.md`, `target-repo/docs/api/backend-api.md`. Missing: source and tests for membership rank ordering, active-grant selection, all mode-specific validity/stock outcomes, and registration-stock restoration.

