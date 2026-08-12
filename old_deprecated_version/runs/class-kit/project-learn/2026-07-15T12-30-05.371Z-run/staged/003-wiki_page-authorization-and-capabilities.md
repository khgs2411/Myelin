# Authorization and operational capabilities

ClassKit separates platform administration, product-local roles, and exact permission grants; the server evaluates those controls, while the SDK capability payload is a convenience for product-dashboard presentation.

## Authorization model

The permission foundation is in `class-kit-api/supabase/migrations/20260612120000_permission_layer_foundation.sql`. It creates a central permission catalog, a function/action requirement catalog, platform roles and grants, product roles and grants, and product-user role assignments. The `permissions.scope` enum permits `platform`, `product`, or `any`; the seeded/current catalog uses platform- and product-scoped keys.

`class-kit-api/supabase/functions/_shared/permissions.ts` is the Edge Function enforcement adapter. Its behavior is intentionally not a single role hierarchy:

| Gate | Succeeds when | Does not imply |
| --- | --- | --- |
| Platform level | The caller has a platform role at or above the requested level. | Any product role or product permission key. |
| Product level | The caller has an **active** role in that product at or above the requested level, **or** a platform role at or above it. | A product permission key. |
| Platform permission key | A platform-role grant contains that exact key. | A product grant, even for the same caller. |
| Product permission key | An **active** product-role assignment in that product grants that exact key. | A qualifying numeric role level or a platform grant. |

Thus product level-75 readers (for example manager class, schedule, attendance, membership, and registration views) accept a platform-admin level. Mutations such as `classes.create` and `attendance.manage` require their explicit product key and have no platform-key or level fallback. A denied helper gate produces a 403; a failed permissions RPC produces a 500 rather than treating a lookup failure as permission.

The function-requirement catalog records `public`, `authenticated`, `level`, and `permission_key` requirements. It is useful policy inventory, but the current Edge Function calls are the enforcement evidence; callers should not rely on the catalog alone.

## Roles and assignments

The built-in roles are:

| Scope | Role | Level | Assignment and effect |
| --- | --- | ---: | --- |
| Platform | `platform_admin` | 100 | Backfilled from legacy `platform_admins`; receives the platform permission bundle. |
| Product | `manager` | 75 | Created for every product and the full manager product-key bundle is inserted. |
| Product | `user` | 10 | Created for every product; no built-in product-key bundle is inserted. |

Product roles are per product and custom roles may be created with an integer level from 0 through 100 by `class-kit-product-roles`. The database permits one active product role per product user (`product_user_roles_one_active_role`); prior assignments can remain as `inactive`. Permission resolution reads only active assignments. Assignment and revocation are performed by `class-kit-product-user-roles` under `product_user_roles.manage`; revocation changes the assignment status to `inactive`.

Role management has deliberately uneven controls:

- Listing roles or the product permission catalog accepts level 75, or (only for these reads) `product_role_permissions.manage` as a fallback.
- Creating, editing, granting, or revoking a custom role's permissions requires level 75.
- The handler explicitly prevents modifications to the `manager` role, even though the schema also marks both built-ins `is_protected`. It does not use `is_protected` as a general enforcement check, so the `user` role is not equivalently protected by this handler.

The legacy `class_kit.users.role` and `status` still appear in product context/profile work, but permission resolution is through `product_user_roles`; do not treat the displayed legacy role value as an independent grant.

## Permission catalog and active built-in grants

The catalog began in `20260612122000_permission_requirement_catalog.sql` and is extended by later migrations. Product keys currently cover:

| Area | Keys |
| --- | --- |
| Classes | `classes.create`, `classes.update`, `classes.publish`, `classes.draft`, `classes.cancel`, `classes.drafts.read`, `classes.extra_fields.read`, `class_signup_links.manage` |
| Scheduling | `templates.manage`, `schedules.manage` |
| Registration and attendance | `registrations.manage`, `attendance.manage` |
| Memberships | `memberships.manage`, `memberships.adjust_stock` |
| Users and roles | `users.read`, `users.manage`, `users.metadata.manage`, `product_user_roles.manage`, `product_roles.manage`, `product_role_permissions.manage`, `product_managers.manage` |
| Product settings and operational content | `product.auth_mode.update`, `product_documents.manage`, `product_change_requests.manage` |

Platform keys are `products.manage`, `product_origins.manage`, `platform_users.manage`, `product.email_password_enabled.update`, `product.google_oauth_enabled.update`, and `product_auth_redirects.manage`.

The manager bundle is additive and is meant to include every product key above except no such grant is made to the built-in `user` role. Its practical contents depend on migration history: later migrations add newly introduced keys to existing manager roles and redefine the new-product initializer. The final initializer in `20260707144646_product_change_requests.sql` includes `product_documents.manage` and `product_change_requests.manage`, but omits `users.metadata.manage`, although the earlier metadata migration granted it. Consequently, migrated existing products may retain the metadata grant while products created after the final initializer definition do not receive it automatically.

