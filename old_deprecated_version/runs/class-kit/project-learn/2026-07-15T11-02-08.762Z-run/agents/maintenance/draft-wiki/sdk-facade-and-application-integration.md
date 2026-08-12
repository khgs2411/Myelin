# SDK facade and application integration

`@class-kit/react` is ClassKit's supported browser integration boundary: product applications create a client, place it in `ProductProvider`, and use the facade or context rather than invoking ClassKit Edge Functions, tables, or RPCs directly.

## Package and integration shape

The package is published as `@class-kit/react` (currently package version `0.1.18`) with React, React DOM, and `@supabase/supabase-js` as peer dependencies (`class-kit-sdk/package.json`). Its root export in `class-kit-sdk/src/index.ts` exposes:

- client construction and transport types: `createClassKitClient`, `hasClassKitClientConfig`, `ClassKitClient`, `ClassKitTransport`, and Vite configuration types;
- the React context surface: `ProductProvider`, `ProductContext`, `useProductContext`, and `useClassKitClient`;
- product-facing helpers retained for compatibility: `getProductContext`, `getProductProfile`, `listClasses`, `getClassInformation`, `registerForClass`, and `cancelClassRegistration`;
- typed public data and error contracts, including product context, access, auth, class, registration, and profile types; and
- the `admin` and `management` facade types and methods.

New work should use the client facade and provider, not the compatibility helpers (`docs/sdk/client-sdk.md`). The mounted Demo2 app follows this shape: it constructs one Vite client with a product-specific auth storage key and renders its root inside `ProductProvider` (`apps/demo2/src/class-kit-client.ts`, `apps/demo2/src/main.tsx`).

```tsx
const client = createClassKitClient(import.meta.env, {
  authStorageKey: "my-product-class-kit-auth",
});

createRoot(root).render(
  <ProductProvider client={client}><App /></ProductProvider>,
);
```

## Client construction and product identification

`createClassKitClient` has two supported forms (`class-kit-sdk/src/client/class-kit-client.ts`):

- **Vite form:** `createClassKitClient(import.meta.env, { authStorageKey, debug? })`. `authStorageKey` is mandatory and missing it throws. The default target is the shared remote Supabase project. `VITE_CLASS_KIT_TARGET=local` selects `VITE_CLASS_KIT_LOCAL_SUPABASE_URL` and `VITE_CLASS_KIT_LOCAL_SUPABASE_PUBLISHABLE_KEY`; if either is absent, construction returns `null`.
- **Explicit form:** `createClassKitClient({ supabaseUrl, supabasePublishableKey, supabaseClient?, productKey?, authStorageKey?, debug? })`. It returns `null` unless supplied either a Supabase client or both URL and publishable key. An injected client is intended for non-Vite consumers and tests.

The SDK assigns the Supabase auth storage key supplied by the app (or, in the explicit form only, falls back to `class-kit-<productKey|domain>-auth`). Apps should give each product a stable, distinct key so browser sessions do not share a namespace.

Product identity is enforced by the backend, not trusted from the app. For every function call, the transport sends `x-class-kit-site-url` from the current browser URL after removing query and fragment (`class-kit-sdk/src/client/product-api.ts`). The backend requires that header to have the request `Origin`, accepts only HTTP(S), and resolves the product against that origin or path-aware site URL (`class-kit-api/supabase/functions/_shared/cors.ts`, `class-kit-api/supabase/functions/_shared/context.ts`).

The optional `product_key` request value is deliberately narrower:

| Condition | SDK behavior | Backend outcome |
| --- | --- | --- |
| Browser is `localhost`, `127.0.0.1`, or `::1` and client has `productKey` | Adds `product_key` to the request body. In the Vite form this comes from `VITE_CLASS_KIT_LOCAL_PRODUCT_KEY` only while `DEV` is true. | Uses the hint (or `CLASS_KIT_LOCAL_PRODUCT_KEY`) to disambiguate local origins. |
| Any non-local browser origin | Does not add a product key. | Rejects a supplied `product_key` with `bad_request`; origin/site URL must identify the product. |
| No matched product | Calls still carry the origin/site URL. | Fails with `forbidden` rather than selecting an arbitrary product. |
| Multiple matches without a local hint | No implicit product selection. | Fails with `bad_request` as ambiguous. |

This is the important integration boundary: an application may configure local development, but it cannot select a production product by request payload. A path-aware header is also not an escape hatch because the backend verifies its origin before product resolution.

## Facade-to-backend boundary

All facade calls go through `invokeProductFunction` (`class-kit-sdk/src/client/product-api.ts`). It prefixes the function name with `class-kit-`, forwards the current Supabase authentication state through the client, adds the browser site header, and returns a product-facing envelope:

```ts
type ApiResponse<T> =
  | { data: T; error: null }
  | { data: null; error: { code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "internal_error"; message: string } };
```

Transport failures and empty responses are normalized to `internal_error`. The product-facing namespaces preserve this envelope: `product`, `profile`, `classes`, `signupLinks`, and `productDocuments`. `management.*` and `admin.*` instead unwrap the envelope and throw `Error` on backend errors (`class-kit-sdk/src/manager/manager-api.ts`, `class-kit-sdk/src/admin/admin-api.ts`); dashboard and control-plane UI must catch those mutations.

