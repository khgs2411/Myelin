# Product resolution, authentication, and access

ClassKit resolves a browser request to one active product before it evaluates the caller's provider, product membership, or access-entry state; the trusted `class-kit-*` Edge Functions, rather than SDK clients or direct tables, own that boundary.

## Public interface and authority boundary

The product-facing API is the `class-kit-*` Edge Function family behind `@class-kit/react`. `class-kit-product-context` is the anonymous-aware context endpoint, while `class-kit-product-signup` performs password signup; the same shared resolver is used by product profile, classes, registration, documents, and signup-link functions. Product websites should use SDK methods rather than raw functions, tables, RPCs, or a client-supplied product id. The backend API reference lists this SDK/function map and marks the Edge Functions and trusted service-role database access as `class-kit-api` ownership (`docs/api/backend-api.md`).

Every normal request is POST JSON (with OPTIONS handled for CORS). `Origin` is mandatory. `Authorization` is a Supabase JWT for signed-in operations; an anon/publishable key is accepted only to establish an anonymous context. `x-class-kit-site-url` is optional but identifies a path within the same browser origin when products share a domain. It must be an HTTP(S) URL whose origin exactly equals `Origin`; its query and fragment are discarded, and `/` becomes the bare origin. Missing `Origin`, a mismatched site URL, or an invalid site URL is rejected before product behavior is exposed (`class-kit-api/supabase/functions/_shared/cors.ts`).

## Product resolution and redirect selection

`resolveAnonymousProductContext` derives the effective site URL, resolves an active product, loads its auth policy and active auth redirects, then optionally loads the bearer-token user, active product role, and matching access entry (`class-kit-api/supabase/functions/_shared/context.ts`). Product resolution is a service-role-only database RPC: public, anon, and authenticated database roles cannot call `resolve_product_by_origin` or `resolve_product_by_key_and_origin` directly (`class-kit-api/supabase/migrations/20260629065604_preserve_pathful_product_origins.sql`).

- A configured allowed origin matches exactly. A root configured origin also matches requests below that origin; a configured path matches that path and its descendants, but not a merely similar prefix. Among matches, the longest configured origin wins.
- A production request cannot supply `product_key`: it receives `bad_request` and must use a unique allowed origin/site URL. `product_key` is a localhost-only development hint, with `CLASS_KIT_LOCAL_PRODUCT_KEY` as the server-side localhost fallback. The hint still goes through allowed-origin resolution.
- If origin-only resolution returns more than one product, the request is rejected as ambiguous; if none matches, it is `403 forbidden` (“Product is not allowed for this origin”). Thus an app cannot select another product simply by naming its key.
- `product_allowed_origins` records `development` or `production`; origins are product-owned and delete with their product. Changing or removing an origin changes which browser locations can enter the product boundary. The `add_origin` and `remove_origin` administration actions require the platform `product_origins.manage` permission (`class-kit-api/supabase/migrations/20260612122000_permission_requirement_catalog.sql`).
- Active OAuth redirect records have provider `google` or `apple`, environment `development` or `production`, an HTTP(S) URL, and an active/inactive status. For the matched allowed origin, origin-specific active redirects are returned if any exist; otherwise only active redirects with no origin are returned. A redirect is bound to an allowed origin when origin-scoped, so deleting that origin cascades to its redirects (`class-kit-api/supabase/migrations/20260628130854_product_auth_redirects.sql`, `class-kit-api/supabase/migrations/20260629103250_bind_auth_redirects_to_origins.sql`).

## Authentication policy

Each product has these policy values, introduced with defaults of `open`, email/password enabled, and Google disabled (`class-kit-api/supabase/migrations/20260612073150_product_auth_policy.sql`):

| Contract | Supported values | User-visible outcome |
| --- | --- | --- |
| `auth_mode` | `open`, `invite_only` | `open` can create a product membership at access evaluation; `invite_only` requires an applicable invited or active access entry to activate one. |
| `email_password_enabled` | `true`, `false` | An email/no-provider session is allowed only when true; when false, password signup and subsequent email-password product use receive `403 forbidden`. |
| `google_oauth_enabled` | `true`, `false` | A Google-authenticated user is allowed only when true; when false, product use receives `403 forbidden`. |
| authenticated provider | absent/`email`, `google`, or another provider | Absent/`email` follows the email toggle; Google follows the Google toggle; every other provider, including the currently modeled Apple redirect provider, is rejected as unsupported by the shared product-context guard. |

