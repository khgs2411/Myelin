# SDK Integration

`@class-kit/react` is the supported browser boundary for a ClassKit product website: it supplies the typed client facade and React product context, while the website owns its UI and the ClassKit backend retains product resolution, policy, and authorization.

## Supported integration boundary

The expected request path is `frontend app -> @class-kit/react -> class-kit-* Edge Functions -> class_kit schema`. Product websites own routes, layout, branding, copy, and interaction details; they must not query ClassKit tables or RPCs directly, invoke Edge Functions by name, or reproduce permission policy in browser code. The SDK hides transport/action details, normalizes product-facing methods, and exposes typed namespaces instead. See `docs/getting-started.md`, `docs/product-shape.md`, and `docs/api/class-api-map.md`.

ClassKit does not ship a reusable visual component library. Build product UI with the consuming app's design system, then call the SDK from that UI (`docs/product-shape.md`).

## Installation and release consumption

Install the private package by release tag. The current documented tag is `v0.1.18`:

```json
{
  "dependencies": {
    "@class-kit/react": "git+ssh://git@github.com/khgs2411/class-kit-sdk.git#v0.1.18"
  }
}
```

```bash
bun add git+ssh://git@github.com/khgs2411/class-kit-sdk.git#v0.1.18
```

Use the explicit `git+ssh://` URL and pin a version tag in `package.json`; do not pin a raw release commit hash. A resolved commit in `bun.lock` is normal. The scp-style Git URL can hang Bun's resolver. If a newly-created tag remains unavailable, clear Bun's package cache with `bun pm cache rm` and retry (`docs/sdk/client-sdk.md`, `docs/changelog.md`).

The consumer and every CI/static-host build environment need read access to the private `khgs2411/class-kit-sdk` repository. Static deployments should use a separate read-only deploy key, configure SSH before dependency installation, and keep that private key in deployment secrets. `docs/shared/deployment.md` documents the GitHub Pages pattern and the `CLASS_KIT_SDK_DEPLOY_KEY` secret.

The SDK peer dependencies are React, React DOM, and `@supabase/supabase-js` (`docs/sdk/client-sdk.md`).

## Client configuration

Create one client in a product-local module and give the product an explicit, stable browser auth storage namespace:

```ts
import { createClassKitClient } from "@class-kit/react";

export const classKit = createClassKitClient(import.meta.env, {
  authStorageKey: "my-product-class-kit-auth",
});
```

This Vite constructor is the preferred integration. It uses the shared remote ClassKit Supabase project by default and requires `authStorageKey`; omit it and construction throws. Production Vite consumers normally require no ClassKit frontend env values.

For local development against the remote shared Supabase project, configure only the local disambiguation hint:

```env
VITE_CLASS_KIT_LOCAL_PRODUCT_KEY=<product-key>
```

For an intentional local Supabase target, configure all of these:

```env
VITE_CLASS_KIT_TARGET=local
VITE_CLASS_KIT_LOCAL_SUPABASE_URL=http://127.0.0.1:54321
VITE_CLASS_KIT_LOCAL_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
VITE_CLASS_KIT_LOCAL_PRODUCT_KEY=<product-key>
```

When `VITE_CLASS_KIT_TARGET=local` lacks its local URL or publishable key, client construction returns `null`; treat it as a runtime configuration error and render an appropriate app failure state. Non-Vite clients, tests, and custom Supabase-client injection may use the explicit configuration-object constructor instead (`docs/sdk/client-sdk.md`).

`VITE_CLASS_KIT_LOCAL_PRODUCT_KEY` is a localhost-only development hint. In production, the backend resolves the product from the request origin and path-aware site URL. The SDK sends the hint only from localhost, and the backend accepts it only for localhost. A frontend-supplied product key does not establish product identity (`docs/getting-started.md`, `docs/shared/authentication.md`).

Debug logging defaults on for localhost unless disabled. Pass `debug: false`, `debug: true`, or a `(event) => void` handler to either client constructor; a handler receives structured client, invoke, product-context, and Google redirect events (`docs/sdk/client-sdk.md`).

## React product context

Wrap ClassKit-powered UI with `ProductProvider`, then read shared state through `useProductContext()`:

```tsx
import { ProductProvider, useProductContext } from "@class-kit/react";
import { classKit } from "./class-kit";

export function App() {
  return <ProductProvider client={classKit}>{/* routes */}</ProductProvider>;
}

function AccountArea() {
  const { product, productUser, productAccess, capabilities, session, loading, error } =
    useProductContext();
  // Render product-owned UI from this state.
}
```

The provider loads the Supabase session, calls `client.product.getContext()`, refreshes context after auth-state changes, and exposes `refreshProductContext`, `signIn`, `signUp`, `signInWithGoogle`, and `signOut` alongside the client and state. It chooses the backend-configured Google redirect for the active browser environment and fails before navigation when no matching product-managed Google redirect exists. Signed-out context has empty capabilities (`docs/sdk/client-sdk.md`).

