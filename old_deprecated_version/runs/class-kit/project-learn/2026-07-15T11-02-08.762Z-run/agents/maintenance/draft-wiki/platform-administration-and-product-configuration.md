# Platform administration and product configuration

Platform administration provisions products and controls their browser, authentication, membership, and reset configuration through the `class-kit-admin-products` and `class-kit-admin-product-users` Edge Functions.

## Administrative boundary

The implemented request gate is a valid bearer token whose user has platform permission level 100 (`requirePlatformAdminRequest` in `class-kit-api/supabase/functions/_shared/admin_api.ts`). The built-in protected `platform_admin` role is level 100 (`class-kit-api/supabase/migrations/20260612120000_permission_layer_foundation.sql`). Except for `update_auth_policy`, every action in both admin functions passes through this gate before dispatch.

`update_auth_policy` is intentionally different: it accepts any authenticated user first, then evaluates each supplied field separately after resolving the product.

| Requested field | Runtime authorization | Result |
| --- | --- | --- |
| `auth_mode` | `product.auth_mode.update` in the target product at level 75 or above; the level helper also permits a platform role at that level | Changes signup mode only. |
| `email_password_enabled` | platform permission `product.email_password_enabled.update` | Enables or disables email/password sign-in for the product. |
| `google_oauth_enabled` | platform permission `product.google_oauth_enabled.update` | Enables or disables Google OAuth for the product. |

At least one of those fields is required. Supported auth modes are `open` and `invite_only`; the two provider flags are booleans. The product itself has `active` or `inactive` status and a `generation_horizon_weeks` integer from 1 through 52. Provisioning defaults are `active`, 8 weeks, `open`, email/password enabled, and Google OAuth disabled (`class-kit-api/supabase/functions/class-kit-admin-products/index.ts`).

The `function_permission_requirements` catalog contains narrower, product-scoped entries for several administration actions, including product-user assignment and origin changes (`20260612122000_permission_requirement_catalog.sql`). Those entries are not consulted by these handlers: current code still calls the platform-admin gate first. Treat the catalog entries as conflicting/stale authorization metadata until the handlers and catalog are reconciled.

## Provisioning and product inventory

`create_product` requires non-empty `product_key`, `name`, and `origin`. It creates the product and then its initial allowed-origin record. If origin insertion fails, the handler deletes the newly inserted product and reports a conflict, so a successful response has both records. Duplicate keys or an origin conflict are reported as `409`.

`list_products` returns products with their allowed origins and auth redirects. `product_key` is unique; each allowed origin is unique within its product (`product_id, origin`). The older global origin uniqueness index was explicitly dropped in `20260612061409_allow_shared_origin_product_hints.sql`, so the schema permits the same configured origin for multiple products.

## Origin resolution and browser configuration

Allowed origins are `http` or `https` URLs. Administrative normalization removes query strings and fragments; a root URL is stored as its URL origin, while a pathful URL is retained. An origin record is labelled `development` or `production`, defaulting to `production` for admin writes.

Product context resolution considers only active products. A root origin matches the root request origin and requests below it; a pathful origin matches that path or its descendants. The longest matching configured origin wins. When the request does not nominate a product and the longest match is shared by more than one product, context resolution rejects it as ambiguous; local development can use `CLASS_KIT_LOCAL_PRODUCT_KEY` to disambiguate. No match produces `403 Product is not allowed for this origin.` (`_shared/context.ts` and `20260629121334_root_origin_matches_paths.sql`).

`add_origin` upserts a product-origin pair. `remove_origin` deletes that pair. Removing an origin cascades deletion of redirects bound to that origin through the `(product_id, origin)` foreign key. The handler itself does not require an origin to remain, so an administrator can leave a product without allowed origins; it will then be unreachable through product-context resolution.

## OAuth redirect configuration

Redirect providers are `google` and `apple`; redirect environments are `development` and `production`; redirect status is `active` or `inactive` at the schema boundary. The current admin actions only create or reactivate `active` redirects. Redirect URLs must be `http` or `https`; root URLs are normalized to remove the trailing slash.

A redirect can be bound to an allowed origin or can be an environment-scoped fallback (`origin: null`). Supplying an origin to add, remove, or select a default first verifies that it is an allowed origin for that product; its stored environment then controls the redirect row. Bound redirects take precedence for the matched request origin. If none exist for that origin, product context returns only unbound fallback redirects; it never blends origin-specific and fallback lists.

