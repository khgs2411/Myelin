# Authorization, roles, and permission evaluation

ClassKit authorizes Edge Function actions with platform- and product-scoped roles, numeric levels, and explicit permission-key grants; product membership remains separate from platform administration.

## Model and scopes

`class_kit.permissions` is the global key catalog. A key has one of three scopes: `platform`, `product`, or `any`. Platform roles are global (`platform_roles` plus `platform_user_roles`); product roles are owned by one product (`product_roles` plus `product_user_roles`). Role-to-key joins are held separately in `platform_role_permissions` and `product_role_permissions`. The foundation migration enables RLS on all of these tables; permission helper functions are `security definer` and executable only by `service_role` ([`class-kit-api/supabase/migrations/20260612120000_permission_layer_foundation.sql`](../target-repo/class-kit-api/supabase/migrations/20260612120000_permission_layer_foundation.sql), [`20260612121000_permission_helper_functions.sql`](../target-repo/class-kit-api/supabase/migrations/20260612121000_permission_helper_functions.sql)).

Product membership is `class_kit.users`; it has a separate lifecycle from role assignment. A platform admin is not automatically a product member. That boundary is stated by ADR 0001 and is preserved by product-key evaluation: a platform assignment alone cannot satisfy a product permission key ([`docs/adr/0001-scoped-product-permission-layer.md`](../target-repo/docs/adr/0001-scoped-product-permission-layer.md)).

## Roles and active assignments

Built-in roles are seeded and protected:

| Scope | Role | Level | Default grant |
| --- | --- | ---: | --- |
| Platform | `platform_admin` | 100 | platform product/provider/origin management keys, plus `product_auth_redirects.manage` |
| Product | `manager` | 75 | the manager product-key bundle below |
| Product | `user` | 10 | no default permission-key grant |

Product roles are unique by `(product_id, key)` and may be custom. Role levels are non-negative in storage; the role-management endpoint further limits a custom role to an integer from 0 through 100. The endpoint treats `manager` as controlled (it cannot be edited or have grants changed through that API), although the stored `is_protected` flag is not itself the enforcement check in that function ([`class-kit-api/supabase/functions/class-kit-product-roles/index.ts`](../target-repo/class-kit-api/supabase/functions/class-kit-product-roles/index.ts)).

A product-user-role row is `active` or `inactive`. The partial unique index permits at most one active role per `(product_id, user_id)`; inactive historical assignments may remain. Assigning a replacement role atomically inactivates the prior active row, then activates/upserts the target. It rejects a role change that would remove the product's last active holder of `product_user_roles.manage` ([`class-kit-api/supabase/migrations/20260612124000_product_role_management_rpc.sql`](../target-repo/class-kit-api/supabase/migrations/20260612124000_product_role_management_rpc.sql)). A product assignment also requires the target to be an existing `class_kit.users` member for that product, via the composite foreign key in the foundation migration.

## Evaluation semantics and precedence

The Edge Function helpers in [`_shared/permissions.ts`](../target-repo/class-kit-api/supabase/functions/_shared/permissions.ts) are the runtime contract. Missing scope defaults to platform.

| Check | Product-role condition | Platform fallback | Result when absent |
| --- | --- | --- | --- |
| Product level, `requirePermissionByLevel(user, level, { scope: "product", productId })` | active assignment with role `level >= required_level` in that product | yes: an assigned platform role at or above the level passes | 403 `forbidden` |
| Product key, `requirePermissionByKey(user, key, { scope: "product", productId })` | active product assignment whose role has that exact key | no | 403 `forbidden` |
| Platform level/key, or omitted scope | corresponding platform role level or exact platform key | not applicable | 403 `forbidden` |

Thus numeric levels are hierarchical (`>=`), while keys are exact grants. A product-level fallback deliberately lets a platform operator pass manager-level product reads/operations without a product-membership row, but it does not turn a platform admin into a holder of product-specific keys. RPC errors produce a 500 `internal_error`, not an authorization denial. The authorization helper does not independently verify membership, approval, or resource state; action handlers must apply those gates before or after this permission decision. The catalog models four requirement types—`public`, `authenticated`, `level`, and `permission_key`—but it is declarative metadata; code guards are the execution source of truth ([`20260612122000_permission_requirement_catalog.sql`](../target-repo/class-kit-api/supabase/migrations/20260612122000_permission_requirement_catalog.sql)).

## Built-in manager permission bundle

The latest `ensure_product_builtin_roles` definition grants `manager` these product keys for newly created products. Its trigger invokes the function when a product is inserted; the later migration does not re-run that function for every existing product:

- Classes: `classes.create`, `classes.update`, `classes.cancel`, `classes.publish`, `classes.draft`, `classes.drafts.read`, `classes.extra_fields.read`, `class_signup_links.manage`.
- Product and role administration: `product.auth_mode.update`, `product_roles.manage`, `product_role_permissions.manage`, `product_user_roles.manage`, `product_managers.manage`, `product_documents.manage`, `product_change_requests.manage`.
- Users and operations: `users.read`, `users.manage`, `templates.manage`, `schedules.manage`, `memberships.manage`, `memberships.adjust_stock`, `registrations.manage`, `attendance.manage`.

Product role management accepts only catalog keys scoped `product` or `any`; it cannot grant platform-scoped keys. Assignment/list/revoke operations require `product_user_roles.manage`; custom-role creation and changes require level 75. Existing function actions use both styles: manager read/list/preview actions commonly require level 75, while mutations use their specific key (for example `classes.create`, `schedules.manage`, or `attendance.manage`). The requirement catalog captures the corresponding public/authenticated/level/key action classifications ([`20260612122000_permission_requirement_catalog.sql`](../target-repo/class-kit-api/supabase/migrations/20260612122000_permission_requirement_catalog.sql)).

## Known gaps and contradictions

- `users.metadata.manage` is inserted and granted to all existing manager roles by [`20260705094533_product_user_metadata_permission.sql`](../target-repo/class-kit-api/supabase/migrations/20260705094533_product_user_metadata_permission.sql), but the later final `ensure_product_builtin_roles` definition in [`20260707144646_product_change_requests.sql`](../target-repo/class-kit-api/supabase/migrations/20260707144646_product_change_requests.sql) omits it. Consequently, a product created after the later migration may have a manager role without the key required by `class-kit-product-users` `update_metadata`; this is a current migration-order contradiction needing repair.
- The available SQL regression test covers preservation of custom roles and their grants during product-admin truncation, not the key-versus-level fallback boundary, inactive-assignment exclusion, or the last-grant-authority invariant. Those authorization semantics are implementation-backed but lack directly located regression coverage ([`class-kit-api/supabase/tests/truncate_product_admin_action.sql`](../target-repo/class-kit-api/supabase/tests/truncate_product_admin_action.sql)).
- Some database RLS policies still use legacy role predicates such as `has_product_role(..., ['manager'])` or `is_platform_admin()` rather than the permission helpers. This page documents the Edge Function permission layer; equivalence between every RLS policy and every key guard has not been fully audited.
