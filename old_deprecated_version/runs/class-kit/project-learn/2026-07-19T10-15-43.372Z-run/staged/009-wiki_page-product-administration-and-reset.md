# Product administration and reset

Platform administration creates and configures ClassKit products, manages cross-product users and roles, and can irreversibly reset one product's operational state.

## Authority boundary and administrative surface

The public administrative boundary is `client.admin` in `class-kit-sdk/src/client/class-kit-client.ts`; its input/result types are defined in `class-kit-sdk/src/admin/admin-api.ts`. It invokes the `class-kit-admin-*` Edge Function family rather than exposing tables or SQL directly. The platform control surface is therefore distinct from the product-facing `management` API.

Most operations in `class-kit-api/supabase/functions/class-kit-admin-products/index.ts`, `class-kit-admin-product-users/index.ts`, and `class-kit-admin-product-roles/index.ts` require a platform-admin request. Product reset has an explicit platform-level permission requirement of level 100 in `class-kit-api/supabase/migrations/20260702120000_truncate_product_admin_action.sql`. A caller cannot use product-user or product-role changes to alter their own platform-admin authority; removal of oneself or the final platform admin is rejected. Likewise, revoking the final active assignment with `product_user_roles.manage` is rejected, preserving at least one product role-management actor.

The one narrower path is `update_auth_policy`: it requires an authenticated request, then evaluates each supplied patch independently. Changing `auth_mode` requires product scope level 75 for that product; enabling or disabling email/password requires platform permission `product.email_password_enabled.update`; enabling or disabling Google requires platform permission `product.google_oauth_enabled.update`. Supplying no policy field is rejected. Consequently, a mixed patch must satisfy every applicable guard rather than gaining authority from the least restrictive field.

## Products, origins, and sign-in policy

`admin.products` supports list, create, auth-policy update, origin add/remove, auth-redirect add/remove/default selection, and truncate. Creation requires a unique product key, name, a valid origin, and creates the initial allowed-origin row as part of setup. If initial-origin insertion fails, the newly inserted product is deleted so a partially configured product is not returned.

Current supported values and defaults are:

| Contract | Supported values | User-visible outcome |
| --- | --- | --- |
| Product status | `active`, `inactive`; default `active` | The product is created/listed with its availability status. |
| Origin environment | `development`, `production`; default `production` in the Edge Function | Origins are scoped to one of those environments. An origin must pass the shared origin validator. |
| Generation horizon | integer 1–52; default 8 | Determines the product's stored schedule-generation horizon. |
| Auth mode | `open`, `invite_only`; default `open` | The product advertises whether sign-up is open or invitation-only. |
| Email/password | boolean; default `true` on creation | Controls whether this sign-in method is enabled. |
| Google OAuth | boolean; default `false` on creation | Controls whether Google sign-in is enabled. |
| Redirect provider | `google`, `apple` | A redirect can be configured only for these provider identifiers. |