For a product/provider/scope, the first active redirect becomes default unless `is_default` is explicitly supplied. Adding or selecting a default clears the prior default in that scope. Removing the default promotes the oldest remaining active redirect in the same scope. Database partial unique indexes enforce at most one active default for each `(product, provider, bound origin)` and for each `(product, provider, environment)` fallback scope (`20260629103250_bind_auth_redirects_to_origins.sql`).

## Product users, access decisions, and platform administrators

All actions below currently require the platform-admin request gate, even though some catalog metadata describes them as product-scoped.

`create_user` creates an Auth user and profile, then assigns it to the named product as `manager` or `user` (default `user`) with an active role assignment. Duplicate-email detection is delegated directly to Supabase Auth `admin.createUser`; recognized duplicate errors map to `409 conflict`, rather than scanning `auth.admin.listUsers`. If profile or membership assignment fails after Auth-user creation, it returns an error but does not roll back the Auth user; this is an operational recovery case ([`_shared/auth_users.ts`](../target-repo/class-kit-api/supabase/functions/_shared/auth_users.ts), [`class-kit-admin-product-users/index.ts`](../target-repo/class-kit-api/supabase/functions/class-kit-admin-product-users/index.ts)).

`assign_product_user` and `update_product_user` operate on product membership. Roles are `manager` or `user`; status is `active` or `inactive`. Active role assignment uses the role system; inactive assignment writes the legacy `users` membership row. A platform administrator cannot use these product-membership actions to mutate their own authority. The underlying membership trigger also prevents removal or deactivation of a product's last active manager (`20260607112136_product_role_foundation.sql`).

The access-entry state machine records a normalized email, optional Auth user, role, source, and decision. Its supported values are:

| Contract | Values and outcomes |
| --- | --- |
| Source | `admin_invite` is created or refreshed by `invite_product_user`; `self_request` is created when an invite-only user without an entry asks for access. |
| Status | `invited` activates when the user is attached; `pending` waits for explicit approval; `active` has product membership; `rejected` is denied; `inactive` is representable but is not produced by these admin decision actions. |
| Approval | `approve_product_access` activates the entry only after it has a `user_id`; otherwise it returns `409`. Activation assigns the entry's role and marks it active. |
| Rejection | `reject_product_access` marks a non-active entry rejected. An active entry must instead be deactivated through product-user mutation. |

In `open` mode, an authenticated non-member is assigned immediately, using any attached access entry's role or `user` by default; an attached entry is marked active. In `invite_only` mode, no entry creates a pending self-request, while an attached `invited` or `active` entry activates immediately. Existing `pending`, `rejected`, or `inactive` entries do not grant membership. Platform admins are deliberately excluded from this self-service path and must be explicitly assigned product membership (`_shared/context.ts`).

`add_platform_admin` maintains both the legacy `platform_admins` compatibility row and the `platform_user_roles` assignment to `platform_admin`. `remove_platform_admin` refuses self-removal and refuses to remove the last user holding that role; otherwise it deletes both records.

## Product truncation/reset

`truncate_product` is a platform-admin-only reset action. The RPC takes the product and acting admin IDs, serializes concurrent resets with a transaction advisory lock, confirms that both exist, and ensures builtin product roles. It then establishes exactly one active manager membership and role assignment for the acting admin, deleting other product-user roles.

The reset deletes the target product's participants, registrations, schedule skips, classes, schedules, membership ledger and grants, membership types, templates, access entries, and non-admin membership rows. It preserves the product record, allowed origins, auth redirects, product roles and role permissions, and the acting admin's manager baseline. The SQL regression test also verifies that another product's data remains untouched (`class-kit-api/supabase/tests/truncate_product_admin_action.sql`).

## Known gaps

- There is direct SQL regression coverage for truncation, but no located automated handler-level coverage for the admin Edge Function authorization split, origin deletion behavior, redirect-default repair, or access-entry transitions.
- `inactive` redirect and access-entry statuses are schema-supported but are not exposed as explicit transition actions in the inspected handlers; the operational path for setting them needs confirmation.
- The runtime uses configured origins as path-prefix match rules even though browser `Origin` headers normally contain only scheme, host, and port. The intended client/header contract for pathful values should be verified with integration coverage.
