# SDK and API facade

ClassKit’s supported browser boundary is the published `@class-kit/react` client: product sites call its product-facing namespaces, while Edge Functions and database RPCs retain authority for product resolution, authentication, authorization, validation, and state changes.

## Supported package and client construction

`target-repo/class-kit-sdk/package.json` publishes `@class-kit/react` with `dist/index.js` and `dist/index.d.ts` as the sole package export. `target-repo/class-kit-sdk/src/index.ts` re-exports the client, transport helpers, React product context/provider, admin and management API types, and the public types listed below. Product applications should use this facade rather than call `class-kit-*` Edge Functions directly; the API map explicitly says a missing facade method should be added to the SDK instead of bypassed from a site (`target-repo/docs/api/class-api-map.md`).

`createClassKitClient` accepts either a supplied Supabase client or a URL/publishable-key configuration. It returns `null` without either configuration and otherwise exposes the underlying client as `client.supabase`, plus `productKey`, `authStorageKey`, and optional debug logger. The Vite overload requires an explicit `authStorageKey`; its target is `remote` by default and becomes `local` only when `VITE_CLASS_KIT_TARGET === "local"`. For a local browser it normalizes `127.0.0.1` to `localhost` and can include `VITE_CLASS_KIT_LOCAL_PRODUCT_KEY`.

The React integration is `ProductProvider` and `useProductContext`/`useClassKitClient` (`class-kit-sdk/src/context/`). The provider refreshes `product.getContext()` after session changes and exposes returned product, product-user, product-access, and capability data as UI state. Those capability booleans are display/routing hints, not a permission grant.

## Namespace contract

All product methods use POST Edge Functions through `invokeProductFunction` (`class-kit-sdk/src/client/product-api.ts`). The SDK normalizes a successful or domain-failed product request to `ApiResponse<T>`:

```ts
{ data: T, error: null } | { data: null, error: { code, message } }
```

