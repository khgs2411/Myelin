# SDK and Edge Function API surface

ClassKit's supported application boundary is the `class-kit-sdk` facade over product-scoped Supabase Edge Functions; product apps should not build against raw function names, actions, service-role access, or `class_kit` tables.

## Boundary and request contract

`createClassKitClient(...)` returns the public namespaces in `class-kit-sdk/src/client/class-kit-client.ts`. Its common transport (`class-kit-sdk/src/client/product-api.ts`) prefixes each supplied function name with `class-kit-`, invokes it through `supabase.functions.invoke`, passes the browser's path-aware `x-class-kit-site-url`, and adds `product_key` only for localhost browser origins. This makes the SDK the place that translates camelCase app inputs into Edge Function snake_case payloads.

Every Edge Function accepts POST JSON and returns the shared envelope `{ data, error }`; the currently supported error codes are `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, and `internal_error` (`docs/api/backend-api.md`). Product resolution happens before product-scoped operations: the backend resolves the `Origin` plus optional site URL and local-only product-key hint, then loads the bearer-token user when required (`class-kit-api/supabase/functions/_shared/context.ts`). Missing JWTs fail protected operations before their permission guards.

The boundary is a product contract, not a hard TypeScript capability boundary. `ClassKitClient` deliberately exposes its `supabase` transport, and `invokeProductFunction` is exported from the package. The authored API reference nevertheless says product websites use `@class-kit/react`/the SDK and must not call Edge Functions directly (`docs/api/backend-api.md`). Direct calls can bypass SDK payload naming, caching, redirect selection, and future response normalization; they are unsupported app integration points. The only SDK-owned direct Supabase calls are Auth (`getSession`, password/OAuth sign-in, sign-out) and signed-URL Storage upload during change-request attachment upload.

## Customer and shared namespaces

| SDK surface | Edge Function and action | Notes |
| --- | --- | --- |
| `product.getContext()` | `class-kit-product-context` (no action) | Anonymous-aware product, access, and capability context. |
| `profile.get()` / `profile.update(input)` / `profile.updateMetadata(metadata)` | `class-kit-profile` (read) / `update` | Current JWT user only; update maps `displayName`, `phoneNumber`, and metadata. |
| `auth.signUp()` / `auth.signUpWithPassword()` | `class-kit-product-signup` (no action) | SDK then signs in through Supabase Auth. `signIn*`, `getSession`, and `signOut` are Supabase Auth calls, not Edge Function actions. |
| `auth.signInWithGoogle()` | `class-kit-product-context`, then Supabase OAuth | Context supplies the configured redirect before `signInWithOAuth`. |
| `classes.list()` / `classes.get()` | `class-kit-classes:list` / `get` | Caller-safe discovery and detail. `fields` is forwarded. |
| `classes.register()` / `classes.cancelRegistration()` | `class-kit-register-class:register` / `cancel` | Backend owns the registration transition and entitlement side effects. |
| `signupLinks.resolve()` | `class-kit-signup-links:resolve` | Anonymous-safe resolution. |
| `productDocuments.list()` / `get()` / `accept()` | `class-kit-product-documents:list` / `get` / `accept` | SDK caches successful list/get results for five minutes; accept is not cached. |

`product-context` is the access-precedence surface. Signed-out callers receive empty capabilities. For signed-in callers it resolves product context and provider availability, then exposes product access/product-user state. This is implemented in `class-kit-product-context/index.ts` together with `ensureProductAccess`, rather than being a frontend decision.

| Gate / supported value | Outcome before a caller becomes a product user |
| --- | --- |
| Existing active product user | Returned as-is; its existing access entry is used, or a synthetic active summary is returned. |
| Platform admin without product membership | Rejected: platform authority does not create customer-product membership. |
| `auth_mode: open` | A signed-in non-platform-admin caller receives the entry's role or `user`, is assigned product membership, and any attached access entry becomes `active`. |
| `auth_mode: invite_only` with no entry | A signed-in caller gets a self-request `pending` entry and no product user. |
| `auth_mode: invite_only` with `invited` or `active` entry | The entry is attached to the signed-in user, activated, and produces product membership. |
| `auth_mode: invite_only` with `pending`, `rejected`, or `inactive` entry | The status is returned with no product user; protected product-user operations subsequently fail forbidden. |

Thus the precedence is origin/product resolution, provider validation, JWT identity, existing product membership, platform-admin exclusion, and only then open/invite access handling. `ProductAccessStatus` is exactly `invited`, `pending`, `active`, `rejected`, or `inactive`; clients may render it, but must not replace this backend decision sequence.

## Management namespaces

All `management.*` calls use the same product-context transport and throw the backend envelope's error message rather than returning the envelope (`callManagerApi` in `class-kit-sdk/src/manager/manager-api.ts`). Permission and level checks remain in the target function.

| Namespace | Function: actions exposed by SDK |
| --- | --- |
| `management.classes` | `class-kit-classes`: `list_manager`, `get_manager`, `create`, `update`, `publish`, `draft`, `cancel` |
| `management.templates` | `class-kit-templates`: `list`, `get`, `create`, `update`, `deactivate` |
| `management.schedules` | `class-kit-schedules`: `list`, `get`, `create`, `update`, `preview`, `pause`, `archive`, `create_skip`, `delete_skip`; `generate` uses the separate `class-kit-schedule-generate` function |
| `management.registrations` | `class-kit-manage-registrations`: `list_pending`, `list_registered`, `approve`, `reject` |
| `management.attendance` | `class-kit-attendance`: `list_class`, `start`, `update_attendance`, `add_walk_in`, `add_trial`, `complete` |
| `management.memberships` | `class-kit-memberships`: `list_types`, `create_type`, `update_type`, `deactivate_type`, `grant`, `set_for_user`, `upgrade`, `revoke`, `adjust_stock`, `list_user_grants`, `list_ledger` |
| `management.signupLinks` | `class-kit-signup-links:create` |
| `management.productDocuments` | `class-kit-product-documents:upsert`, `archive` |
| `management.changeRequests` | `class-kit-product-change-requests`: `list`, `create`, `update`, `delete`, `create_attachment_upload`, `complete_attachment_upload` |
| `management.roles` | `class-kit-product-roles`: `list`, `list_permissions`, `create`, `update`, `grant_permission`, `revoke_permission` |
| `management.users` | `class-kit-product-users`: `list`, `get`, `update_profile`, `update_metadata`; nested `roles.assign/revoke` uses `class-kit-product-user-roles:assign/revoke` |
| `management.product.updateAuthMode` | `class-kit-admin-products:update_auth_policy` |

The SDK deliberately names `skipDate`/`unskipDate` instead of the backend actions `create_skip`/`delete_skip`, and exposes schedule generation under `schedules.generate` despite its dedicated function. Management attachment convenience method `uploadAttachment` performs the three-step API/upload/API protocol: request signed upload URL, upload directly to the private Storage bucket, then complete the attachment.

## Platform-admin namespaces

`admin.*` uses `callAdminApi`, which has the same throwing behavior as management calls. These operations are platform-control APIs, not substitutes for customer product flows.

| Namespace | Function: actions exposed by SDK |
| --- | --- |
| `admin.products` | `class-kit-admin-products`: `list_products`, `create_product`, `update_auth_policy`, `add_origin`, `remove_origin`, `add_auth_redirect`, `remove_auth_redirect`, `set_default_auth_redirect`, `truncate_product` |
| `admin.users` | `class-kit-admin-product-users`: `create_user`, `list_product_users`, `assign_product_user`, `update_product_user`, `invite_product_user`, `approve_product_access`, `reject_product_access`, `add_platform_admin`, `remove_platform_admin` |
| `admin.productRoles` | `class-kit-admin-product-roles`: `list_roles`, `list_permissions`, `create_role`, `update_role`, `grant_permission`, `revoke_permission`, `grant_manager_permission`, `revoke_manager_permission`, `list_user_roles`, `assign_user_role`, `revoke_user_role` |
| `admin.changeRequests` | `class-kit-admin-product-change-requests`: `list`, `update_status`, `delete`, `create_attachment_download_url` |
| `admin.pmIntegrations` | `class-kit-admin-pm-integrations`: `get_config`, `get_board_snapshot`, `sync_board_snapshot`, `update_config`, `test_connection`, `create_work_item`, `detach_work_item`, `sync_work_item`, `sync_linked_work_items` |

## Edge Functions outside the current SDK facade

These deployed functions have no current `ClassKitClient` namespace and should not be treated as product-app API:

- `class-kit-platform-app-context` takes `app_key` and resolves a platform application/origin and redirects; it is a separate platform-app contract.
- `class-kit-admin-promote-manager` takes `user_id` and requires platform level 100.
- `class-kit-manager-promote-manager` takes `user_id` and requires `product_user_roles.manage` for the resolved product.
- `class-kit-manage-registrations` additionally implements `list_class`, `cancel`, `approve_rejected`, and `allow_reregister`; these are backend actions not exposed by `management.registrations`.
- `class-kit-classes:list_public` and `list_user`, and `class-kit-product-user-roles:list`, are likewise implemented but have no matching current SDK method.

These gaps are intentional only to the extent shown by the current source: `docs/api/backend-api.md` labels the promotion functions legacy/specialized. No deprecation marker was found for the other backend-only actions, so callers should not infer that they are stable public APIs.

## Evidence and known gaps

The mapping above cross-checks SDK invocation code with the action dispatches in `class-kit-api/supabase/functions/*/index.ts` and the maintained API references in `docs/api/backend-api.md` and `docs/api/class-api-map.md`. The four available SQL regression scripts cover member auto-approval, pending cancellation, schedule backfill, and product truncation, not SDK serialization, every function action, generic error-envelope behavior, or the direct-access boundary. There are no discovered SDK unit/integration tests that prove façade-to-function parity. Future changes should add a contract test whenever a namespace, action, or payload translation changes.
