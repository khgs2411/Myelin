# Architecture and public boundary

ClassKit is a Supabase-backed, multi-product class and membership platform whose supported browser contract is `@class-kit/react` calling `class-kit-*` Edge Functions; those functions resolve product scope and perform trusted work against the `class_kit` schema.

## Repository identity and roles

The checked-out repository is `class-kit` on `master` at `4f55d94506f181d179f705173ecd54606b44c90c`, with origin `https://github.com/khgs2411/class-kit.git` (`repository-identity.json`). This deterministic checkout evidence agrees with the root README's product description.

The durable product split is:

| Area | Owns | Does not own |
| --- | --- | --- |
| `class-kit-sdk/` | Published `@class-kit/react` package, React provider/hooks, typed namespaces, method names, transport invocation, and response normalization. | Authorization or direct product-state policy. |
| `class-kit-api/` | Supabase migrations, `class_kit` and `class_kit_private` database behavior, Edge Functions, origin/product resolution, authorization, validation, RPC orchestration, and service-role access. | Browser UI. |
| `apps/` | Local control and dogfood UI surfaces. | A second product API or an alternate data-access contract. |

This is the repository's stated boundary in `README.md`, reinforced by `docs/api/class-api-map.md` and `docs/api/backend-api.md`: applications should use the SDK facade, not raw Edge Function names or table/RPC calls. The SDK is deliberately not a security layer; function guards and database constraints/RLS are the enforcement layers.

## Approved browser-to-backend path

```text
browser app
  -> @class-kit/react (`createClassKitClient`, optional `ProductProvider`)
  -> Supabase Functions transport
  -> `class-kit-*` Edge Function
  -> shared context, authentication, permission checks, and domain validation
  -> service-role client configured for `class_kit`
  -> `class_kit` tables and transactional RPCs
```

`class-kit-sdk/src/client/product-api.ts` is the common function transport. It prefixes supplied names with `class-kit-`, invokes `supabase.functions.invoke`, adds the browser site header, conditionally adds a local-development product key, and normalizes transport/empty-response failures into the documented `ApiResponse<T>` envelope. `class-kit-sdk/src/client/class-kit-client.ts` exposes the product-facing groups (`product`, `profile`, `classes`, `management`, and `admin`) rather than exposing Supabase function calls to application code. `ProductProvider` refreshes resolved product context after session changes and provides the resulting product, product-user, access, and capability state to React consumers (`class-kit-sdk/src/context/product-provider.tsx`).

Function names are an implementation detail behind that facade. For example, `classes.list()` invokes `class-kit-classes` with `action: "list"`; `management.classes.*` uses the same function with management actions. The living cross-layer inventory is `docs/api/class-api-map.md`; the backend action-to-facade map is `docs/api/backend-api.md`.

### Request boundary

All current Edge Functions use POST JSON and answer OPTIONS preflight (`class-kit-api/supabase/functions/_shared/cors.ts`). A browser request carries:

| Input | Boundary role |
| --- | --- |
| `Origin` | Required. Missing origins are rejected before product resolution. |
| `Authorization` and `apikey` | Supabase identity for authenticated requests, or publishable/anon-key transport for anonymous-safe functions. |
| `x-class-kit-site-url` | SDK-provided HTTP(S) URL; if present, it must have the same origin as `Origin`. Its path distinguishes products sharing one browser origin. Query and fragment are discarded. |
| `product_key` body hint | Development-only disambiguator. It is accepted only for localhost origins, then still matched against allowed origins. It is rejected for non-local origins. |

The current CORS helper reflects the request origin and permits POST/OPTIONS, but CORS is not the product authorization mechanism. Product resolution in `_shared/context.ts` requires the origin/site URL to match an active product's configured allowed origin. A root configured origin may match child paths; a configured path matches that path subtree, with the longest matching configured origin selected. If a production origin resolves to more than one product without a local-only hint, the backend fails as ambiguous. An unmatched origin fails with `forbidden`.

### Product-context gate order

For ordinary product functions, the shared context pipeline is:

1. Validate method/body and resolve the site URL from headers.
2. Resolve an active product by allowed origin/site URL; optionally apply the localhost-only key hint.
3. Load the product's auth policy and redirects scoped to the matched allowed origin.
4. Resolve an optional or required Supabase Auth user from the bearer token.
5. Reject an authenticated user whose provider is disabled by the resolved product policy.
6. Load product-role membership and product-access state; functions then apply the action-specific membership, level, or permission-key guard.

This ordering means a caller cannot choose another production product by passing a key, and a valid global Supabase identity is not by itself product membership or permission.

## Public contracts that shape the boundary

