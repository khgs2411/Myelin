# Product resolution and access

ClassKit resolves a single active product from the browser request, then applies product-specific authentication and access-entry rules before a caller can become a product member.

## Resolution boundary

The shared request context in `class-kit-api/supabase/functions/_shared/context.ts` obtains the site URL from `Origin`, optionally refined by `x-class-kit-site-url`. The refinement must be an HTTP(S) URL with the same origin; its query and fragment are removed, and its non-root path is retained. A missing `Origin` is forbidden.

The service-only SQL resolvers `class_kit.resolve_product_by_origin` and `class_kit.resolve_product_by_key_and_origin` (last defined in `class-kit-api/supabase/migrations/20260629065604_preserve_pathful_product_origins.sql`) consider only active products and their allowed origins. An exact origin matches. A configured path also matches that path and descendants; when several allowed paths match, only the longest matching path is returned. A root-only configured origin is exact in the SQL resolver, not a wildcard for paths.

Production resolution is origin-led. A `product_key` request hint is rejected outside localhost/loopback origins. On localhost, the request hint takes priority; if absent, `CLASS_KIT_LOCAL_PRODUCT_KEY` is used. Without a local hint, more than one product returned for the origin is a `bad_request` ambiguity; no match is forbidden as “Product is not allowed for this origin.” This prevents a browser client from selecting a production product merely by supplying a key.

The context then loads auth policy and active redirects. Redirects are narrowed to those bound to the most-specific matched allowed origin when any exist; otherwise only origin-null redirects are returned. `product_auth_redirects` supports `google` and `apple`, `development` and `production`, `active` and `inactive`, an optional allowed-origin binding, and at most one active default per product/provider/origin (or per product/provider/environment for unbound redirects). See `20260628130854_product_auth_redirects.sql` and `20260629103250_bind_auth_redirects_to_origins.sql`.

## Authentication policy

`class_kit.products` has the following independently evaluated settings, introduced by `20260612073150_product_auth_policy.sql`:

| Setting | Supported values | Runtime outcome |
| --- | --- | --- |
| `auth_mode` | `open`, `invite_only` | Governs automatic product membership/access handling after identity is known. |
| `email_password_enabled` | `true`, `false` | An authenticated email/no-provider identity is rejected when false; password signup is also rejected when false. |
| `google_oauth_enabled` | `true`, `false` | An authenticated Google identity is rejected when false. |

Provider availability is enforced after product resolution and bearer-token validation but before access handling. Anonymous product-context callers are allowed to inspect the resolved product policy. Any authenticated provider other than absent/email or Google is rejected as unsupported by the current shared context. This means the redirect schema’s `apple` value is not, by itself, evidence that Apple-authenticated callers can enter a product; current runtime behavior rejects that provider.

`class-kit-product-signup` is a narrower email/password path: it resolves the same product first, requires `auth_mode = open` and `email_password_enabled = true`, creates the Supabase identity/profile, then assigns the `user` product role. A failure after identity creation can leave an auth identity without product membership, as the function logs and returns an internal error.

## Product access entries

`class_kit.product_access_entries`, defined in `20260629133541_product_access_entries.sql`, records a product-scoped normalized email, optional attached auth user, assigned built-in role, lifecycle status, source, creator/decision audit fields, and timestamps. There is one row per product/email and, once attached, one row per product/user. Its current constrained values are:

| Field | Values | Meaning in the access flow |
| --- | --- | --- |
| `role` | `manager`, `user` | Role assigned if the entry is activated; default is `user`. |
| `status` | `invited`, `pending`, `active`, `rejected`, `inactive` | Invitation/request state; only `invited` and `active` automatically activate invite-only membership. |
| `source` | `admin_invite`, `self_request` | An administrator-created invitation or caller-created request. |

An administrator invitation is created as `invited` unless an existing entry is already `active`; reinviting updates its role/source and keeps an active row active. If the entry already has a user, the admin invitation immediately activates it. Approving any entry requires an attached signed-in user, assigns its stored role, then marks the entry `active` with a decision timestamp. Rejecting an active entry is refused; active product access must instead be removed through product-user management. These mutations are handled by `class-kit-api/supabase/functions/class-kit-admin-product-users/index.ts`.

## Membership creation outcomes

`ensureProductAccess` is the membership-creating boundary used by `class-kit-product-context` for non-platform-admin signed-in callers (and by product profile flows). It applies the following order:

1. Product origin/key resolution and authenticated-provider policy succeed.
2. Caller identity is established.
3. Platform-admin status is checked; platform admins are never implicitly enrolled.
4. An existing active product role assignment is reused.
5. Otherwise the email/user access entry and `auth_mode` determine whether a role assignment is created.

| Caller/resource condition | `open` outcome | `invite_only` outcome |
| --- | --- | --- |
| Anonymous caller | Product information only; no access routine runs. | Same. |
| Platform admin without product membership | No implicit membership; product context leaves product user null. | Same. |
| Existing active product user | Reused; if no stored entry, context synthesizes an active self-request summary. | Same. |
| No entry | Assign active `user` membership. The returned active summary is synthetic, not an inserted access-entry row. | Create an attached `pending` self-request with `user` role; no membership. An identity without email receives `bad_request`. |
| Attached entry in any status | Assign its stored role and mark the entry active—even if it was pending, rejected, or inactive. | `invited` or `active` assigns the stored role and marks/keeps it active. `pending`, `rejected`, and `inactive` remain non-membership states. |

An access entry is therefore not the same thing as `class_kit.users` / active product-role membership. Activation first assigns the product role and then changes the entry state. Product-context reports both `product_user` and `product_access`, allowing apps to distinguish an invitation or pending request from actual product access. Its capability list is computed from active product-role permissions, so a platform admin without a product role can have platform authority elsewhere while receiving no product-local user/capability state here.

## Gate precedence and user-visible failures

The effective precedence is origin resolution before authentication policy, and authentication policy before access-entry processing. Product workflow functions that call `ensureProductUser` add a final gate: no activated product user produces forbidden “Product access requires an invitation.” Thus a pending invite-only request is visible in product context but cannot satisfy customer product workflows. Membership, membership grants, class eligibility, approval, and lifecycle gates run later in their respective workflow endpoints; they do not override a failed product-access gate.

The checked-in `docs/shared/authentication.md` says `invite_only` requires pre-existing membership. That is stale/conflicting for the current implementation: `ensureProductAccess` instead creates a pending self-request for a signed-in caller with no attached entry, while still withholding membership until an invitation/approval activates it.

## Evidence and confidence

Current behavior is grounded in the shared runtime context, the product-context and product-signup Edge Functions, the product-access/auth-policy migrations, and the SDK response types in `class-kit-sdk/src/types.ts`. The repository includes a SQL truncation regression that preserves product access/origin/redirect cleanup, but no direct checked-in automated regression was found for resolver precedence, provider enablement, self-request creation, or each access-state transition. Those contracts should receive integration tests before treating this subject as exhaustively verified.
