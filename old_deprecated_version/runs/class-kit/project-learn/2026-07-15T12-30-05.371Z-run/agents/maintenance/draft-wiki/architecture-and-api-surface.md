# Architecture and supported API surface

ClassKit separates website presentation from a typed browser SDK facade and a Supabase-backed policy/state layer; websites use `@class-kit/react`, while Edge Functions and the `class_kit` schema remain the authority for product resolution, authorization, validation, and transactional changes.

## Ownership and supported boundary

The supported browser path is:

```text
frontend website -> @class-kit/react -> class-kit-* Edge Functions -> class_kit schema
```

`apps/` are local control and dogfood surfaces, not a second product API. A website owns routes, layout, copy, visual components, and interaction design. `class-kit-sdk/` owns the installable typed client, React context/provider, auth/session convenience methods, request/response normalization, and product-facing method names. `class-kit-api/supabase/` owns Edge Functions, database migrations/RPCs, RLS backstops, product resolution, policy, permission checks, validation, and state mutations. This allocation is stated in `README.md` and `docs/product-shape.md` and implemented by `class-kit-sdk/src/client/class-kit-client.ts` and `class-kit-api/supabase/functions/`.

Websites must not query ClassKit tables or RPCs directly, and must not invoke raw Edge Functions to fill a facade gap. A missing browser operation is an SDK-extension task after its backend contract is stable, not an application-specific transport escape hatch. The SDK is intentionally **not** an authorization boundary: its methods can make requests, but backend context and permission helpers make the access decision.

## Request routing and product context

`createClassKitClient` creates a Supabase client (or accepts one), maintains a product-scoped auth-storage key, and exposes a `ClassKitClient`. `invokeProductFunction` is the common transport path: it prefixes unqualified names with `class-kit-`, sends JSON to Supabase Functions, normalizes transport/empty-response failures into `ApiResponse`, and adds `x-class-kit-site-url` from the browser location.

The optional SDK `productKey` is only sent as `product_key` from a local browser origin (`localhost`, `127.0.0.1`, or `::1`). Server-side `resolveProductKeyHint` rejects that hint from non-local origins; production context is resolved from the request origin. The backend also rejects ambiguous origin matches without a permitted local hint. Thus the hint supports local development but is not website-controlled product selection in production. `product.getContext()` is the supported way to obtain the resolved product and caller/product-access context.

The context layer uses a service-role client to orchestrate product state, so every action that needs authority must use the explicit ClassKit guards in `_shared/permissions.ts`. Product-scoped numeric-level checks first check an active product role and then may fall back to platform level. Platform-scoped level checks use platform roles only. Permission-key checks use the corresponding platform or product permission helper; a high numeric role level does not imply a key grant. RLS remains a database backstop, rather than a replacement for those function checks.

## Browser SDK facade

The root `@class-kit/react` export (`class-kit-sdk/src/index.ts`) provides the client factory/types, React product context/provider, and the public API types. The public client has these namespaces:

| Namespace | Supported browser responsibility | Backend boundary |
| --- | --- | --- |
| `product` | Resolve the current product context. | `class-kit-product-context` resolves origin, identity, provider policy, and product access. |
| `auth` | Read the session; email/password sign-in/sign-up, Google OAuth, and sign-out. | Supabase owns identity/session; product signup and context/provider policy are backend-owned. Google redirect selection uses product-context redirects. |
| `profile` | Read and update the authenticated caller’s own profile/metadata. | `class-kit-profile`; no caller-supplied user ID. |
| `classes` | Customer discovery/detail, registration, and self-cancellation. | `class-kit-classes` and `class-kit-register-class` enforce visibility, eligibility, capacity, membership, policy, and cancellation rules. |
| `signupLinks` | Resolve a public signup link. | `class-kit-signup-links` scopes resolution to product context. |
| `productDocuments` | List/get published documents and accept a document. | `class-kit-product-documents`; reads are product-scoped public reads, acceptance requires active product access. Successful list/get reads are cached in memory for five minutes. |
| `management` | Current-product operational workflows. | Product-scoped functions enforce manager/custom-role capability before state changes. |
| `admin` | Platform/control-plane provisioning and cross-product operations. Inputs use explicit `productKey` where an operation is not tied to browser-resolved context. | `class-kit-admin-*` functions apply platform authority. |

