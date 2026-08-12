# ClassKit Project Memory

ClassKit is documented as a Supabase-backed, multi-product class and membership platform whose supported browser boundary is `@class-kit/react` over ClassKit Edge Functions and the `class_kit` schema.

## Evidence status

This draft was planned from the supplied documentation-only snapshot. The snapshot has no `class-kit-api/`, `class-kit-sdk/`, application source, migrations, or regression-test files, so behavioral statements below are **documented contracts awaiting implementation and test verification**, not verified-current behavior.

### Repository identity contradiction

The sanitized checkout evidence says this project is on `master` and has `origin` at `https://github.com/khgs2411/class-kit.git`. This conflicts with [Repository Structure](../target-repo/docs/repositories/structure.md), which calls the parent documentation repository local-only and says it should have no remote. Preserve both facts until the actual repository configuration and intended ownership are reconciled; do not treat the no-remote claim as current fact.

## Subjects

- [Repository identity and product boundaries](repository-identity-and-boundaries.md) — repository topology, ownership, and supported client boundary.
- [Product resolution, authentication, and access](product-access-policy.md) — origin resolution, auth policy, provider gates, and product-access states.
- [Authorization and role grants](authorization-and-role-grants.md) — platform/product scope, levels, explicit keys, and capability derivation.
- [Class lifecycle and registrations](class-lifecycle-and-registrations.md) — customer discovery, publication/cancellation, registration gates, and attendance transitions.
- [Templates, schedules, and generated classes](templates-schedules-and-generation.md) — creation provenance, recurrence rules, schedule states, and generation gates.
- [Memberships and entitlement ledger](memberships-and-entitlements.md) — membership modes, grant transitions, stock, and registration interaction.
- [Product documents, change requests, and PM mirroring](product-content-and-pm-workflows.md) — immutable document acceptance, request lifecycle, attachments, and Trello mirror rules.
- [SDK and control-plane surfaces](sdk-and-control-plane-surfaces.md) — public, management, and admin namespace boundaries.

## Precedence model to verify

For a user-visible mutation, the intended ordering is: resolve product/origin, establish identity, enforce provider and access policy, establish active product membership where required, enforce scope-specific authorization, then apply eligibility/resource/state-transition rules atomically. The supplied documentation names this ordering but does not supply implementation or regression tests to prove every branch.

## Known gaps

- No implementation or regression-test evidence is present in the snapshot.
- Exact enum inventories and transition matrices are incomplete for class visibility, registration policy, membership requirement, registration statuses, attendance lifecycle, membership grant statuses, and document states.
- Registration-gate precedence (access vs. active membership vs. membership entitlement vs. capacity vs. approval policy vs. class state) needs migration/RPC and regression-test evidence.
- The ClassKit parent repository's remote/ownership claim is contradictory as noted above.
