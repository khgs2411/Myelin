# Product access and authorization

ClassKit resolves an active product from the calling site before it authenticates or authorizes the caller; product membership, product permissions, platform authority, and membership grants are separate gates rather than interchangeable forms of access.

## Origin and product context

All product-facing Edge Functions use `getRequestSiteUrl` from `class-kit-api/supabase/functions/_shared/cors.ts`. A request must have an `Origin` header. It may additionally send `x-class-kit-site-url`: it must be an `http` or `https` URL with exactly the same URL origin as `Origin`; query and fragment are removed, and the pathname is retained unless it is `/`.

`resolveAnonymousProductContext` in `class-kit-api/supabase/functions/_shared/context.ts` resolves that resulting site URL against active `products` and `product_allowed_origins` rows. An exact origin matches; a configured root origin matches its paths; and a configured path only matches that path or a descendant. The SQL resolver chooses the longest match. No match produces `403 forbidden` (`Product is not allowed for this origin`).

Product-key hints are a local-development disambiguator, not a production selector:

| Request condition | Resolution outcome |
| --- | --- |
| Non-local origin with `product_key` | `400 bad_request`; production must have a unique origin. |
| `localhost`, `127.0.0.1`, or IPv6 loopback with a request key | Resolve that key, but it must still be allowed for the site URL. |
| Local origin without a request key | Use `CLASS_KIT_LOCAL_PRODUCT_KEY` when set; otherwise resolve by origin. |
| Origin-only resolution returns multiple products | `400 bad_request` asking for a local key or unique production origin. |

This is an application gate, not a CORS allowlist: `corsHeaders` reflects the request origin, while the context resolver performs the product-origin authorization. OAuth redirect rows are a separate configuration: supported providers are `google` and `apple`, environments are `development` and `production`, and redirect status is `active` or `inactive`. Context returns active redirects bound to the best-matching allowed origin when available, otherwise active origin-less defaults (`context.ts`; `20260628130854_product_auth_redirects.sql`; `20260629103250_bind_auth_redirects_to_origins.sql`).

## Authentication policy

Each product has the following current policy values (`20260612073150_product_auth_policy.sql`):

| Field | Supported values | Effect after a user token is validated |
| --- | --- | --- |
| `auth_mode` | `open`, `invite_only` | Controls automatic product-user activation or the access-request/invitation path. |
| `email_password_enabled` | boolean, default `true` | A user with no recorded provider or provider `email` is allowed only when true. |
| `google_oauth_enabled` | boolean, default `false` | A user with provider `google` is allowed only when true. |

The bearer-token rules are independent of those policy settings. A required product context rejects a missing or invalid bearer token with `401`. Anonymous context accepts no token; it also treats the project public/anonymous key as anonymous. A valid user is checked against the selected product’s provider policy after origin/product resolution. An unknown provider, including the schema-level `apple` redirect provider, is currently rejected with `403` because the runtime allows only email and Google sign-in in `assertProductAuthProviderAllowed`.

The current policy endpoint is not fully aligned with its requirements catalog. `class-kit-admin-products` enforces `auth_mode` changes with product level 75, which can also be satisfied by a platform role at level 75 or higher. `20260612122000_permission_requirement_catalog.sql` instead records `product.auth_mode.update` as the requirement; that catalog row is stale or conflicting, not evidence of the current guard. Enabling/disabling email/password or Google uses the respective platform permission key in both the endpoint and catalog.

## Product access state machine

`product_access_entries` persists an email-normalized, product-local access record (`20260629133541_product_access_entries.sql`). Its supported values are:

| Field | Values | Meaning in `ensureProductAccess` |
| --- | --- | --- |
| `status` | `invited` | In an invite-only product, activate the record and assign its role when the identified user resolves it. |
|  | `pending` | A self-request awaiting a decision; no product user is returned. |
|  | `active` | In an invite-only product, activate/confirm the assigned role; an already-active product role wins earlier. |
|  | `rejected` | No product user is returned in invite-only mode. |
|  | `inactive` | No product user is returned in invite-only mode. |
| `source` | `admin_invite`, `self_request` | Provenance only; it does not change the branch once a status is evaluated. |
| `role` | `manager`, `user` | The role assigned when the entry is activated; self-requests default to `user`. |

Lookup is email-first, then user-id. A matching email row is attached to the authenticated user id on first use. Approval cannot activate an entry lacking a user id (`409 conflict`), because role assignment needs an authenticated identity.

The effective transition rules are deliberately asymmetric:

| Product mode / caller condition | Result |
| --- | --- |
| Caller already has an active product role | Return it immediately; its access-row status is not re-evaluated. |
| `open`, authenticated non-platform-admin caller without an active role | Assign the entry’s role when an entry exists, otherwise `user`; then return active access. This means even a previously `pending`, `rejected`, or `inactive` entry does not block open-product enrollment. |
| `invite_only`, no entry | Create `pending` / `self_request`; deny product-user access. |
| `invite_only`, `invited` or `active` entry | Assign the entry role and mark the entry active. |
| `invite_only`, `pending`, `rejected`, or `inactive` entry | Return the entry but no product user; consumers requiring a product user receive `403`. |
| Platform admin without explicit product membership | Never auto-enroll; `ensureProductAccess` returns `403`, and product-context deliberately skips it. |

