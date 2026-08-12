# Authorization And Role Grants

ClassKit authorizes platform and product operations through database-backed role assignments, numeric levels, and explicit permission keys; browser capability flags are convenience hints and do not replace Edge Function enforcement.

## Scope and precedence

Supabase Auth establishes a global identity, while ClassKit owns the authorization decision for the resolved product or the platform. The supported browser boundary is `@class-kit/react`; websites should not call Edge Functions or decide their own authorization ([docs/product-shape.md](../target-repo/docs/product-shape.md), [docs/api/backend-api.md](../target-repo/docs/api/backend-api.md)).

For a protected product operation, the backend first resolves the product/origin and identity, then applies provider and product-access policy, then product membership where that flow requires it, and finally the action's level or key guard. Eligibility and resource-state rules are enforced by the operation itself after authorization. A service-role Edge Function still performs these ClassKit checks because service-role database access bypasses ordinary RLS ([docs/product-shape.md](../target-repo/docs/product-shape.md); [class-kit-api/supabase/functions/_shared/permissions.ts](../target-repo/class-kit-api/supabase/functions/_shared/permissions.ts)).

`class_kit.users` remains the product-membership compatibility table, while `class_kit.product_user_roles` holds active/inactive role assignments. An assignment requires a corresponding product-user row and the schema permits one active role per product user. Assigning a custom role records `user` in the compatibility row; only the built-in `manager` role records `manager` there ([class-kit-api/supabase/migrations/20260612120000_permission_layer_foundation.sql](../target-repo/class-kit-api/supabase/migrations/20260612120000_permission_layer_foundation.sql); [class-kit-api/supabase/functions/_shared/context.ts](../target-repo/class-kit-api/supabase/functions/_shared/context.ts)).

Platform admins are deliberately not implicit product users. In customer-facing product access, an unassigned platform admin is rejected until explicitly assigned product membership. In contrast, a product-scoped **level** guard may be satisfied by a platform role at the required level, allowing deliberately level-gated administration without customer membership. Product-scoped **key** guards never fall back to platform level or platform grants ([docs/adr/0001-scoped-product-permission-layer.md](../target-repo/docs/adr/0001-scoped-product-permission-layer.md); [class-kit-api/supabase/functions/_shared/context.ts](../target-repo/class-kit-api/supabase/functions/_shared/context.ts)).

## Levels and role model

| Role or role type | Scope | Level | Supported outcome |
| --- | --- | ---: | --- |
| `platform_admin` | platform | 100 | Platform operator role. Satisfies platform level guards at 100 or lower, and can satisfy product level guards at 100 or lower; it does not create product membership or product-key authority. |
| `manager` | product | 75 | Built-in protected product role. It carries the default operational permission bundle. |
| `user` | product | 10 | Built-in protected product role with no default explicit grants. |
| Custom product role | one product | 0–100 | A manager-level actor may create it and set an integer level. Its authority comes from its level plus its explicitly attached product/`any` permissions. |

Platform roles are global (`platform_user_roles`); product roles and assignments are scoped to a product. Product roles use a per-product unique key. The public product-role API does not let callers update the built-in `manager` role or modify its permission bundle; those attempts conflict. It does allow manager-level callers to create, update, and attach/revoke product-scoped permissions on non-manager roles ([class-kit-api/supabase/functions/class-kit-product-roles/index.ts](../target-repo/class-kit-api/supabase/functions/class-kit-product-roles/index.ts)).

Level guards are hierarchical: an equal-or-higher active role passes. Key guards are not hierarchical: the exact key must appear in a role-permission bundle. Platform-scoped level and key checks are platform-only. This distinction is the central authorization contract, rather than treating the `manager` name or a numeric rank as a general admin boolean ([docs/adr/0001-scoped-product-permission-layer.md](../target-repo/docs/adr/0001-scoped-product-permission-layer.md); [class-kit-api/supabase/functions/_shared/permissions.ts](../target-repo/class-kit-api/supabase/functions/_shared/permissions.ts)).

## Permission catalog and default grants

The catalog persists scope, label/group metadata, and description in `class_kit.permissions`. Product role editing accepts only `product` or `any` catalog keys; current migrations define the following supported keys.

| Scope | Keys |
| --- | --- |
| Product | `classes.create`, `classes.update`, `classes.cancel`, `classes.publish`, `classes.draft`, `classes.drafts.read`, `classes.extra_fields.read`; `templates.manage`, `schedules.manage`; `registrations.manage`, `attendance.manage`; `memberships.manage`, `memberships.adjust_stock`; `users.read`, `users.manage`, `users.metadata.manage`; `product_roles.manage`, `product_role_permissions.manage`, `product_user_roles.manage`, `product_managers.manage`; `product.auth_mode.update`; `class_signup_links.manage`; `product_documents.manage`; `product_change_requests.manage`. |
| Platform | `products.manage`, `product_origins.manage`, `platform_users.manage`; `product.email_password_enabled.update`; `product.google_oauth_enabled.update`. |