### Product access and provider policy

`auth_mode` has two supported values (`_shared/context.ts`; `docs/api/backend-api.md`):

| Mode | Signed-in caller with no active product membership | Precedence and outcome |
| --- | --- | --- |
| `open` | The backend creates/loads an active product-role assignment. An existing access entry can supply its role; otherwise the role is `user`. | Origin resolution and provider availability must pass first. |
| `invite_only` | No access entry creates a `pending` self-request. An `invited` or `active` entry is activated into product membership. Other existing states remain non-membership states. | A global Auth session and OAuth success do not bypass product access. A function requiring product membership then returns forbidden until membership exists. |

Provider availability is evaluated after product resolution for authenticated users: email/no provider requires `email_password_enabled`; Google requires `google_oauth_enabled`; any other provider is rejected. The product-context endpoint is anonymous-aware: signed-out callers receive product policy and empty capabilities, while signed-in callers receive the resolved `product_user`, `product_access`, and effective product capabilities (`class-kit-product-context/index.ts`). Platform administrators are not implicitly product members; `ensureProductAccess` requires an explicit product assignment before they can act in product-member flows.

Password sign-up is intentionally a backend operation: `client.auth.signUp()` calls `class-kit-product-signup`, which enforces product resolution, `open` access mode, and email/password enablement before creating the auth identity and membership. The SDK calls Supabase Auth directly for password sign-in/out and Google OAuth redirect initiation, but later product authority remains backend-resolved.

### Authorization ownership

The SDK can expose capability flags for navigation, but it does not decide access. Edge Functions call `requireProductContext`, `requirePermissionByLevel`, `requirePermissionByKey`, or platform-admin helpers before sensitive actions; representative current functions include `class-kit-classes`, `class-kit-manage-registrations`, `class-kit-attendance`, `class-kit-schedules`, and the `class-kit-admin-*` functions. Database migrations also use RLS and service-role-only grants for core tables/RPCs, for example `20260607112136_product_role_foundation.sql` and `20260607160000_registration_engine.sql`.

The relevant scopes are distinct:

| Scope | Intended SDK surface | Backend authority |
| --- | --- | --- |
| Customer/product | `product.*`, `profile.*`, `classes.*`, public signup/document reads | Resolved product, then access/membership and resource policy. |
| Product operations | `management.*` | Resolved product plus product permission key or level guard. Custom roles may receive management permissions. |
| Platform/control plane | `admin.*` | Authenticated platform authority; calls may use explicit `productKey` because this work can operate outside browser-resolved product context. |

Permission level inheritance and explicit permission keys are intentionally different: a product-scoped level check may accept qualifying platform authority, but a product-scoped key check needs that explicit product key. This prevents the SDK namespace and a broad platform role from becoming an accidental blanket product-permission grant (`docs/api/backend-api.md`).

## Database boundary: supported path versus technical exposure

The supported public contract is still SDK → Edge Function. It should not be described as a complete network prohibition on direct browser database access:

- `supabase/config.toml` exposes `class_kit` through the local Supabase API configuration.
- Current migrations enable RLS and deliberately allow narrowly scoped direct reads, including published, non-cancelled public classes for anon/authenticated callers (`20260702121000_public_class_discovery_non_cancelled.sql`).
- Trusted Edge Functions use `SUPABASE_SERVICE_ROLE_KEY` and select `db: { schema: "class_kit" }` in `getServiceClient()` (`_shared/context.ts`); service-role credentials remain server-only.

Therefore, direct reads permitted by RLS may be technically possible, but they are not an approved application integration surface and do not substitute for function-level product resolution, response shaping, state transitions, or authorization. Product applications must not rely on them, call raw RPCs, or invoke raw functions to bypass a missing SDK method. Extend the SDK facade first, as required by `docs/api/class-api-map.md`.

## Known gaps

- The snapshot contains four SQL regression scripts—member auto-approval, pending-registration cancellation, schedule-generation backfill, and product truncation—but no discovered browser-to-SDK-to-Edge-Function integration test that verifies the whole approved path. This page's transport and guard claims are grounded in current source and migration evidence, not an end-to-end deployed verification.
- CORS and origin-resolution implementation are source-verified, but this snapshot does not include an automated adversarial test matrix for forged/missing `Origin`, mismatched `x-class-kit-site-url`, ambiguous shared origins, or non-local `product_key` rejection. Those cases should remain explicitly covered when the boundary changes.
- `docs/api/backend-api.md` remains the broad action inventory. This subject intentionally does not re-document every action's state-machine and eligibility outcome; those belong to the lifecycle, access, and authorization subjects.