The public client groups the supported surface by audience:

| Namespace | Intended caller and backend route family |
| --- | --- |
| `product.getContext`, `profile.get/update/updateMetadata`, `classes.list/get/register/cancelRegistration` | Product site reads and self-service operations; calls `class-kit-product-context`, `class-kit-profile`, `class-kit-classes`, and `class-kit-register-class`. |
| `auth` | Browser Supabase session operations plus ClassKit product signup. Password signup calls `class-kit-product-signup`; password sign-in/out use the Supabase client. |
| `signupLinks`, `productDocuments` | Product-scoped signup link resolution and published-document reads/acceptance through their Edge Functions. Document list/get results are cached in SDK memory and `localStorage` for five minutes. |
| `management.*` | Product-context operational dashboard methods for classes, templates, schedules, registrations, attendance, memberships, signup links, documents, change requests, roles, users, and product auth mode. The backend, not the facade, evaluates the relevant product permissions. |
| `admin.*` | Platform/control-plane product, user, role, change-request, and PM-integration methods. These are not product-site signup or self-service primitives. |

The facade is a routing and typed-contract layer, not an authorization layer. Direct Edge Function, database, and RPC calls are outside the documented application contract (`docs/sdk/client-sdk.md`); even SDK context capabilities are only UI hints and backend functions remain the final authority.

## Product context and provider lifecycle

`client.product.getContext()` returns four product-scoped facts (`class-kit-sdk/src/types.ts`):

- `product`: key, name, `auth_mode`, provider flags, and managed OAuth redirects;
- `product_user`: active/inactive product assignment and role, or `null`;
- `product_access`: the access-record status and source, or `null`; and
- `capabilities`: granted permission keys plus dashboard navigation flags.

The currently supported values exposed to app UI are:

| Contract | Values | Application meaning |
| --- | --- | --- |
| `auth_mode` | `open`, `invite_only` | An open product may offer signup only if the provider is also enabled. Invite-only UI should offer sign-in, not open signup. The signup function independently rejects non-open products. |
| Product user status | `active`, `inactive` | Use to explain product membership state; do not infer authorization from it alone. |
| Product access status | `invited`, `pending`, `active`, `rejected`, `inactive` | Use to render an invitation/request outcome when an authenticated identity does not yet have an active product assignment. |
| Product access source | `admin_invite`, `self_request` | Explains how the access record originated; it is not an authority grant. |
| Auth redirect environment | `development`, `production` | The client prefers a redirect matching the browser environment, then a configured default, then the first available redirect. |

`ProductProvider` initializes the Supabase session, then fetches product context; it subscribes to Supabase auth state changes and schedules a context refresh after every event other than `INITIAL_SESSION` (`class-kit-sdk/src/context/product-provider.tsx`). A stale refresh-token error clears the configured local-storage session key. If context retrieval fails, the provider clears product, product user, product access, and capabilities, exposes the error, and stops loading. Signed-out context therefore preserves product policy but receives empty permissions and all dashboard flags false from the backend (`class-kit-api/supabase/functions/class-kit-product-context/index.ts`).

`useProductContext()` throws outside a provider. Inside it, consumers receive the client, resolved product key, context facts, `session`, `loading`, `error`, `refreshProductContext`, and provider wrappers for password sign-in/sign-up, Google sign-in, and sign-out. `useClassKitClient()` is the narrow client accessor.

## Auth and application responsibilities

Apps use product context to choose UI, while backend policy determines the result:

- Show password sign-in only when `email_password_enabled` is true; show password signup only when it is also `auth_mode: "open"`. The backend enforces both gates before it creates the auth user and assigns the product `user` role (`class-kit-api/supabase/functions/class-kit-product-signup/index.ts`).
- `signInWithGoogle()` fetches product context first. It selects a product-managed Google redirect for the browser environment; without one it returns an error and does not start OAuth. Apps do not supply arbitrary redirect URLs.
- Use `product_user` and `product_access` for denied, invite, pending, rejected, and inactive experiences. Use `capabilities.permissions` and `capabilities.dashboard` to render navigation, but retain backend error handling because frontend visibility never grants a permission.
- Use `profile` only for the caller's self-service profile. Its methods take no `userId`; product resolution plus JWT select the record. Management user and membership methods are separate permission-gated dashboard operations.

## Repository identity and evidence

Deterministic checkout evidence identifies the registered repository as `class-kit` at `/Users/liadgoren/Repositories/class-kit`, on `master`, with origin `https://github.com/khgs2411/class-kit.git` (`repository-identity.json`). This subject's behavior claims are grounded in the mounted SDK and Edge Function sources rather than the mounted repository's `.git` metadata.

## Known gaps

- No dedicated SDK unit/integration tests for client construction, browser-header forwarding, local product-key gating, or `ProductProvider` refresh/error behavior were found in the supplied snapshot. The code was inspected, but the documented client lifecycle is not regression-test corroborated here.
- The package publishes `src` alongside `dist`, while the package entrypoint is `dist/index.js`; this snapshot was not built or compared against a packed artifact, so source exports are the verified contract and release-artifact parity remains unverified.
- Backend source verifies origin and local-hint constraints, but no deployed environment or end-to-end browser run was available to confirm current allowed-origin and OAuth-redirect configuration.