Provider availability is evaluated after origin/product resolution and before product-access activation. Successful Supabase/OAuth authentication proves only a global identity; it does not create product authorization. `class-kit-product-signup` is the password route: it requires a resolved product, `auth_mode: open`, and enabled email/password before creating the auth user/profile and assigning the `user` product role. If the role assignment fails after auth-user creation, the endpoint returns an internal error; the auth identity may already exist, so this is a partial, operator-visible consequence rather than a transactional rollback (`class-kit-api/supabase/functions/class-kit-product-signup/index.ts`).

Changing `auth_mode` is product-scoped through `product.auth_mode.update`; changing either provider toggle is platform-scoped (`product.email_password_enabled.update` and `product.google_oauth_enabled.update`). Those permissions, rather than client configuration, are the policy mutation boundary (`class-kit-api/supabase/migrations/20260612122000_permission_requirement_catalog.sql`).

## Access entries and membership activation

`product_access_entries` is a product-scoped, normalized-email gate: exactly one entry may exist per product/email and (when present) per product/user. It records a role (`manager` or `user`), source (`admin_invite` or `self_request`), status, creator/decision audit fields, and timestamps. Entries cascade when their product or referenced auth user is deleted; the access record itself is not the membership—activation assigns an active product role and then marks the entry active (`class-kit-api/supabase/migrations/20260629133541_product_access_entries.sql`, `class-kit-api/supabase/functions/_shared/context.ts`).

| Entry status | How it is reached | Access-evaluation outcome |
| --- | --- | --- |
| `invited` | An administrator invites an email, optionally as manager. | Once a matching user signs in, the entry attaches to that user and activates its stored role and status. |
| `pending` | A signed-in user without an entry reaches an invite-only product. | No membership is created; the user sees a pending access entry until an administrator decides. |
| `active` | An open product confirms an existing entry, an invited entry activates, or an administrator approves it. | The user has an active product role; entry and role reflect active access. |
| `rejected` | An administrator rejects a non-active entry. | No membership is created by access evaluation; the rejected status remains visible in product context. |
| `inactive` | A persisted lifecycle state set by administration/data handling. | No membership is activated by access evaluation; the inactive status remains visible. |

Precedence is deliberate:

1. Valid origin and allowed authenticated provider are prerequisites to every signed-in access decision.
2. An already active product role wins: context returns it without creating another membership, with a synthesized active access summary if no persisted entry exists.
3. A platform admin is never implicitly made a product user. Customer-facing access evaluation rejects that case until the admin receives explicit product membership; platform authority remains separate.
4. For `open`, a signed-in non-member receives the attached entry's role when present, otherwise `user`; the backend assigns the active role and, if there was an entry, marks it active. This can activate an invited, pending, rejected, or inactive attached entry because the open-mode branch does not filter entry status.
5. For `invite_only`, no entry creates a `pending` self-request. Only `invited` and `active` entries activate a membership; `pending`, `rejected`, and `inactive` return without one. Approval also fails with `409 conflict` until an entry has a linked signed-in user.

An administrator can invite, approve, or reject through `class-kit-admin-product-users`. Inviting an already-linked user activates the stored role immediately; approval assigns the role then marks the entry active. Rejecting an active entry is intentionally blocked: it must be deactivated through product-user membership controls instead. These state changes determine whether a person can enter customer product flows, and a role activation may immediately grant manager capabilities, so they are security-sensitive (`class-kit-api/supabase/functions/class-kit-admin-product-users/index.ts`).

## Context response and downstream gates

`class-kit-product-context` returns product policy, scoped redirects, the active product user (or `null`), the access summary (or `null`), and permission-derived dashboard flags. Signed-out callers receive policy with empty capabilities. A signed-in non-platform-admin context endpoint invokes access evaluation; a platform admin bypasses that invocation and therefore sees no implicit product membership. Product-local navigation flags are advisory—the guarded Edge Functions remain authoritative (`class-kit-api/supabase/functions/class-kit-product-context/index.ts`).

The resolution/auth/access sequence precedes downstream eligibility, membership, approval, and resource state rules. It grants only active product-user identity and role; it does not itself establish a paid membership grant, class-registration eligibility, registration approval, or any resource transition. For example, product context separately reports whether the user has an active membership grant, and profile operations require access evaluation to yield an active product user (`class-kit-api/supabase/functions/class-kit-product-context/index.ts`, `class-kit-api/supabase/functions/class-kit-profile/index.ts`). Those later gates are documented in their own subjects.

## Known gaps

The snapshot contains implementation and migration evidence for the above contracts, but no focused regression tests were located for origin matching, provider rejection, access-entry status precedence, or the signup partial-failure path. In particular, open-mode activation of a pre-existing rejected or inactive entry is current implementation behavior and lacks a dedicated test; treat any policy change there as high risk until covered.
