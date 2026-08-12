# SDK And Control-Plane Surfaces

ClassKit’s supported browser boundary is `@class-kit/react`: customer and product-management apps call its typed facade and React context, while the backend retains all authorization, policy, and state-transition authority.

## Evidence status

This subject is documented from the supplied documentation-only snapshot. It contains no `class-kit-api/`, `class-kit-sdk/`, app source, migrations, or regression tests. The namespace and authorization statements below are therefore **documented contracts awaiting implementation and test verification**, not verified-current runtime behavior.

## Layer ownership and the browser rule

The intended request path is:

```text
frontend app -> @class-kit/react -> class-kit-* Edge Functions -> class_kit schema
```

- The database/RPC layer owns persistent state, atomic transitions, constraints, and RLS backstops.
- Edge Functions own origin/product resolution, identity and product-role resolution, authorization, validation, orchestration, and response shaping.
- The SDK owns browser-facing method names, types, response normalization, and hides transport/function action details.
- Product and control-panel apps own UI, routes, copy, and presentation only.

The SDK namespace is not a security boundary. Browser capability checks may determine what UI to render, but every mutating backend function remains authoritative. In particular, service-role work inside trusted functions must still use ClassKit permission guards.

Product websites must not query `class_kit` tables, invoke RPCs, or call raw `class-kit-*` Edge Functions. A backend operation missing from the SDK should be added to the SDK facade before a product app consumes it; direct calls are not an allowed compatibility escape hatch. [Client SDK](../target-repo/docs/sdk/client-sdk.md) and [Class API Map](../target-repo/docs/api/class-api-map.md) state this boundary explicitly.

## Supported SDK surfaces

| Surface | Intended caller and scope | Responsibilities |
| --- | --- | --- |
| `auth.*`, `product.*`, `profile.*` | Current browser user in the resolved product | Session/auth flows, product context, and the caller’s own profile/membership data. Self-service profile methods never take a `userId`. |
| `classes.*`, `signupLinks.resolve`, `productDocuments.*` | Customer/product website | Customer-safe discovery/detail, registration and self-cancellation, public signup-link resolution, and published document read/acceptance. Backend policy controls visibility, registration, capacity, membership, cutoff, and data exposure. |
| `management.*` | Current-product operational dashboard | Permission-guarded product-local work: classes, registrations, templates, schedules, attendance, memberships, signup links, documents, change requests, roles, users, and the currently documented `management.product.updateAuthMode`. |
| `admin.*` | Platform/admin control plane | Cross-product provisioning/setup, product origins and auth redirects, provider toggles, user/access administration, product-role administration, destructive product truncation, cross-product change-request handling, and PM integration administration. |

`management` deliberately means operational capability, not the built-in `manager` role: custom product roles can hold the necessary permission keys. `management.*` requires resolved product context and product-scoped authority. `admin.*` accepts an explicit `productKey`, because a control plane can act on a product other than the one inferred from the current browser origin.

The documented management namespaces are `classes`, `templates`, `schedules`, `registrations`, `attendance`, `memberships`, `signupLinks`, `productDocuments`, `changeRequests`, `roles`, `users`, and `product`. The documented admin namespaces are `products`, `users`, `productRoles`, `changeRequests`, and `pmIntegrations`. Explicit lifecycle methods such as `publish`, `draft`, `cancel`, `approve`, `reject`, `start`, `complete`, `pause`, `archive`, `deactivate`, `generate`, `skipDate`, and `unskipDate` are commands rather than hidden `update` fields, preserving backend control over consequential transitions.

## Access, eligibility, and authority precedence

The documented backend order is: resolve the request origin and optional path-aware site URL; resolve product and auth policy; establish Supabase identity where required; load product membership/role context; enforce provider and access policy; enforce the relevant product- or platform-scoped permission; then apply resource eligibility, validation, and atomic transition rules.

Production callers do not provide a product key. The SDK sends `x-class-kit-site-url` for path-aware origin matching; the backend accepts it only when its origin matches the real `Origin`. A `product_key` hint is limited to localhost development and still requires an allowed localhost origin. This prevents product apps from selecting arbitrary production tenants.

`auth_mode` has two documented values:

| Value | Outcome |
| --- | --- |
| `open` | Password sign-up may create a global identity and product membership only if password signup is enabled and backend creation succeeds. |
| `invite_only` | Existing identity or OAuth success alone does not create product access; a product membership or valid invite/access path remains required. Product UI shows sign-in, not open signup. |

Provider flags are separate gates: `email_password_enabled` governs password auth/sign-up and `google_oauth_enabled` governs Google auth. Neither provider bypasses `invite_only`. Product context exposes access states `invited`, `pending`, `active`, `rejected`, and `inactive`; active product-user status is the documented condition for customer/member flows that require membership.

For authorization, platform roles govern platform scope, product roles govern membership and product-local authority, and exact permission keys govern named operational capabilities. Product-scoped numeric level checks may be satisfied by an adequate product or platform role, but product-scoped permission-key checks require an explicit product-role grant; platform level alone does not imply those keys. Platform admins are not automatically product members, so platform authority does not turn them into customer-flow participants.

## Control-plane boundaries

Use `management.*` for a product’s own operational UI and `admin.*` only for platform administration. For example, customer self-service profile UI uses `profile.*`, not `management.users.*`; product request creation stays in `management.changeRequests.*`; product-wide request review and status administration use `admin.changeRequests.*`.

PM/Trello integration is an admin-only mirror under `admin.pmIntegrations.*`. ClassKit remains the canonical request store; product websites render and mutate the ClassKit request state through `management.changeRequests.*`, not Trello state. Browser code never receives Trello credentials. The documented mapping has provider statuses `todo`, `in_progress`, `blocked`, `done`, and `unknown`; these map to ClassKit request statuses `open`, `in_progress`, `in_progress`, `done`, and unchanged respectively. This is an intentional non-equivalence: `blocked` remains provider metadata while ClassKit has no `blocked` request status.

`admin.products.truncate` is a documented level-100 platform action and requires the consuming admin UI to demand exact product-key confirmation. It is not a product-management or customer-facing operation.

## Repository identity contradiction

[Repository Structure](../target-repo/docs/repositories/structure.md) says the parent documentation repository is local-only and should have no remote. Deterministic checkout evidence in `repository-identity.json` instead reports branch `master`, root `/Users/liadgoren/Repositories/class-kit`, and `origin` `https://github.com/khgs2411/class-kit.git`. The no-remote assertion is therefore conflicting or stale until repository ownership is reconciled; this subject does not rely on it to define the SDK boundary.

## Known gaps

- No implementation, migration, or regression-test evidence is included, so SDK method availability, Edge Function mappings, guards, and transition outcomes cannot be verified against runtime behavior.
- The snapshot documents broad namespace contracts but does not supply complete generated type/API inventories for every method and input/output variant.
- Full precedence and failure matrices for registration, membership entitlement, approval, capacity, and lifecycle transitions require backend/RPC source plus regression tests; the documented ordering above is not proof of every branch.
- The local-only parent-repository claim conflicts with deterministic checkout evidence and needs ownership/configuration review.
