# Administrative control plane

The administrative control plane provisions products and manages their browser/authentication configuration, product access records, platform administrators, and an irreversible product-data reset through the `class-kit-admin-products` and `class-kit-admin-product-users` Edge Functions.

## Boundary and authorization

Both functions are configured with `verify_jwt = false`, but their handlers authenticate the bearer token with Supabase (`class-kit-api/supabase/config.toml`, `class-kit-api/supabase/functions/_shared/admin_api.ts`). Missing or invalid tokens receive `401`.

With one exception, every supported action in these two handlers requires platform permission level 100 through `requirePlatformAdminRequest`; this is the current runtime gate, not merely a metadata declaration. The exception is `update_auth_policy`, which accepts any authenticated user first and then applies field-specific permissions:

| Requested field | Required current permission | Scope | Effect |
| --- | --- | --- |
| `auth_mode` | level 75 | product | Update product sign-up policy. The level checker also accepts a qualifying platform-level role. |
| `email_password_enabled` | `product.email_password_enabled.update` | platform | Enable or disable email/password sign-in. |
| `google_oauth_enabled` | `product.google_oauth_enabled.update` | platform | Enable or disable Google sign-in. |

When a request changes more than one field, every applicable check must pass before the update is issued. Requests with none of these fields are rejected with `400`; an unknown product is `404`.

The `function_permission_requirements` seed in `20260612122000_permission_requirement_catalog.sql` describes some actions as permission-key or product-scoped operations (for example product creation and user assignment). That metadata conflicts with the currently checked handler boundary, which requires platform level 100 for those actions. This page treats the runtime handler as authoritative; the catalog should be reconciled or explicitly marked as descriptive-only.

## Product provisioning and origin routing

`create_product` requires non-empty `product_key`, `name`, and `origin`; it creates the product and its first allowed origin. Defaults are `status: active`, `generation_horizon_weeks: 8`, `auth_mode: open`, `email_password_enabled: true`, and `google_oauth_enabled: false`. A duplicate product key or an origin insert conflict is reported as `409`; if initial origin insertion fails after the product insert, the handler deletes that newly inserted product.

The product configuration contracts are:

| Contract | Supported values and validation | User-visible outcome |
| --- | --- | --- |
| Product status | `active`, `inactive` | Product-origin resolution requires `active`; inactive products do not resolve. Product creation accepts either value, but the products handler has no status-update action. |
| Origin environment | `development`, `production`; omitted value defaults to `production` in this handler | Stored with each allowed origin and used as the fallback redirect scope when no origin is supplied. |
| Origin URL | HTTP/HTTPS only; query and fragment are removed; root paths normalize to the URL origin while non-root paths are retained | An origin can be added/removed only by the platform-admin handler. Current schema permits the same origin for multiple products, so callers should supply the product key where resolution otherwise could be ambiguous. |
| Generation horizon | integer 1–52; default 8 | Stored for product schedule generation. |

`list_products` returns the product settings together with allowed origins and auth redirects. `add_origin` is idempotent for an existing `(product_id, origin)` pair; `remove_origin` deletes that pair. Removing an origin cascades deletion of redirects bound to it through the origin foreign key (`20260629103250_bind_auth_redirects_to_origins.sql`).

## Access policy and product admission

The product `auth_mode` controls admission after the user is authenticated and their sign-in provider is allowed. Supported values are:

| Mode | No existing product access record | `invited` or `active` record | `pending`, `rejected`, or `inactive` record |
| --- | --- | --- | --- |
| `open` | Creates active product membership with role `user` | Creates/updates membership using the record's role, then marks access active | Also creates/updates membership using that record's role, then marks access active. |
| `invite_only` | Creates a `pending` self-request; no product membership | Activates the record and creates/updates membership using its role | Leaves the record and no product membership. |

This behavior comes from `ensureProductAccess` in `class-kit-api/supabase/functions/_shared/context.ts`. Access precedence is: authenticated user is required; platform administrators are then rejected until explicitly assigned product membership; an existing active membership wins; otherwise access-entry lookup/attachment precedes the `auth_mode` branch. In the invite-only branch, the access-record status is the final approval gate. Thus a rejected or inactive record does not become a member merely by signing in, while an open product does activate it.