`class-kit-product-context` is the public/auth-aware entry point and exposes the resulting product policy, product user, product access, product permission list, and `has_active_membership`. `class-kit-profile` explicitly calls `ensureProductAccess`; registration endpoints instead require an already-active product user. Thus viewing context, receiving membership, and being eligible to register are not equivalent.

## Roles, permission bundles, and scopes

The permission layer stores platform roles, product-local roles, assignments, and bundles (`20260612120000_permission_layer_foundation.sql`). A product has protected built-ins `manager` (level 75) and `user` (level 10); custom product role keys are supported and have a non-negative numeric level. Only one active product role assignment is allowed per `(product, user)`, and assignment status is `active` or `inactive`. The built-in platform role is protected `platform_admin` at level 100; custom platform roles are also structurally supported.

The current built-in manager bundle contains class lifecycle/read permissions, role and user management, `product.auth_mode.update`, templates, schedules, memberships, registrations, attendance, stock adjustment, signup links, product documents, and product change requests. The `user` role is an access role, not an implied manager bundle. The permissions catalog is data-driven; current product keys include `classes.*`, `templates.manage`, `schedules.manage`, `memberships.manage`, `registrations.manage`, `attendance.manage`, `users.read`, `users.manage`, `users.metadata.manage`, `product_*` role/auth/change-request keys, `class_signup_links.manage`, and `product_documents.manage`. Platform keys cover product/origin/provider-redirect management and platform-user management. `20260707144646_product_change_requests.sql` contains the latest built-in-manager provisioning function.

Permission helpers have a material scope distinction (`_shared/permissions.ts`):

| Guard | Product-scope result | Platform fallback |
| --- | --- | --- |
| Permission key | Requires an active product role whose bundle grants that exact key. | None. A platform permission does not satisfy it. |
| Numeric level | Allows an active product role at or above the level. | Yes: a platform role at or above the level also satisfies it. |
| `requireProductManager` | Requires the literal active product role key `manager`. | None. |
| Platform-scoped key or level | Checks only platform roles/bundles. | Not applicable. |

The role-assignment RPC serializes reassignment per product and rejects removal of the last active holder of `product_user_roles.manage` (`last_product_grant_authority`). This protects role-management continuity, rather than treating a platform admin as a synthetic product manager.

## Dashboard capability projection

`class-kit-product-context` returns an explicit, narrow dashboard projection from the caller's active product-role permission keys. It is a UI routing/display projection only; each management endpoint still applies its own backend authorization. The current response has no read-only capability flags: there is no separate read-capability contract in this projection.

| Capability | True when the active product permissions contain | User-visible outcome |
| --- | --- | --- |
| `can_enter` | At least one of `classes.create`, `product_roles.manage`, `product_user_roles.manage`, or `product.auth_mode.update` | Demo2 admits the signed-in caller to the control dashboard. |
| `can_manage_classes` | `classes.create` | Shows the Classes dashboard module. |
| `can_manage_roles` | `product_roles.manage` or `product_role_permissions.manage` | Shows the Roles module. |
| `can_manage_users` | `product_user_roles.manage` | Shows the Users module. |
| `can_manage_auth_mode` | `product.auth_mode.update` | Shows the Access module. |

The current Demo2 dashboard independently exposes its Requests module when `product_change_requests.manage` is present; that permission is not represented by a dedicated dashboard boolean. Anonymous callers receive no permissions and all dashboard booleans false. A client must not infer that a hidden module is a denied backend operation, or that a visible module authorizes every action within it.

## Gate precedence

For product-facing operations, the applicable order is:

1. CORS preflight is answered first; POST JSON handling then requires a valid `Origin` and site URL.
2. Origin/product resolution selects an active allowed product before user authentication. A disallowed or ambiguous origin stops the request before role or membership checks.
3. Token validation happens for authenticated operations; provider policy is then checked for a valid authenticated user.
4. The specific endpoint decides whether authentication alone is enough, whether it needs active product access, or whether it needs a role/permission. `requireProductContext` alone authenticates but does not auto-enroll or assert product membership.
5. Product access evaluation, where the endpoint calls it, precedes product-user-only work. Existing active product role beats access-entry state; open auto-enrollment beats non-active entry state; invite-only approval status controls activation.
6. Role/permission authorization follows. Product key permissions do not inherit platform authority; product level checks do. A literal manager guard is stricter than a level guard for platform-only administrators.
7. Domain gates run last. Active membership is reported by product context but is not a generic authorization substitute. For example, class registration first needs an active product user, then its registration RPC applies class visibility, registration policy, membership/stock, capacity, and lifecycle constraints (documented in the registration and membership subjects).

## Evidence and known gaps

Implementation evidence is the shared context and permission helpers, product-context/profile/registration Edge Functions, the Demo2 dashboard, and the current migration chain named above. The available SQL regressions cover member auto-approval, pending-registration cancellation, schedule backfill, and destructive product reset; the reset regression incidentally preserves origin, access-entry, role, and redirect records. They do not directly exercise origin matching, local product-key ambiguity, provider denial, every access-state branch, permission-scope fallback, dashboard-capability projection, or final role-management actor protection. The historical permission-layer smoke checklist describes those scenarios, but it is design guidance rather than current regression proof; these contracts therefore retain that coverage gap.