`classes.list/get` return `ApiResponse` so a website can render expected domain errors. Most `management.*` and `admin.*` methods unwrap the same envelope through `callManagerApi`/`callAdminApi` and throw on API error; consumers should handle those calls as rejecting operations. The facade maps browser camelCase inputs to backend snake_case action payloads and hides function/action strings such as `classes:list`, `schedules:create_skip`, and `admin-products:update_auth_policy`.

### Operational and control-plane namespaces

`management` is deliberately capability-oriented, not a synonym for the built-in `manager` role: a custom product role can receive the relevant permissions. Its supported groups are:

- `management.classes`, `registrations`, and `attendance` for operational classes, rosters, approval/rejection, and attendance lifecycle.
- `management.templates` and `schedules` for reusable defaults, schedule preview/generation, pause/archive, and skip/unskip operations.
- `management.memberships` for types, grants, replacement/upgrade/revocation, stock adjustment, and ledger reads.
- `management.users` (including role assignment), `roles`, `signupLinks`, `productDocuments`, and `changeRequests` for product-local users, roles, links, document authoring, and feedback work.

`admin` is the platform surface: `products`, `users`, `productRoles`, `changeRequests`, and `pmIntegrations`. It covers product/origin/auth-redirect configuration, platform-admin assignment, cross-product user/role operations, review of product change requests, and Trello integration configuration/synchronization. It is not a substitute for a product website’s current-product flows.

Explicit commands are part of the public contract when they carry lifecycle, authorization, or side effects. Examples include `publish`, `draft`, `cancel`, `approve`, `reject`, `start`, `complete`, `pause`, `archive`, `deactivate`, `generate`, `skipDate`, and `unskipDate`; callers should not expect an ordinary `update` operation to conceal those transitions. The full capability-to-function map, including availability and response-shaping notes, is maintained in `docs/api/class-api-map.md`.

## Backend API and data authority

The Edge Function set is a thin server-side API layer over shared context/permission helpers and database RPCs. It includes customer/context functions (`class-kit-product-context`, `class-kit-profile`, `class-kit-classes`, `class-kit-register-class`), product operational functions (classes, templates, schedules, memberships, attendance, registration, user/role, documents, links, and change requests), and platform functions under `class-kit-admin-*`. The SDK reaches these names only through its facade; the names and action strings are implementation details for websites.

Database/RPC code owns atomic state changes and invariants; Edge Functions own caller/product resolution, permission checks, validation, orchestration, and safe response shaping. This ordering matters for user-visible outcomes: access and authentication/provider policy are established before a protected workflow proceeds; the protected workflow then evaluates its own eligibility, membership, approval, and lifecycle rules. The narrower subject pages document those domain gate orders and enum outcomes rather than redefining them here.

## Repository identity and evidence

The checkout evidence records `master` at `4f55d94506f181d179f705173ecd54606b44c90c` with the `origin` remote `https://github.com/khgs2411/class-kit.git`; see [repository identity](../state/repository-identity.json). No inspected authored document conflicts with that record.

Current implementation evidence is concentrated in `class-kit-sdk/src/client/class-kit-client.ts`, `class-kit-sdk/src/client/product-api.ts`, `class-kit-sdk/src/manager/manager-api.ts`, `class-kit-sdk/src/admin/admin-api.ts`, `class-kit-api/supabase/functions/_shared/context.ts`, and `class-kit-api/supabase/functions/_shared/permissions.ts`. SQL regression coverage directly exercises member auto-approval, pending-registration cancellation, schedule-generation backfill, and admin product truncation under `class-kit-api/supabase/tests/`.

## Known gaps

- No inspected automated contract test proves that every exported SDK facade method maps to a live Edge Function action and its current response shape; `docs/api/class-api-map.md` is the maintained map, but it is not executable coverage.
- The inspected SQL regressions cover selected transactional behavior, not the complete SDK transport/error-normalization surface or every authorization branch. Those untested facets should not be inferred as runtime-verified solely from the facade implementation.
