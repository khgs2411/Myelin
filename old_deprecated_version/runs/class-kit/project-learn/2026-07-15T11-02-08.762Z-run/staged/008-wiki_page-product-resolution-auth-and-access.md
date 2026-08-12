# Product resolution, authentication, and access lifecycle

ClassKit chooses an active product from the browser origin before it evaluates a caller's authentication, product membership, or access-entry status; product access is then represented by an active `product_user_roles` assignment and, when applicable, a separate `product_access_entries` record.

## Resolution boundary

Every context-aware Edge Function obtains a site URL from `Origin`. The header is required. A caller may send `x-class-kit-site-url` to retain a path (useful for hosted products below a path), but it must be an HTTP(S) URL whose URL origin equals `Origin`; query and fragment are stripped. Without that header, the site URL is exactly `Origin` (`cors.ts` (`repo:class-kit-api/supabase/functions/_shared/cors.ts`)).

Only products with `products.status = 'active'` can resolve. A configured allowed origin matches the exact site URL, or a path beneath it. A host-only origin such as `https://example.test` matches paths below that host; a configured path matches itself and descendants, with a trailing slash meaning a raw prefix. The database resolver returns only the longest matching configured origin (`20260629121334_root_origin_matches_paths.sql` (`repo:class-kit-api/supabase/migrations/20260629121334_root_origin_matches_paths.sql`)); `context.ts` repeats the same longest-match rule when it selects redirect configuration.

Production resolution is origin-only. Supplying `product_key` outside localhost/loopback is rejected with `400`; on localhost, the request key takes precedence and otherwise `CLASS_KIT_LOCAL_PRODUCT_KEY` is used. The keyed resolver still requires that the selected product allow the origin. If origin-only resolution produces more than one equally specific product, the request fails with `400` rather than selecting one; no match fails with `403` (`context.ts` (`repo:class-kit-api/supabase/functions/_shared/context.ts`)).

## Product authentication policy

Each product has three policy fields, configured by platform-admin APIs (`20260612073150_product_auth_policy.sql` (`repo:class-kit-api/supabase/migrations/20260612073150_product_auth_policy.sql`), `class-kit-admin-products/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-admin-products/index.ts`)).

| Field | Supported values | Runtime effect |
| --- | --- | --- |
| `auth_mode` | `open`, `invite_only` | Determines whether a signed-in, otherwise unassigned person is automatically made a product user or becomes/remains an access request. Email/password signup is allowed only for `open`. |
| `email_password_enabled` | boolean, default `true` | Allows email-password signup and authenticated users whose resolved provider is `email` (or absent provider metadata). |
| `google_oauth_enabled` | boolean, default `false` | Allows authenticated Google users. |

After resolving the product, context loading validates an optional bearer token. An anonymous request, including one bearing the public Supabase API key, is allowed only where the endpoint itself permits anonymous context. An invalid token is `401`. For an authenticated caller, provider policy is enforced before access lifecycle processing: email/no provider requires `email_password_enabled`; Google requires `google_oauth_enabled`; Apple and every other provider are unsupported and receive `403` (`context.ts` (`repo:class-kit-api/supabase/functions/_shared/context.ts`)).

`class-kit-product-signup` is deliberately narrower than sign-in: it requires `open` plus email/password enabled, creates the auth user, then assigns the built-in `user` role. It does not create an access entry. If the role assignment fails after auth-user creation, the function reports `500`; the source logs that the auth user was already created (`class-kit-product-signup/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-product-signup/index.ts`)).

OAuth redirects are active `product_auth_redirects` rows for `google` or `apple`. Resolution returns redirects attached to the most-specific matched allowed origin when any exist; otherwise it returns origin-null redirects. Redirects are constrained to an allowed origin when origin-scoped, and at most one active default exists per product/provider/origin (or per product/provider/environment for origin-null redirects) (`20260629103250_bind_auth_redirects_to_origins.sql` (`repo:class-kit-api/supabase/migrations/20260629103250_bind_auth_redirects_to_origins.sql`)). Redirect availability is configuration returned by product context; provider authorization is governed by the two product policy booleans above.

## Access data and precedence

`product_user_roles` is the live membership/role source: a caller is a product user only if it has an `active` assignment, and there can be one active role per product and user. Assigning a role deactivates the prior active role and creates/reactivates the target assignment (`20260612120000_permission_layer_foundation.sql` (`repo:class-kit-api/supabase/migrations/20260612120000_permission_layer_foundation.sql`), `20260612124000_product_role_management_rpc.sql` (`repo:class-kit-api/supabase/migrations/20260612124000_product_role_management_rpc.sql`)). The older `class_kit.users` row is updated as a compatibility row by the assignment helper; it is not the context lookup source.

