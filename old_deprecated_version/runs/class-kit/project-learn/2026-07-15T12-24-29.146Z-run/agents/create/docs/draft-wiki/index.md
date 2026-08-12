# ClassKit

ClassKit is a Supabase-backed, multi-product class and membership platform whose browser boundary is the `@class-kit/react` SDK and whose authority lives in ClassKit Edge Functions, product state, and permission checks.

This Project Memory reflects the supplied documentation snapshot. It is useful for navigating the documented product contract, but the snapshot contains no implementation packages, migrations, or regression tests; the contract pages therefore identify the evidence gap instead of asserting runtime verification.

The registered checkout is on `master` at `4f55d94506f181d179f705173ecd54606b44c90c` and has an `origin` remote. This is deterministic checkout evidence from [repository identity](../state/repository-identity.json). No checked-in repository document in this snapshot contradicts that evidence.

## Canonical pages

- [Architecture and integration boundary](architecture-and-integration.md) — product layers, repository boundary, and the supported SDK-to-backend path.
- [Product access and authentication](product-access-and-authentication.md) — origin resolution, auth policy, redirects, and access-state precedence.
- [Roles, permissions, and operational authority](roles-permissions-and-authority.md) — platform/product roles, permission keys, and capability flags.
- [Classes, registrations, and attendance](classes-registrations-and-attendance.md) — customer-safe discovery, class lifecycle, registration review, and attendance.
- [Templates, schedules, and generated classes](templates-schedules-and-generated-classes.md) — class creation sources, schedule modes, and generation gates.
- [Memberships and entitlements](memberships-and-entitlements.md) — membership modes, grants, stock adjustments, and ledger behavior.
- [Product documents](product-documents.md) — immutable document versions, publication, acceptance, and access boundaries.
- [Product change requests and Trello links](product-change-requests-and-trello.md) — request revisions, attachment handling, and admin PM synchronization.
- [SDK and API surface map](sdk-and-api-surface.md) — public, management, and admin facade boundaries plus error behavior.

## Evidence boundary

The evidence set is a documentation-only export under `target-repo/docs/`, plus the sanitized identity artifact. It includes current-looking API maps and release notes, but no executable source or tests. Treat detailed lifecycle and authorization assertions as documented contracts pending verification against the registered repository.