Supported error codes are `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, and `internal_error`. A network/empty-response failure is normalized to `internal_error`; therefore callers must handle both transport-normalized and backend domain failures.

| Namespace | Supported operations | Boundary and intended caller |
| --- | --- | --- |
| `product` | `getContext()` | Anonymous-safe product resolution plus, for a signed-in caller, current access, permissions, and dashboard capability projection. |
| `auth` | `getSession`, email/password `signIn`/`signInWithPassword`, `signUp`/`signUpWithPassword`, `signInWithGoogle`, `signOut` | Supabase authentication helpers. Google redirect selection comes from the server-resolved product context. |
| `profile` | `get`, `update`, `updateMetadata` | Authenticated current-user profile and own membership details; no caller-supplied user id. |
| `classes` | `list`, `get`, `register`, `cancelRegistration` | Customer discovery, caller-safe detail, self-registration, and self-cancellation. `list/get` accept field/range options; registration rules remain backend-owned. |
| `signupLinks` | `resolve` | Public product-scoped slug resolution. |
| `productDocuments` | `list`, `get`, `accept` | Public published-document reads and active-user acceptance. Successful reads are cached in memory for five minutes. |
| `management.classes` | `list`, `get`, `create`, `update`, `publish`, `draft`, `cancel` | Product operational class work. |
| `management.templates` | `list`, `get`, `create`, `update`, `deactivate` | Product template work. |
| `management.schedules` | `list`, `get`, `create`, `update`, `preview`, `generate`, `pause`, `archive`, `skipDate`, `unskipDate` | Product schedule definition and generation. |
| `management.registrations` | `listPending`, `listRegistered`, `approve`, `reject` | Product registration and roster operations. |
| `management.attendance` | `listForClass`, `start`, `updateParticipant`, `addWalkIn`, `addTrial`, `complete` | Attendance lifecycle. |
| `management.memberships` | `listTypes`, `createType`, `updateType`, `deactivateType`, `grant`, `setForUser`, `upgrade`, `revoke`, `adjustStock`, `listUserGrants`, `listLedger` | Membership types, grants, stock, and ledger. |
| `management.signupLinks`, `management.productDocuments` | `create`; `upsert`, `archive` | Product-managed signup links and document versions. |
| `management.changeRequests` | `list`, `create`, `update`, `delete`, attachment upload creation/completion/convenience upload | Product-scoped requests and private attachment upload workflow. |
| `management.roles`, `management.users`, `management.product` | Role list/create/update/permission grant-revoke; user list/get/profile-metadata update/role assign-revoke; `updateAuthMode` | Product administration, guarded per action by backend permission checks. |
| `admin.products`, `admin.users`, `admin.productRoles`, `admin.changeRequests`, `admin.pmIntegrations` | Product provisioning/origins/auth redirects/truncation; cross-product users/access/platform admins; cross-product roles; request review/download URLs; Trello configuration, snapshots, sync, and link management | Platform/control-plane operations. These APIs accept explicit product keys where an operation is not tied to the browser-resolved product. |

The lifecycle verbs deliberately remain explicit: `publish`, `draft`, `cancel`, `approve`, `reject`, `start`, `complete`, `pause`, `archive`, `deactivate`, `preview`, `generate`, `skipDate`, and `unskipDate`. The facade does not hide a state transition or other side effect behind a generic `update` (`docs/api/class-api-map.md`).

## Server enforcement boundary and precedence

For every `invokeProductFunction` call, the SDK sends `x-class-kit-site-url` derived from the browser URL (without query or fragment). It sends a `product_key` body hint only on localhost. The Edge Function shared context then applies these gates in order (`class-kit-api/supabase/functions/_shared/context.ts`):

1. Resolve a product from the request site URL. In production, a supplied product-key hint is rejected; the origin must identify one product. On localhost, the request hint or `CLASS_KIT_LOCAL_PRODUCT_KEY` may disambiguate. No matched allowed origin is `403 forbidden`; multiple origin matches without a local key are `400 bad_request`.
2. Resolve the bearer token when the endpoint requires it. Missing required token or invalid token is `401 unauthorized`. A signed-in provider must be enabled by the resolved product policy before access is considered.
3. For endpoints that call `ensureProductAccess`, enforce product membership/access. A platform admin is not implicitly a product member and must be assigned explicitly. Existing active membership wins. Otherwise, `open` auto-assigns the access-entry role or `user`; `invite_only` creates a `pending` self-request when absent, activates `invited` or `active` entries, and leaves `pending`, `rejected`, or `inactive` entries without a product user.
4. Endpoint-specific gates run afterward: active product user for customer registration/acceptance, and a product-manager role and/or named permission or level for management actions. Permission level and permission-key checks are independent; a sufficiently high level does not satisfy a missing named permission.
5. The Edge Function validates input and calls the relevant RPC. Database/RPC code enforces transactional capacity, membership/stock, lifecycle, and RLS backstops; the SDK cannot override those outcomes.

Current product-context values, their user-visible outcomes, and their precedence are:

| Contract | Supported values | Outcome |
| --- | --- | --- |
| Product auth mode | `open`, `invite_only` | After origin and identity/provider checks, `open` creates active product membership for an otherwise unassigned authenticated user; `invite_only` does not. It creates a `pending` self-request if no entry exists, while an `invited` or `active` entry is activated. |
| Product access status | `invited`, `pending`, `active`, `rejected`, `inactive` | `invited`/`active` can activate an unassigned user during access assurance; `pending` is awaiting decision; `rejected` and `inactive` remain non-members. An existing active product-user assignment takes precedence over the entry status projection. |
| Product access source | `admin_invite`, `self_request` | Identifies whether the access entry originated from an administrator invitation or a user request; it does not bypass the status gate. |
| Product-user status | `active`, `inactive` | Customer registration requires `active`; inactive users fail before class eligibility/capacity/membership logic. |
| Built-in product role | `manager`, `user` | `requireProductManager` specifically requires an active `manager`; custom role permissions can still make the management facade usable where an endpoint checks a permission rather than that legacy role. |
| Auth provider exposed by product policy | email/password, `google`; redirect type also includes `apple` | Email/password and Google users are rejected when their respective resolved product flags are disabled. The SDK currently offers email/password and Google helpers, not an Apple sign-in helper. |

The `product.getContext()` response is the supported UI snapshot: it includes the resolved product policy, `product_user` (or `null`), `product_access` (or `null`), and deduplicated permissions plus derived dashboard booleans. Anonymous callers get empty permissions and all dashboard flags false. A product user’s `has_active_membership` is informational; it does not replace the registration RPC’s definitive membership and stock checks.

## Public data shapes and state vocabulary

`class-kit-sdk/src/types.ts` is the public customer-facing type contract. It exposes class visibility `public`/`hidden`/`members_only`; registration policies `auto_approve`/`member_auto_approve`/`approval_required`; membership requirement `none`/`required`; registration statuses `pending`/`approved`/`rejected`/`cancelled`; and temporal statuses `upcoming`/`started`/`ended`/`cancelled`. These values are response vocabulary, not client-side authority: registration eligibility is calculated by the backend after the access gate and before an RPC result is returned.

Manager-facing types additionally expose schedule states `draft`/`active`/`paused`/`archived`, membership modes `stock`/`limited_stock`/`limited`/`infinite`, membership-grant states `active`/`inactive`/`revoked`/`replaced`/`expired`, and attendance statuses `present`/`absent` (`class-kit-sdk/src/manager/manager-api.ts`). Their transitions and side effects are documented with the owning subjects; this facade preserves their names and routes commands but does not implement them.

## Evidence and known gaps

Implementation evidence establishes the package export, facade method types, request construction, and server-side resolution/access enforcement in `class-kit-sdk/src/index.ts`, `class-kit-sdk/src/client/class-kit-client.ts`, `class-kit-sdk/src/client/product-api.ts`, `class-kit-sdk/src/types.ts`, `class-kit-api/supabase/functions/_shared/context.ts`, and `class-kit-api/supabase/functions/_shared/permissions.ts`. `docs/api/class-api-map.md` corroborates the intended API layering and currently mapped capability surface.

The snapshot has SQL regressions for registration, schedules, and destructive product reset, but no SDK unit/integration tests were found for namespace-to-function mappings, Vite configuration branches, browser origin/header construction, or facade error normalization. The API map is authored documentation, so endpoint-by-endpoint permission and lifecycle claims beyond the shared enforcement code still require implementation/test verification in their owning subjects.