Redirect URLs must be HTTP(S). A redirect is scoped either to an existing allowed origin (using that origin's environment) or to an environment with no origin. Within a product/provider/scope, adding the first active redirect makes it default unless `is_default` is explicitly supplied; selecting a default clears the old default in that scope. Removing a default promotes the earliest remaining active redirect, if any. Removing an origin or redirect is destructive configuration removal and can make that browser origin or callback path unavailable; it does not delete the product.

## Product users, access entries, and roles

The platform admin can create an auth user and assign it the built-in `manager` or `user` role, list product users plus access entries, assign/update a product user, invite an email address, and approve or reject access entries. `create_user` creates the auth identity and then immediately assigns the selected product role (default `user`); its successful response contains both `user` and `product_user`. A duplicate identity is returned as `409 conflict` (“A user with this email already exists.”), based on the Auth Admin create response rather than a preliminary `listUsers` scan. If profile persistence or product-role assignment fails after the identity has been created, the request is `500` and the identity can remain without the requested completed setup; an operator must resolve that partial state deliberately. Product-user status supports `active` and `inactive`; access-entry status supports `invited`, `pending`, `active`, `rejected`, and `inactive`, with sources `admin_invite` and `self_request`.

An invite creates or updates an access entry. If that entry already has a linked user, activation immediately returns both the active access entry and product-user assignment; otherwise it remains an invitation awaiting a linked user. Approval calls the shared activation path. Rejection changes a non-active entry to `rejected`; active access must instead be deactivated through product-user administration. This keeps approval/access state ahead of membership assignment: an active entry can produce an active product user, while a rejected or unlinked entry cannot be activated by the rejection action.

`admin.productRoles` lists product roles and product/`any`-scoped permissions; it creates custom roles, updates a role's name and integer level (0–100), grants/revokes permissions, manages the built-in `manager` role's permissions, and assigns/revokes user roles. Custom keys must be snake_case, start with a letter, and be 2–49 characters. The role APIs filter out platform-only permissions, and role lookup always includes the selected product ID. Revocation transitions the assignment to `inactive` rather than deleting it. Role and permission edits are consequential authorization changes, but they are not an irreversible data purge.

## Reset: irreversible operational-data truncation

`admin.products.truncate({ productKey })` invokes `class_kit.truncate_product(product_id, actor_id)` through the service role. This is a reset rather than product deletion: the current administrative action vocabulary has no supported `delete_product` operation. The private SQL function serializes concurrent resets with a product-specific advisory transaction lock, verifies both product and actor exist, and restores the acting platform administrator as the product's sole active `manager` baseline before deleting product-scoped operational rows.

The reset permanently deletes the selected product's class participants, registrations, schedule skips, classes, schedules, membership ledger, grants, types, templates, access entries, all other product-user rows, and all other product-user-role assignments. It preserves the product row, allowed origins, auth redirects, product roles, role-permission grants, and the acting administrator's active manager user/role assignment. It does not touch another product's data. The confirmation UI in `apps/class-kit-admin/src/components/product-reset-panel.tsx` requires typing the product key before submitting and labels the action as removal of product-local development data; that confirmation reduces accidental invocation but does not make the database operation reversible.

`class-kit-api/supabase/tests/truncate_product_admin_action.sql` regression-tests this contract: reset rows are gone, the product/configuration/custom role grant and admin baseline remain, and a class in an unrelated product remains. This is the focused verification for destructive reset isolation.

Other destructive-looking operations have narrower semantics:

- The document-version trigger in `20260705060042_product_documents.sql` permanently prunes versions beyond the newest five for the same product/document type/locale, but only non-`published` rows; published versions are excluded.
- Admin change-request deletion is a soft delete: `class-kit-admin-product-change-requests/index.ts` stamps `deleted_at` and `deleted_by_user_id` for every row in the request thread, and normal reads exclude those rows.
- Membership type deactivation sets its status to `inactive`; membership revocation is a status/lifecycle transition through `revoke_membership`, not a reset. Archive, cancellation, and other lifecycle transitions similarly affect availability or entitlement rather than using the product-truncate path.

## Control and dogfood applications

`apps/class-kit-admin` is the deployed control panel. `src/App.tsx` presents product overview/settings, roles and permissions, users, requests, deployments, and global integrations; it consumes `@class-kit/react` at released tag `v0.1.18` according to its `package.json`. Its reset panel uses the released `client.admin.products.truncate` when present and retains a direct Edge Function fallback for the same `truncate_product` action.

The control app also exposes global Trello configuration and request-work-item actions through the SDK's `admin.pmIntegrations` surface: configuration, board snapshot/sync, connection test, work-item creation, detach, and sync. Detaching explicitly leaves the external Trello card intact. Detailed request/PM lifecycle behavior belongs in [Change requests and project-management integration](change-requests-and-pm-integration.md).

`apps/demo2` is a Vite dogfood/product example, not a product source: it pins released `@class-kit/react` `v0.1.19` and consumes the SDK's auth/product behavior. `docs/repositories/structure.md` explicitly classifies both apps as local frontend examples/control surfaces outside the ClassKit product boundary. That document's claim that the parent repository has no remote conflicts with current deterministic checkout evidence, which records an available `master` checkout and an `origin` remote; treat the authored claim as stale or needing review rather than as current repository identity ([repository identity](../../state/class-kit/repository-identity.json)).

## Evidence and known gaps

This page is implementation-grounded in the admin Edge Functions, the SDK facade, the control/demo application manifests, the reset migration, and the focused SQL reset regression test. The snapshot does not provide focused regression tests for platform-admin authorization, field-by-field auth-policy authorization, origin/redirect default selection, product-user/access transitions (including duplicate-user and partial-create outcomes), custom-role mutation safeguards, document pruning, soft-delete visibility, or PM integration behavior. It also contains no credentialed end-to-end browser smoke evidence for platform-admin or ordinary product-user flows. Those contracts are documented from current implementation and should not be treated as independently regression-verified.
