# Product resolution, authentication, and access

ClassKit selects an active product from the request site, then applies sign-in-provider policy before it evaluates product membership or access-entry state.

## Scope and evidence

This page describes the checkout identified as `class-kit` on `master` at `4f55d94506f181d179f705173ecd54606b44c90c`; the registered remote is `https://github.com/khgs2411/class-kit.git` (`repository-identity.json`). The behavior below is from current Edge Function and migration code, not the historical design documents.

## Product resolution

Every product-context request needs an `Origin` header. `x-class-kit-site-url` is optional, but if supplied it must be an HTTP(S) URL with the same origin; its query and fragment are removed and its non-root path becomes the requested site URL (`class-kit-api/supabase/functions/_shared/cors.ts`). This permits a registered path such as `https://host/app` to resolve requests beneath that path, while a host-only configured origin matches requests with a trailing path.

Only products with `products.status = 'active'` resolve. Resolution uses the longest matching allowed origin from `product_allowed_origins`; an exact match also works. The current SQL functions implement this matching in `class-kit-api/supabase/migrations/20260629065604_preserve_pathful_product_origins.sql` (superseding the earlier exact-origin implementation). An unmatched origin is `403 forbidden`. When an unhinted local/shared origin matches more than one product, context resolution returns `400 bad_request` rather than choosing one (`_shared/context.ts`).

`product_key` is a development-only disambiguator:

- For `localhost`, `127.0.0.1`, or IPv6 loopback, the request body key is used; if absent, `CLASS_KIT_LOCAL_PRODUCT_KEY` is used.
- For every other origin, a supplied request key is rejected with `400`; without it, resolution is by origin alone.

The database permits `development` and `production` as allowed-origin environments (`20260607112136_product_role_foundation.sql`). The runtime resolver does not use that field to admit or reject a request; it returns the best matched origin so redirects can be scoped correctly.

## Authentication policy and redirect configuration

The product policy has exactly two access modes and two provider switches (`20260612073150_product_auth_policy.sql`):

| Contract | Supported values | Runtime outcome |
| --- | --- | --- |
| `auth_mode` | `open`, `invite_only` | `open` can automatically create product membership for an authenticated non-platform-admin; `invite_only` requires a matching invited or active access entry before membership is activated. |
| `email_password_enabled` | boolean | An email/no-provider session is rejected with `403` when false; password signup is also rejected. |
| `google_oauth_enabled` | boolean | A Google session is rejected with `403` when false. |
| observed auth provider | `email`, `google`, or another provider string | Missing provider is treated as email. Any provider other than email or Google, including Apple, is rejected with `403` regardless of redirect configuration. |

An absent bearer token is allowed only for anonymous context; a bearer token equal to the Supabase anon/publishable key is likewise anonymous. A required authenticated context without a bearer token, or any non-public invalid bearer token, returns `401` (`_shared/context.ts`). Provider policy is evaluated after product resolution and user loading, but before access-entry or membership handling.

The separate `product_auth_redirects` table supports redirect providers `google` and `apple`, environments `development` and `production`, statuses `active` and `inactive`, and `is_default` (`20260628130854_product_auth_redirects.sql`). The context endpoint returns all active redirects for the matched configured origin if any exist; otherwise it returns active product-wide redirects whose `origin` is null. It orders them by default first, then creation time; it does not select one redirect itself. Origin-bound redirects must reference an allowed origin (`20260629103250_bind_auth_redirects_to_origins.sql`). Thus Apple redirect records can be administered and returned, but the current shared provider gate still rejects an Apple-authenticated user.

Product creation defaults to `open`, email/password enabled, and Google OAuth disabled. Updating `auth_mode` requires product permission level 75; changing either provider switch requires its named platform permission (`class-kit-api/supabase/functions/class-kit-admin-products/index.ts`).

## Product-access lifecycle

`product_access_entries` is the durable access-request/invitation record. It is unique per product/email (and also per non-null product/user), normalizes email at the database boundary, and supports roles `manager` and `user`; sources `admin_invite` and `self_request`; and statuses `invited`, `pending`, `active`, `rejected`, and `inactive` (`20260629133541_product_access_entries.sql`).

For an authenticated caller, `ensureProductAccess` applies this precedence (`class-kit-api/supabase/functions/_shared/context.ts`):

1. A platform administrator is never automatically made a product member; direct `ensureProductAccess` rejects this case. The product-context endpoint intentionally skips that call for platform admins, so it can report their existing product user/access state and permissions without auto-provisioning membership.
2. An existing active product-role assignment wins over every access-entry state. The function returns it immediately; if there is no entry, it synthesizes an `active` self-request summary only for the response.
3. Otherwise, it finds an access entry by normalized email first and then by user ID, attaching the current user ID to a matched entry.
4. In `open` mode, it assigns the entry's role when present (otherwise `user`) and activates any matched entry. This means `pending`, `rejected`, and `inactive` entries do not block automatic open-mode membership.
5. In `invite_only` mode, no entry creates a `pending` `self_request` entry and no membership. Only `invited` and `active` entries activate membership; `pending`, `rejected`, and `inactive` remain non-members.

Activation requires a linked user ID, assigns the access entry's role through the current product-role system, then records `active`, `decided_by`, and `decided_at`. Attempts to approve an entry before its invited user has signed in return `409 conflict`.

Administrative actions give the status values these additional transitions (`class-kit-api/supabase/functions/class-kit-admin-product-users/index.ts`):

- `invite_product_user` creates `invited/admin_invite`, or changes a non-active existing entry to `invited/admin_invite`; an existing active entry stays active. If the entry already has a user ID, it is activated immediately.
- `approve_product_access` activates the selected entry without a status precondition, so it can approve pending, rejected, or inactive records once a user ID exists.
- `reject_product_access` changes any non-active entry to `rejected`; it refuses to reject active access (`409`) and directs deactivation through product-user management instead.

The standalone `class-kit-product-signup` function has a narrower path: it resolves the product, requires `open` plus `email_password_enabled`, creates an auth user, and directly assigns the `user` role. It does not create a `product_access_entries` record.

## Known gaps

- The snapshot has no regression test for origin matching, local product hints, provider gates, redirect scoping, or the access-entry state precedence. The four SQL regression scripts cover unrelated registration, schedule, and product-truncation behavior.
- `inactive` is a valid access-entry status, but the current administrator functions shown here do not create it or provide a dedicated transition into it; its runtime effect is only verifiable through `ensureProductAccess`.
- The redirect schema supports Apple while the runtime provider gate supports only email and Google. This is an implementation-level mismatch needing product review before Apple sign-in is considered available.
- The active-access deactivation direction is not confirmed by the inspected implementation: `update_product_user` changes the legacy `users.status`, whereas membership lookup reads active `product_user_roles` rows. No synchronization trigger or regression test was found, so this should not be treated as a verified revocation path.
