# Authorization and roles

ClassKit separates platform administration from product-scoped membership and derives callable capabilities from active role assignments, permission grants, and action-specific guards.

## Scope and request boundary

Every product-facing Edge Function first resolves the product from the request site URL/origin in `class-kit-api/supabase/functions/_shared/context.ts`. A production request cannot supply `product_key`: that hint is accepted only for localhost/loopback development (or `CLASS_KIT_LOCAL_PRODUCT_KEY`). An origin with no allowed product is rejected with `403 Product is not allowed for this origin`; an origin matching multiple products without a local key hint is rejected as ambiguous. This is the isolation boundary before role evaluation.

The context carries the resolved product's `auth_mode` (`open` or `invite_only`), enabled email/password and Google providers, authenticated user (if any), legacy-compatible product-user summary, and product-access entry. Product-manager functions require a bearer token through `requireProductContext`; a missing token is `401`, while a satisfied identity alone is not product authority.

Access resolution is the next gate, before membership-dependent product behavior:

- An existing active product user is returned unchanged.
- A platform admin is explicitly denied automatic product membership. It must be assigned to the product even though product-level *level* checks may later fall back to platform authority.
- In an `open` product, a signed-in user is assigned the attached access entry's role, if present, otherwise `user`; a linked access entry becomes `active`.
- In an `invite_only` product, no entry creates a `pending` self-request. An `invited` or `active` entry is activated only after it is linked to a signed-in user; `pending`, `rejected`, and `inactive` entries do not produce a product user. Approving an unlinked entry is a `409`.
- Email/password signup is available only when both `auth_mode = open` and `email_password_enabled = true`; it creates the auth user and assigns the product `user` role. Otherwise the signup endpoint returns `403`.

Thus the operational order is: origin/product resolution → provider and access policy → authenticated identity → access-entry/membership activation → action's role, level, or permission gate. Eligibility, membership, approval, and lifecycle rules for a particular class or membership then apply inside the authorized product operation; they do not substitute for authorization.

## Role model and capability derivation

`20260612120000_permission_layer_foundation.sql` creates independent platform and product role/permission tables. A permission has scope `platform`, `product`, or `any`; the function-requirement catalog can describe an action as `public`, `authenticated`, `level`, or `permission_key`, although the Edge Functions still enforce their own guards.

| Scope | Built-in role | Level | Assignment and capability |
| --- | --- | ---: | --- |
| Platform | `platform_admin` | 100 | Protected built-in role migrated from `platform_admins`; initially grants platform provider-setting permissions and later platform admin capabilities. |
| Product | `manager` | 75 | Protected built-in role created for every product; it receives the manager grant set and is the normal manager read threshold. |
| Product | `user` | 10 | Protected built-in member role with no default management grant. |
| Product | custom role | 0–100 | A manager-level actor can create it with a snake_case key, name, and level; it can receive product/any permission grants. |

Only one active `product_user_roles` assignment is allowed per `(product_id, user_id)`. Assigning a different role is an authority-changing replacement rather than additive active roles. Assignments also maintain the older `class_kit.users` row: custom role keys are represented there as `user`, so that row is compatibility state, not the source for custom-role capability evaluation.

The SQL permission helpers derive a result only from active assignment rows. A product key check requires an active product role carrying that exact key. A product level check accepts an active product role at or above the requested level; if it fails, `requirePermissionByLevel` additionally checks platform level. In contrast, `requirePermissionByKey` for a product checks only the product grant—platform grants do **not** automatically satisfy product permission keys. Platform-scope checks use only platform roles. Failures are `403` with either a missing required level or missing required permission.

This distinction is material for custom roles: a level-75 custom product role can pass manager-level read/list guards, while an operation guarded by (for example) `memberships.manage` still needs that explicit grant. A platform admin can clear a product level guard through the fallback but cannot exercise a product key-guarded operation unless it also has an active product role carrying that key.

## Product role administration

`class-kit-product-roles` is product-origin scoped and requires an authenticated context.

- `list` and `list_permissions` accept either a product level of at least 75 or the explicit `product_role_permissions.manage` grant. The permission list exposes only `product` and `any` permissions.
- `create`, `update`, `grant_permission`, and `revoke_permission` require product level 75 (with the platform-level fallback). Custom role keys must match `[a-z][a-z0-9_]{1,48}`, and levels are integers from 0 through 100.
- The built-in `manager` role cannot be updated or have grants changed here; callers receive `409` because its definition is controlled from the admin board. The code does not make the same explicit endpoint check for the built-in `user` role, despite both roles being stored as protected.
- Granting rejects nonexistent, platform-only permission keys; revoking deletes the grant. Either change can immediately remove or add an affected role holder's access to a key-guarded product action.

