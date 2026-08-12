# Identity, Product Access, and Authorization

ClassKit uses one shared Supabase project for global identity while keeping product membership, access lifecycle, roles, and permissions in the ClassKit backend.

## The boundary

`auth.users` answers who a person is in the shared Supabase project. It owns sessions and provider identities such as email/password and Google OAuth. It does not answer whether that identity may use a particular ClassKit product or what it may do there.

ClassKit owns that second decision in its product-scoped records and Edge Functions:

```text
Supabase identity/session
  -> origin-resolved ClassKit product
  -> product access lifecycle and product membership
  -> scoped role and permission guard
  -> requested business action
```

`class_kit.users` is the product membership table, not a platform-admin table. A platform admin can hold ClassKit platform authority without becoming a product member; conversely, a signed-in Supabase user has no ClassKit authority until the resolved product policy and membership/access state allow it. See [docs/shared/authentication.md](../target-repo/docs/shared/authentication.md), [docs/product-shape.md](../target-repo/docs/product-shape.md), and [docs/adr/0001-scoped-product-permission-layer.md](../target-repo/docs/adr/0001-scoped-product-permission-layer.md).

This separation also means OAuth may create or resolve a global `auth.users` identity before ClassKit denies access to an invite-only product. That is expected: provider authentication is not product authorization.

## Product resolution is an authorization input

Every browser request is resolved to a product by its `Origin`; `x-class-kit-site-url` can add a path-aware site URL when multiple products share one browser origin. The site URL must be HTTP(S) and have the same origin as `Origin`. Requests without an origin are rejected, and a product must match an allowed origin/site URL before product context or product actions proceed.

Production clients must not select the product with `product_key`. The SDK may send a product-key hint only from localhost, where several local products can otherwise share an origin; the backend still verifies that localhost origin against the selected product's allowed origins. A local backend can instead use `CLASS_KIT_LOCAL_PRODUCT_KEY`. The implementation is centralized in [class-kit-api/supabase/functions/_shared/context.ts](../target-repo/class-kit-api/supabase/functions/_shared/context.ts), with the browser contract described in [docs/api/backend-api.md](../target-repo/docs/api/backend-api.md).

Origin resolution also scopes active OAuth redirect records. A redirect URL must be both an active ClassKit product redirect and present in Supabase Auth's global redirect allow list. Product apps receive the configured redirect through product context; they must not hard-code it in frontend environment variables or SDK options.

## Auth policy and access lifecycle

Each product has backend-owned policy fields:

| Field | Effect | Who may change it |
| --- | --- | --- |
| `auth_mode` | `open` creates/activates membership for an eligible signed-in identity; `invite_only` requires a qualifying access entry. | Product level-75 manager or platform level-75+ authority through a level guard. |
| `email_password_enabled` | Enables the product's password auth UI and backend signup path. | Platform admin only. |
| `google_oauth_enabled` | Enables Google for the product after shared Supabase provider authentication. | Platform admin only. |
| `product_auth_redirects` | Provider return URLs scoped to an allowed origin/environment. | Platform/admin product setup APIs. |

`class-kit-product-context` is the central, anonymous-aware entrypoint. Signed-out callers receive product policy and empty capabilities. For a signed-in non-platform-admin identity, `ensureProductAccess` applies the lifecycle:

- Existing product membership is returned as active product access.
- For an open product, ClassKit assigns the existing access role or the default `user` role and creates/confirms product membership.
- For an invite-only product with no access entry, ClassKit creates a `pending` self-request; no membership is created.
- An `invited` or `active` entry is linked to the signed-in user and activated into product membership.
- `pending`, `rejected`, and `inactive` entries remain non-member states for the app to explain rather than treating them as sign-up success.

`class_kit.product_access_entries` records the product, normalized email, optional Supabase user id, requested role (`user` or `manager`), status (`invited`, `pending`, `active`, `rejected`, or `inactive`), source (`admin_invite` or `self_request`), and decision audit fields. Its migration enables RLS; trusted Edge Functions perform the lifecycle work. See [20260629133541_product_access_entries.sql](../target-repo/class-kit-api/supabase/migrations/20260629133541_product_access_entries.sql) and [context.ts](../target-repo/class-kit-api/supabase/functions/_shared/context.ts).

Platform admins are deliberately excluded from automatic product membership during product-context resolution. They must be explicitly assigned a product membership before customer-facing product flows; this avoids silently turning platform operators into a product's customer or manager.

## Roles, permissions, and enforcement

ClassKit uses separate platform and product role assignments, numeric levels, and explicit permission keys. Its guard primitives are `requirePermissionByLevel` and `requirePermissionByKey` in [permissions.ts](../target-repo/class-kit-api/supabase/functions/_shared/permissions.ts).

| Guard | Scope and inheritance |
| --- | --- |
| Product level | A role at or above the level in the resolved product **or** a platform role at that level may pass. This permits deliberately level-gated platform administration without an implicit product membership. |
| Product permission key | Requires an explicit product-role grant for that exact key. Platform level does not imply product-specific keys. |
| Platform level/key | Requires platform authority only. |

This distinction is intentional. Numeric levels support narrow operational escape hatches for platform operators, while permission keys express product-local capabilities such as `classes.create`, `product_roles.manage`, or `product.auth_mode.update`. Backend guards remain authoritative for every mutation. The built-in direction in [docs/product-shape.md](../target-repo/docs/product-shape.md) is platform admin level 100, product manager level 75, and product user level 10; actual authority comes from active scoped assignments and grants, not a role name in a browser client.

Supabase RLS is a database backstop using the same permission language. It does not replace Edge Function guards: trusted functions may use service-role clients, which bypass ordinary user RLS and must therefore perform explicit ClassKit authorization checks. Product-scoped permissions are database-backed rather than stored in JWT/app metadata because they are mutable and vary by product.

## Client and control-plane responsibilities

Product websites use `@class-kit/react` and `ProductProvider`; they should use `product`, `product_user`, `product_access`, and capability flags to choose UI and denial messaging, then let backend calls enforce the decision. Capability flags are navigation hints, not a complete authority map: a platform admin without product membership can have no product-user capabilities while passing an intentionally platform-backed level guard.

The ClassKit admin app likewise receives only a Supabase session from Google sign-in. It gains ClassKit control-plane authority only through platform roles and admin Edge Functions. Supabase Dashboard/project administration, shared Supabase identity, and ClassKit platform/product administration are distinct concepts and must not be merged.

Browser code may use the shared project URL and publishable key, never service-role keys, database credentials, provider secrets, or user-editable metadata as authorization input. The backend/SDK split is documented in [docs/api/backend-api.md](../target-repo/docs/api/backend-api.md): apps own UI, the SDK owns typed facade behavior, and `class-kit-api` owns origin resolution, policy, guards, Edge Functions, migrations, and RLS.

## Practical change rules

- Add a product-wide auth or access rule in the backend model and Edge Functions first; expose it through the SDK only after the server contract is stable.
- Add a specific permission key for product-local capability, not a broad manager/admin role-name check.
- Choose a level guard only when platform-level fallback is deliberately part of the operation's contract.
- Keep origin and redirect configuration explicit. A configured product redirect alone cannot bypass Supabase Auth's global allow list.
- Treat `401 unauthorized` as missing/invalid identity and `403 forbidden` as a resolved policy, origin, provider, invitation/access, or authority denial.