Treat context fields as UI inputs, not authorization:

- `product` provides product identity and auth policy (`auth_mode`, enabled providers, and configured redirects).
- `productUser` indicates active product membership for the signed-in identity.
- `productAccess` describes an existing invite/pending/rejected/inactive access state when there is no active product user.
- `capabilities.permissions` and `capabilities.dashboard` control navigation and visibility for product-operational UI.
- `session`, `loading`, and `error` support app-level auth and loading states.

An authenticated Supabase identity is global; ClassKit membership, roles, and permissions are product-scoped. Backend functions remain the authority even when UI hides an unavailable action (`docs/shared/authentication.md`, `docs/product-shape.md`).

## Authentication and redirects

Use `product.auth_mode` and the provider flags to select auth UI:

- `open`: eligible users can sign in and may sign up when the selected provider is enabled.
- `invite_only`: expose sign-in, not open sign-up. A Google identity may exist globally yet still lack ClassKit product access.
- `email_password_enabled`: controls password sign-in and, in open mode, password sign-up.
- `google_oauth_enabled`: controls Google affordances; in open mode it may also support sign-up-oriented UI.

SDK auth methods are `auth.getSession()`, `signIn`/`signInWithPassword`, `signInWithGoogle`, `signUp`/`signUpWithPassword`, and `signOut`. Password signup goes through the ClassKit `product-signup` backend flow so it can apply product policy while creating identity and membership. After an in-place auth flow, call `refreshProductContext`; after OAuth redirect, let `ProductProvider` reload session and context (`docs/sdk/client-sdk.md`).

OAuth return URLs are product-managed ClassKit configuration, not frontend env values or SDK options. The redirect must be configured both in the Supabase Auth allow list and in ClassKit's product auth redirect records. Product apps must not hard-code or pass redirect URLs (`docs/shared/authentication.md`).

## Using the public facade

Prefer `createClassKitClient` and its namespaces for all new product work. Edge Function-backed product methods return `{ data, error }`; management and admin methods throw `Error` for backend API errors, so operational mutations need normal UI error handling (`docs/sdk/client-sdk.md`).

Choose the narrowest surface for the workflow:

| Surface | Intended use |
| --- | --- |
| `product.getContext()` | Product identity, current access, policy, and capabilities; normally loaded by `ProductProvider`. |
| `auth.*` | Session and password/Google auth flows. |
| `profile.*` | Current authenticated product user's own profile, metadata, role assignments, and membership details. Self-updates never take a `userId`. |
| `classes.*` | Customer-safe class list/detail, registration, and self-cancellation. Backend controls visibility, capacity, membership, and cutoff rules. |
| `signupLinks.resolve(slug)` | Anonymous-safe resolution of a product-scoped class or filtered-discovery link. |
| `productDocuments.*` | Anonymous-safe published legal/policy reads and active-user document acceptance. Reads are cached for five minutes. |
| `management.*` | Current-product operational dashboards: classes, templates, schedules, registrations, attendance, memberships, signup links, product documents, roles/users, change requests, and product auth-mode updates. Requires product-scoped authority. |
| `admin.*` | Platform/control-plane operations, including explicit `productKey` targeting, cross-product change-request handling, and admin PM integration. Not normal product-site behavior. |

`management` is intentionally not named `manager`: custom product roles can receive operational permissions without being the built-in manager role. Use product-context capabilities to decide what to render, but preserve backend errors as the final authority (`docs/api/class-api-map.md`, `docs/sdk/client-sdk.md`).

For customer account pages, use `profile.get()`, `profile.update(...)`, and `profile.updateMetadata(...)`, rather than management user or membership APIs. For normal product change requests, use `management.changeRequests.*`; product sites and manager dashboards must not call `admin.pmIntegrations.*` or model Trello. Trello is an admin-only operations mirror (`docs/sdk/client-sdk.md`, `docs/changelog.md`).

Legacy helper exports such as `getProductContext`, `listClasses`, `getClassInformation`, `registerForClass`, and `cancelClassRegistration` remain for compatibility only. New product integrations should use the facade and provider (`docs/sdk/client-sdk.md`).

## Integration checks

When upgrading the SDK tag or adding a product integration, verify the consuming app build plus these browser behaviors:

- signed-out product context loads without direct database access;
- password and Google affordances follow the product policy flags;
- Google uses the configured redirect for the matched environment;
- invite-only UI does not expose open sign-up;
- auth completion refreshes product context and unauthorized users receive a clear access state;
- customer UI uses customer-safe namespaces, while manager/admin UI uses the appropriately scoped facade;
- the deployment environment can clone the private tagged dependency before its package install.

The SDK repository's own validation command is `npm run build` from `class-kit-sdk` (`docs/sdk/client-sdk.md`).