Product access records have `role: manager|user`, `status: invited|pending|active|rejected|inactive`, and `source: admin_invite|self_request` (`20260629133541_product_access_entries.sql`). There is one record per product/email and, once attached, one per product/user.

The product-user admin actions use these transitions:

- `invite_product_user` lowercases the email and defaults role to `user`. It creates `invited/admin_invite`, or revises a non-active existing record to `invited`; an existing active record remains active. If the record is already attached to a user, it activates product membership immediately.
- `approve_product_access` requires an attached user. It assigns the recorded role, changes status to `active`, and records the deciding administrator. Approving an invitation before that person signs in fails with `409`.
- `reject_product_access` changes any non-active record to `rejected` and records the decision. Active access cannot be rejected here (`409`); it must instead be deactivated through the product-user path.
- `assign_product_user` and `update_product_user` accept roles `manager|user` and statuses `active|inactive`. An active assignment uses a built-in role key or supplied role ID; an inactive assignment upserts the legacy product-user row directly. Neither action may mutate the caller's product membership when the target is the caller, preventing that route from changing the caller's platform authority.

Authentication-provider eligibility happens before these admission rules for a context request: email/no provider needs `email_password_enabled`; Google needs `google_oauth_enabled`; all other providers are forbidden. Consequently provider eligibility blocks access processing, and authentication blocks it before provider eligibility.

## Auth redirect setup

Product redirects support providers `google` and `apple`, statuses `active` and `inactive`, and either an origin-bound scope or an environment-wide fallback scope. URLs must be HTTP/HTTPS; root redirect URLs normalize to an origin. If an `origin` is specified, it must be an allowed origin for that product and its stored environment becomes the redirect scope; otherwise `environment` is required/defaulted to `production` and `origin` is null.

For each product/provider/scope, at most one active redirect can be default (partial unique indexes in `20260629103250_bind_auth_redirects_to_origins.sql`). `add_auth_redirect` creates active redirects and defaults the first active redirect in a scope unless `is_default` is explicitly false; setting a new default clears the old default in that scope. `set_default_auth_redirect` also reactivates the selected redirect. After deletion, the oldest active redirect in the same scope becomes default, if one remains. Origin-bound defaults are independent from environment-wide fallback defaults.

The platform-app migration also seeds separate `class-kit-admin` redirect/origin configuration, including production and local development origins (`20260702093741_platform_app_auth_redirects.sql`). Those platform-app tables are not managed by the two product-admin handlers documented here.

## Platform administrator safeguards

`add_platform_admin` writes both the compatibility `platform_admins` row and the `platform_admin` platform role. `remove_platform_admin` removes both, but refuses to remove the caller's own authority and refuses when it would remove the final platform administrator. This is distinct from product membership: a platform administrator must still receive an explicit product membership before using product-context access.

## Product reset (`truncate_product`)

`truncate_product` is a platform-level-100 operation. It invokes a service-role-only, transaction-scoped advisory-lock function (`class-kit-api/supabase/migrations/20260702120000_truncate_product_admin_action.sql`) that first verifies the product and acting auth user, then restores the actor as the product's sole active `manager` role assignment.

It deletes only data scoped to the selected product: class participants and registrations, schedule skips, classes and schedules, membership ledger/grants/types, templates, product access entries, and every other product user/role assignment. It retains the product itself, allowed origins, auth redirects, product roles and role permissions, and the acting administrator's active manager baseline. It does not delete records belonging to another product. The SQL regression test `class-kit-api/supabase/tests/truncate_product_admin_action.sql` verifies these deletion, preservation, and isolation invariants.

## Known gaps

- The supplied regression coverage verifies the SQL reset function directly, not the Edge Function's bearer-token/level-100 gate or its RPC error mapping.
- No focused automated tests were found for product provisioning, origin removal cascading redirects, redirect default replacement/fallback, or the documented access-entry transitions; these behaviors are grounded in current implementation and migrations.
- `ProductAuthProvider` includes `apple` for redirect configuration, while product authentication eligibility currently accepts only email and Google in `assertProductAuthProviderAllowed`; whether Apple redirect configuration is intentionally pre-provisioned but unusable needs review.