`product_access_entries` is one normalized email-based access record per product, with a second uniqueness constraint for a non-null `(product_id, user_id)`. It retains the requested role, source, decision actor/time, and timestamps (`20260629133541_product_access_entries.sql` (`repo:class-kit-api/supabase/migrations/20260629133541_product_access_entries.sql`)). Supported stored values are:

| Field | Values | Meaning in the current functions |
| --- | --- | --- |
| `role` | `manager`, `user` | Role granted on activation; admin invitation can change it. |
| `source` | `admin_invite`, `self_request` | Admin-created/reissued invite versus automatic request made by an invite-only caller. |
| `status` | `invited`, `pending`, `active`, `rejected`, `inactive` | `invited`, `pending`, `active`, and `rejected` have function behavior below. `inactive` is permitted by the schema but no transition that writes it was found in the current Edge Functions. |

For a signed-in caller, access lookup is by normalized email first and then by user ID. A matched email record is attached to the current user ID. The effective order is:

1. A platform administrator is not implicitly a product member. `ensureProductAccess` rejects it with `403`; the product-context endpoint intentionally skips that helper for platform admins and reports only any explicit product membership/access record.
2. An existing active product-role assignment wins: the caller is returned as a product user even if an access entry is absent or in a different state.
3. Without active membership, `open` assigns the entry's role, or `user` when no entry exists. A matching entry is marked `active`; no-entry open access is represented only by a synthetic active summary, not a database access row.
4. Without active membership, `invite_only` creates a `pending`/`self_request` entry when none exists. An `invited` or `active` entry activates the corresponding role; `pending`, `rejected`, and `inactive` return no product user and retain their state.

This makes active membership the product-access gate. More specific business gates, such as active membership entitlements or a class's visibility/approval rules, are downstream and do not alter this state machine.

## Entry transitions and administrative control

The state machine is enforced by service-role Edge Function code, not by a database transition constraint.

| Event | Prior condition | Result |
| --- | --- | --- |
| Invite-only signed-in visitor reaches an access-enforcing endpoint | No entry and no active product role | Insert `pending`, `user`, `self_request`, linked to the caller; deny product-user access. |
| Admin `invite_product_user` | No entry | Insert `invited`, requested role, `admin_invite`; user ID remains null until a matching user signs in. |
| Admin re-invites | Existing non-active entry | Change role, source to `admin_invite`, and status to `invited`; this includes a previously rejected request. |
| Admin re-invites | Existing active entry | Keep `active`, update role/source; if it has a user ID, immediately reassign/activate that role. |
| Caller reaches access enforcement with `invited` or `active` entry | Entry is linked to a user ID | Assign requested role, mark entry `active`, set decision actor/time. |
| Admin `approve_product_access` | Any entry with a user ID | Performs the same activation regardless of its previous status. Without a user ID, it returns `409`; an invitation must first be claimed by sign-in. |
| Admin `reject_product_access` | Any non-active entry | Mark `rejected` and record decision actor/time. Active entries are rejected with `409` and the API directs the operator to deactivate product membership instead. |

Admin user/access actions require platform-admin authority through `requireAdminBody`, rather than mere product-manager status (`admin_api.ts` (`repo:class-kit-api/supabase/functions/_shared/admin_api.ts`), `class-kit-admin-product-users/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-admin-product-users/index.ts`)). Product-context returns the resolved policy, explicit `product_user`, explicit/synthetic `product_access`, active membership-entitlement flag, and permissions/dashboard capabilities; it does not treat an access request as an entitlement.

## Known gaps

- The snapshot contains no regression test focused on origin resolution, provider-policy rejection, or `product_access_entries` transitions; the SQL tests present cover registration and product truncation instead. The behavior above is therefore current source/migration evidence, not end-to-end test-confirmed behavior.
- `inactive` is a valid access-entry status, but no current Edge Function transition writes it, and the supplied migration does not define a transition matrix. Its intended operator behavior needs review.
- The admin `update_product_user` inactive path updates the legacy `users` compatibility row, while context membership is read from active `product_user_roles`; the supplied code does not demonstrate a matching role deactivation. This is a high-impact access-lifecycle ambiguity that needs a regression test and ownership decision before documenting deactivation as effective.