The platform catalog has six keys, but the current migrations grant `platform_admin` only `product.email_password_enabled.update`, `product.google_oauth_enabled.update`, and `product_auth_redirects.manage`. The catalog's `products.manage`, `product_origins.manage`, and `platform_users.manage` entries have no corresponding `platform_role_permissions` insertion in the inspected migrations. Platform-admin level checks continue to protect the legacy administrative paths that use them. A platform admin is not automatically made a product user and does not acquire product permission keys merely from level 100.

## Operational endpoint patterns

Level gates protect operational reads: level 75 protects manager class/template/schedule/membership/registration/attendance reads, and level 100 protects platform inventory and platform change-request operations. Key gates protect the corresponding mutating actions: class lifecycle keys, `templates.manage`, `schedules.manage`, membership management/stock adjustment, registration and attendance management, user/role administration, documents, signup links, and change requests.

Product auth-policy updates illustrate that split in `class-kit-api/supabase/functions/class-kit-admin-products/index.ts`: changing `auth_mode` needs product level 75, while email/password and Google provider toggles each need their exact platform key. Authentication alone only establishes the caller; product access and active product-user checks in each workflow still apply before product behavior such as registration or document acceptance.

## Platform user provisioning

`admin.users.create` calls `class-kit-admin-product-users` with `create_user`. It is a platform level-100 operation: the handler first validates the caller through `requirePlatformAdminRequest`, then resolves the supplied product key. The supported requested product roles are `manager` and `user`; an omitted role defaults to `user`.

The operation creates a confirmed Supabase auth user, optionally upserts its display-name profile, and then assigns the requested product role. Duplicate-auth-user failures are mapped from the Auth Admin create response to a 409 `conflict` when its code is `email_exists`, or when a 409/422 response has a recognized duplicate-email message. It does not preflight the Auth user directory with `listUsers`.

The boundary is not atomic across Auth, profile, and product-role writes. A profile upsert failure after Auth creation, or a role-assignment failure after Auth/profile creation, returns a 500 and can leave an auth user without the intended profile or product membership. Callers must treat a successful response as the only confirmation that provisioning reached the requested product role; retry/recovery behavior for partial failures is not implemented here.

## Product-context capabilities

`class-kit-product-context` returns a sorted, de-duplicated list of product permission keys from active `product_user_roles`, plus a small dashboard projection. Anonymous callers receive an empty permission list and all dashboard booleans false. For an authenticated caller it also reports the resolved `product_user` (including legacy role/status), product-access state, and active-membership flag.

The current dashboard projection is exactly:

| Capability | True when the effective product-key list contains |
| --- | --- |
| `can_enter` | `classes.create`, `product_roles.manage`, `product_user_roles.manage`, or `product.auth_mode.update` |
| `can_manage_classes` | `classes.create` |
| `can_manage_roles` | `product_roles.manage` or `product_role_permissions.manage` |
| `can_manage_users` | `product_user_roles.manage` |
| `can_manage_auth_mode` | `product.auth_mode.update` |

This is a UI-routing summary, not an authorization decision: it excludes level-derived authority, all platform permissions, and product keys outside the five tests. A platform admin can therefore pass a product level gate while seeing an empty product capability list unless separately assigned an active product role. Every Edge Function must retain its own backend gate.

The SDK's `ProductProvider` (`class-kit-sdk/src/context/product-provider.tsx`) refreshes this server response and resets to the same empty capability shape on error; it does not calculate or elevate permissions locally.

## Evidence and known gaps

Evidence comes from the current permission helpers, product-context implementation, role endpoints, catalog/foundation migrations, and the SDK types/provider. The repository record identifies this as the `master` snapshot at `4f55d94506f181d179f705173ecd54606b44c90c` with `origin` configured; see [repository identity](../state/repository-identity.json).

Known gaps:

- No focused automated test was found for the helper precedence matrix, inactive assignment exclusion, product-context permission aggregation, or dashboard projection. Existing SQL regressions cover registration, scheduling, and truncation rather than this subject.
- The manager-initializer omission of `users.metadata.manage` makes the default bundle differ for new and already-migrated products; the repository contains no regression covering that migration-history outcome.
- The platform permission catalog declares three keys without an inspected built-in platform-admin grant. Their catalog entries and the older level-gated administrative handlers need reconciliation before they can be treated as a consistent key-based platform policy.
- `is_protected` is stored for built-ins, but the current role-management endpoint only enforces protection for the `manager` key. Whether the `user` role should be mutable is not documented or regression-tested.
- No focused regression test was found for platform `create_user`, including duplicate-email mapping and the partial-failure recovery paths between Auth, profile, and product-role assignment.
