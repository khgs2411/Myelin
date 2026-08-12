# SDK and product-facing API

`@class-kit/react` is the supported browser boundary for a product website: it creates a typed Supabase transport, resolves the product through the browser request context, and exposes customer, manager, and platform-control namespaces without giving the browser direct table or RPC access.

## Boundary and request contract

`class-kit-sdk/src/index.ts` exports the client constructors, product API helpers, React context/provider, admin and manager facades, and public response types. `createClassKitClient` in `class-kit-sdk/src/client/class-kit-client.ts` accepts either an existing Supabase client or URL/publishable-key configuration, returns `null` when neither transport configuration is present, and keeps a product-specific auth storage key. Its Vite overload requires `authStorageKey`; it chooses the local Supabase values only when `VITE_CLASS_KIT_TARGET=local`, otherwise the packaged remote endpoint is used.

Every SDK function call goes through `invokeProductFunction` in `class-kit-sdk/src/client/product-api.ts`. It adds the `class-kit-` function prefix, returns the common envelope rather than throwing, and sends the path-aware `x-class-kit-site-url` header. The header strips query/hash and must remain same-origin. A configured `productKey` is sent only from `localhost`, `127.0.0.1`, or `::1`; it is a development disambiguation hint, not a production authorization mechanism. The backend still resolves and validates the product from `Origin` and site URL (`docs/api/backend-api.md`).

All direct product methods return:

```ts
type ApiResponse<T> =
  | { data: T; error: null }
  | { data: null; error: { code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "internal_error"; message: string } };
```

Manager and admin wrappers deliberately differ: `callManagerApi` and `callAdminApi` unwrap a successful envelope and throw `Error(message)` for an API error. UI code using those namespaces must therefore handle rejected promises; customer-facing `product`, `profile`, `classes`, documents, and signup-link methods inspect `response.error`.

The SDK is not the authority boundary. `class-kit-api` Edge Functions use trusted service-role access after product resolution, authentication, access lifecycle, and permission guards. Product apps should use the SDK, not raw functions; raw function names and action strings remain implementation details (`docs/api/backend-api.md`).

## Product context and React integration

`client.product.getContext()` invokes `class-kit-product-context`. Its response is the initial product-facing state:

- `product`: key, name, `auth_mode` (`open` or `invite_only`), enabled password/Google providers, and configured provider redirects;
- `product_user`: active/inactive product membership role plus `has_active_membership`, or `null`;
- `product_access`: `invited`, `pending`, `active`, `rejected`, or `inactive` access-entry state, or `null`;
- `capabilities`: explicit product permission keys and derived dashboard flags.

The function is anonymous-aware. Signed-out callers receive product policy with `permissions: []` and all dashboard flags false. For a signed-in non-platform-admin, it runs product-access processing before returning the membership/access state. It then derives dashboard flags strictly from product permission keys: `classes.create` enables class management; `product_roles.manage` or `product_role_permissions.manage` enables role management; `product_user_roles.manage` enables user management; `product.auth_mode.update` enables auth-mode management; any of those enables dashboard entry. Those flags are navigation hints only—the receiving Edge Function rechecks authority. A platform admin is not implicitly a product user, so product-local capabilities can remain empty even where a later level-based platform administration operation succeeds.

`ProductProvider` owns this response in React. It first reads the Supabase session, calls `getContext`, subscribes to auth-state changes, and refreshes context asynchronously after every non-initial auth event. It exposes `client`, `productKey`, product/user/access/capability values, `session`, `loading`, `error`, auth helpers, and `refreshProductContext` through `useProductContext`; `useClassKitClient` returns the same client. It clears a stored session on a stale-refresh-token error, but otherwise surfaces configuration/auth/context failures in `error` and resets the product-facing values. Calling either hook outside the provider throws. This makes the provider a UI state adapter, not a way to bypass backend checks.

## Customer-facing namespaces and outcomes

| Namespace | Supported operations and response shape | Authority and visible outcome |
| --- | --- | --- |
| `auth` | `getSession`, password `signIn`/`signInWithPassword`, Google OAuth, password `signUp`/`signUpWithPassword`, and `signOut`; mutations return `{ error: string \| null }`. | Password signup goes through `class-kit-product-signup`, which requires a resolvable open product with password auth enabled; it creates both identity and product membership before signing in. Google first obtains product context and chooses the configured redirect for the local/production browser environment; it fails client-side if none exists. Authentication alone does not grant invite-only product access. Sign-out removes the Supabase session. |
| `profile` | `get()` returns product identity, the caller’s profile, role assignments, all membership grants, and the selected active grant. `update({ displayName?, phoneNumber?, metadata? })` and `updateMetadata(metadata)` return `{ profile, product_user }`. | `class-kit-profile` requires JWT authentication, resolved product context, and active product access. It always uses the JWT user id: callers cannot target another user, role, or membership. Name/phone are upserted in the shared profile; metadata shallow-merges into that caller’s product membership. Metadata must be an object and an update needs at least one field. |
| `classes` | `list({ range?, fields? })`, `get(classId, { fields? })`, `register(classId)`, and `cancelRegistration(registrationId)`. Lists return `classes`; get returns `class`; registration returns `{ registration_id, status, stock_consumed, registration }`. | List/get resolve anonymous product context and return only published, non-cancelled, public or members-only classes. Summary fields include temporal status, registration-open, caller registration state, `canRegister`, and `canCancelRegistration`. Description/category are optional fields; protected extra fields require `classes.extra_fields.read` (roster and pending counts are never made public merely by request). Register/cancel require an authenticated active product user and delegate final capacity, membership, policy, and state transitions to service-only RPCs. |
| `signupLinks` | `resolve(slug)` returns `{ link }`. | This is a public discovery read, still product-origin scoped. Manager creation is under `management.signupLinks.create`; a link targets either one class or a filter. |
| `productDocuments` | `list({ locale? })`, `get(documentType, { locale?, fallbackLocale? })`, and `accept(documentType, { locale?, fallbackLocale?, context? })`; reads return document summaries/content and accept returns an acceptance snapshot. | Public reads expose only published versions and are cached by the SDK in memory for five minutes. Acceptance requires an active product user and records document id, locale, version, title, and markdown snapshot—later edits do not rewrite prior acceptance evidence. Manager versioning/archiving is under `management.productDocuments`. |