`class-kit-product-user-roles` requires `product_user_roles.manage` for `list`, `assign`, and `revoke`. Assignment validates that the role belongs to the current product, activates the selected assignment, and preserves the last actor able to manage product roles: the assignment helper maps database `last_product_grant_authority` to `409 Cannot remove the final product role-management actor.` Revocation sets the assignment to `inactive`, so it removes its derived capability without deleting its audit row. The endpoint's `revoke` path itself does not expose a separate last-authority error mapping; the available enforcement evidence is in the assignment RPC path.

## Manager-domain operations

The SDK's `manager/manager-api.ts` fronts manager-domain Edge Functions; clients receive only the server-approved results. Those functions resolve product context and use the current product ID in every data operation, so a caller cannot select another product by ID.

| Operation family | Authority boundary | User-visible outcome |
| --- | --- | --- |
| Templates | Level 75 to list/read; `templates.manage` for mutations in `class-kit-templates`. | Authorized managers can define and revise class sources; callers without the applicable level/grant receive `403`. |
| Schedules and generated classes | Level 75 for list/get/preview; `schedules.manage` for create/update/pause/archive/skips in `class-kit-schedules`. | A manager can control recurrence and generated-class lifecycle for its product. `pause` and `archive` set persistent schedule state; deleting a skip removes that exception. |
| Attendance | Level 75 for `list_class`; `attendance.manage` for `start`, `update_attendance`, `add_walk_in`, `add_trial`, and `complete` in `class-kit-attendance`. | Authorized managers can start/complete attendance and change participant attendance, including walk-in/trial participation; `present` and `absent` are the supported attendance values, and those transitions affect the recorded class outcome. |
| Memberships | Level 75 for operational lists; `memberships.manage` for `create_type`, `update_type`, `deactivate_type`, `grant`, `set_for_user`, `upgrade`, and `revoke`; `memberships.adjust_stock` for `adjust_stock` in `class-kit-memberships`. | Types support `stock`, `limited_stock`, `limited`, and `infinite` modes. Authorized actors can create and deactivate types, alter grants, revoke entitlement, and alter remaining stock. Revocation/deactivation can remove availability; stock adjustment changes future registration capacity. |

These guards are capabilities, not a bypass for domain state. For example, a manager authorization result does not make an archived schedule active, a revoked membership valid, or an unavailable class registerable.

## Platform administration

The admin SDK (`class-kit-sdk/src/admin/admin-api.ts`) and `apps/class-kit-admin` are consumers of platform-admin Edge Functions, not an alternate data-access route. `class-kit-admin-products`, `class-kit-admin-product-users`, and `class-kit-admin-product-change-requests` authenticate the actor as a platform admin before performing their action.

Platform administration owns products, allowed origins, auth policy and redirects, product-user setup and invitations, access approval/rejection, platform-admin membership, and change-request administration. Product-user actions include assigning or updating an active product user, inviting a user, approving/rejecting access, and adding/removing a platform admin. An already active access entry cannot be approved again; it must be deactivated through product-user management. Platform admin is therefore an administrative control-plane role, while an explicit product assignment is still required to become a product member.

## Destructive and entitlement-changing actions

The following actions have effects beyond a reversible UI preference and must be presented as state-changing operations:

| Operation | Authority | Consequence |
| --- | --- | --- |
| Product truncation | Platform level 100; `class-kit-admin-products` invokes `truncate_product`. | Permanently deletes the target product's participants, registrations, skips, classes, schedules, membership ledger/grants/types, templates, access entries, and all other product users. It preserves/restores the acting admin as that product's active manager and leaves other products untouched. SQL regression coverage exists in `supabase/tests/truncate_product_admin_action.sql`. |
| Product role grant/revoke or assignment/revocation | Product manager level/grant as described above. | Changes who can call protected operations; role revocation inactivates assignment, while permission-grant removal can strand a custom role without a capability. |
| Membership deactivation, revoke, or stock adjustment | `memberships.manage` or `memberships.adjust_stock`. | Deactivation changes whether a type remains available; revocation changes entitlement; a stock adjustment changes remaining use/capacity. |
| Schedule archive/pause and skip deletion | `schedules.manage`. | Archive/pause changes future schedule behavior; deleting a skip re-enables that skipped occurrence for generation rules. |
| Document version pruning | `product_documents.manage`. | Product document maintenance can prune excess non-published versions, permanently removing those drafts while preserving the published version policy. |
| Change-request delete | Platform admin. | `class-kit-admin-product-change-requests` soft-deletes all versions in the request thread by setting `deleted_at` and `deleted_by_user_id`; ordinary listings exclude them. |

## Evidence and known gaps

Current implementation directly supports the resolution, access activation, role, permission, manager-domain, and admin claims above in the shared context, Edge Functions, migrations, and SDK facades. The product-truncation isolation contract has focused SQL regression coverage. This snapshot has no focused role/permission, auth-policy/access-entry, document-pruning, schedule-authorization, attendance-authorization, or change-request soft-delete regression tests; those contracts are implementation-grounded and should not be treated as independently regression-verified. In particular, the exact database behavior of the final-role-management-actor invariant and the endpoint-level behavior for revoking that final authority need focused SQL/API coverage.