The default `manager` bundle includes every current product key above. The default `user` bundle is empty. The default `platform_admin` bundle contains only the two provider-setting keys; platform inventory and other platform actions commonly use a level-100 guard instead. These are current migration defaults, not an implication that a level-100 role has every key ([class-kit-api/supabase/migrations/20260707144646_product_change_requests.sql](../target-repo/class-kit-api/supabase/migrations/20260707144646_product_change_requests.sql); [class-kit-api/supabase/migrations/20260705094533_product_user_metadata_permission.sql](../target-repo/class-kit-api/supabase/migrations/20260705094533_product_user_metadata_permission.sql)).

Representative guard outcomes are explicit in code: class creation needs `classes.create`; class list/management reads, schedules, templates, membership lists, registration queues, and attendance reads use level 75; their mutations use their corresponding keys. Product auth-mode changes use a product level-75 guard, while email/password and Google provider toggles use their platform keys ([class-kit-api/supabase/functions/class-kit-classes/index.ts](../target-repo/class-kit-api/supabase/functions/class-kit-classes/index.ts); [class-kit-api/supabase/functions/class-kit-admin-products/index.ts](../target-repo/class-kit-api/supabase/functions/class-kit-admin-products/index.ts)).

## Grant and revocation boundaries

`class-kit-product-user-roles` requires `product_user_roles.manage` to list, assign, or revoke a product user's role assignment. Assignment deactivates the target's previous active assignment before activating the selected role. The database refuses an assignment that would remove the final active actor holding `product_user_roles.manage`, so a product cannot lose its last role-assignment authority ([class-kit-api/supabase/functions/class-kit-product-user-roles/index.ts](../target-repo/class-kit-api/supabase/functions/class-kit-product-user-roles/index.ts); [class-kit-api/supabase/migrations/20260612124000_product_role_management_rpc.sql](../target-repo/class-kit-api/supabase/migrations/20260612124000_product_role_management_rpc.sql)).

The older product-membership table separately protects the last active built-in manager on membership role/status changes. This is not the same invariant as preserving the final custom-role grant authority, and both protections are present ([class-kit-api/supabase/migrations/20260607112136_product_role_foundation.sql](../target-repo/class-kit-api/supabase/migrations/20260607112136_product_role_foundation.sql)).

## Dashboard capability hints

`class-kit-product-context` loads active product-role permissions only and returns a sorted `capabilities.permissions` list plus these product-local dashboard flags:

| Flag | True when the active product role has |
| --- | --- |
| `can_enter` | any of `classes.create`, `product_roles.manage`, `product_user_roles.manage`, or `product.auth_mode.update` |
| `can_manage_classes` | `classes.create` |
| `can_manage_roles` | `product_roles.manage` or `product_role_permissions.manage` |
| `can_manage_users` | `product_user_roles.manage` |
| `can_manage_auth_mode` | `product.auth_mode.update` |

The demo website uses these flags to show the Control Dashboard and its modules, but each API retains its own backend guard. Because this response does not merge platform authority, a platform admin without product membership can receive no product-user summary and false dashboard flags while still passing a specifically level-gated administrative operation ([class-kit-api/supabase/functions/class-kit-product-context/index.ts](../target-repo/class-kit-api/supabase/functions/class-kit-product-context/index.ts); [apps/demo2/src/control-dashboard.tsx](../target-repo/apps/demo2/src/control-dashboard.tsx); [docs/api/backend-api.md](../target-repo/docs/api/backend-api.md)).

## Evidence status and known gaps

Implementation evidence is present for the role tables, permission catalog, RPC-backed level/key checks, role-management endpoints, and dashboard derivation. This snapshot includes SQL regression coverage for registrations, schedules, and destructive product truncation, but no authorization/role-grant regression test files. The following high-impact coverage is therefore unverified:

- Level-versus-key inheritance, especially platform-level fallback for product level guards and the intentional absence of fallback for product key guards.
- Product-role assignment/revocation invariants, including one-active-role behavior, last grant-authority protection, and last-manager protection.
- The full default manager bundle and platform-admin provider-key bundle after migrations run.
- Product-context capability derivation and the intentional false product-local hints for an unassigned platform admin.
- Alignment between the persisted `function_permission_requirements` catalog and every current Edge Function branch; the catalog is useful documentation but is not a runtime enforcement dispatcher.