### Class visibility, state, and registration gates

The caller-safe class responses make these current values visible: visibility is `public`, `hidden`, or `members_only`; publication is `draft` or `published`; temporal state is `upcoming`, `started`, `ended`, or `cancelled`; registration status is `pending`, `approved`, `rejected`, or `cancelled`; policy is `auto_approve`, `member_auto_approve`, or `approval_required`; membership requirement is `none` or `required`.

The server applies the gates in this order of effect:

1. Product resolution and the class query exclude other products, drafts, and cancelled classes. Normal SDK list/get includes public and members-only visibility; `hidden` is omitted. An anonymous or non-member caller can see members-only class metadata through this caller-safe API, but `canRegister` is false when membership is required.
2. A class is registration-open only while it is published and `upcoming`. A live `pending` or `approved` registration also makes `canRegister` false.
3. Registration requires active product-user access. The registration RPC then rejects missing required membership, depleted stock, full capacity, invalid class state, and duplicate live registrations.
4. `auto_approve` approves immediately; `member_auto_approve` approves an active member and leaves a non-member pending; `approval_required` leaves registration pending. The SQL regression test `supabase/tests/member_auto_approve_registration.sql` verifies those three outcomes and required-membership rejection.

Cancellation is a state transition, not deletion. Pending or approved registrations are normally cancellable only before the product cutoff (default 24 hours before class start); a pending registration is the explicit exception and may be cancelled after that cutoff. The resulting status is `cancelled`; stock effects, if any, are handled by the backend RPC. `supabase/tests/pending_registration_cancellation.sql` verifies the pending-after-cutoff exception and that an approved after-cutoff cancellation is rejected. The class API’s `canCancelRegistration` is a UI prediction and does not replace this RPC check.

## Management and platform-control facades

The published `management` namespace is product-scoped operational API, not a client-side permission system. It covers:

- `classes`: list/get/create/update/publish/draft/cancel;
- `templates`: list/get/create/update/deactivate;
- `schedules`: list/get/create/update/preview/generate/pause/archive/skipDate/unskipDate;
- `registrations`: list pending/registered and approve/reject;
- `attendance`: list, start, update participants, add walk-ins/trials, complete;
- `memberships`: membership-type lifecycle, grant/set/upgrade/revoke, stock adjustment, grant and ledger reads;
- `signupLinks.create`, product-document `upsert`/`archive`, change-request lifecycle/attachments, roles/permissions, product users and role assignment, and product auth-mode update.

These methods route to the corresponding `class-kit-*` functions listed in `docs/api/backend-api.md`; they retain product context and server-side guards. In particular, class create requires `classes.create`; update, publish, draft, and cancel have their own product permission keys. The class handler rejects registration actions on class CRUD, schedule-generated source fields, and invalid time/capacity/enum inputs. Class cancellation changes lifecycle state and can expose a supplied reason—an operationally visible and potentially irreversible outcome. Schedule archive/deactivate, membership revocation/replacement, document archive, role/permission revocation, registration rejection, attendance completion, and change-request deletion are likewise state-changing operations; consumers must present confirmation and refresh server state rather than treating local cached values as authority.

`admin` is the separate platform-control namespace. It can manage products, origins and OAuth redirects, provider policy, product users/access decisions, platform admins, cross-product roles/permissions, change-request review, and PM integration. It takes explicit product keys because it may operate outside the browser-resolved product. `admin.products.truncate` is especially destructive: it is a level-100 platform-admin operation that removes product-scoped operational data (including classes, schedules, templates, registrations, attendance, memberships, access entries, and non-admin product-user assignments) while preserving product configuration, roles/permissions, and the invoking admin baseline. A consuming UI must require exact product-key confirmation before invoking it (`docs/api/backend-api.md`).

## Response-shape ownership

The public TypeScript contracts in `class-kit-sdk/src/types.ts` are the browser schema: product/access summaries, capabilities, profile/membership records, and class/registration enums use camelCase for SDK-facing fields. The Edge Functions deliberately map database rows into those shapes; apps should not infer schema columns. Manager/admin response types are exported from `manager/manager-api.ts` and `admin/admin-api.ts` and retain their API-specific names (many are snake_case), which is why product apps should not mix customer and control-plane responses.

## Evidence and known gaps

Current implementation evidence is `class-kit-sdk/src/index.ts`, `client/class-kit-client.ts`, `client/product-api.ts`, `context/product-context-state.ts`, `context/product-provider.tsx`, `types.ts`, `manager/manager-api.ts`, `class-kit-api/supabase/functions/class-kit-product-context/index.ts`, `class-kit-profile/index.ts`, `class-kit-classes/index.ts`, and `class-kit-register-class/index.ts`. `docs/api/backend-api.md` supplies the live API map and guards for the additional published manager/admin namespaces.

Focused SQL regression evidence exists for member-auto-approve/required-membership registration and post-cutoff pending cancellation. This snapshot does not show focused endpoint-level tests for product-context resolution/access transitions, profile mutation, SDK transport/header behavior, documents/signup links, or every manager/admin action. Those contracts are implementation-grounded, but the missing focused coverage should be treated as a verification gap rather than proof that every failure mode is regression-protected.
