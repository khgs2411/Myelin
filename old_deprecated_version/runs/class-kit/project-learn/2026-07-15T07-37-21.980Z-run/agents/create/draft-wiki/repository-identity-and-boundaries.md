# Repository Identity And Product Boundaries

ClassKit is a multi-repository, Supabase-backed class and membership platform whose product behavior is owned by its API and React SDK, while websites own presentation.

## Repository topology and documentation ownership

The documented local layout is a parent `class-kit/` folder containing `README.md`, `docs/`, `apps/`, `class-kit-api/`, and `class-kit-sdk/` ([`docs/repositories/structure.md`](../target-repo/docs/repositories/structure.md)). The intended ownership is:

| Surface | Responsibility | Not its responsibility |
| --- | --- | --- |
| Parent `README.md` and `docs/` | Canonical, cross-layer documentation, architecture, deployment, API, SDK, and product-boundary material | Source implementation |
| `class-kit-api/` | Supabase migrations, schema behavior, Edge Functions, RLS/security, product resolution, policy, and authorization | Website UI and SDK-facing ergonomics |
| `class-kit-sdk/` | `@class-kit/react` typed facade, React context/provider, auth/session behavior, request/response normalization | Reusable visual components or website-specific UI |
| `apps/demo2/` | Client-facing dogfood/consumer website | ClassKit product source or policy |
| `apps/class-kit-admin/` | Platform/admin operating surface | A customer-facing ClassKit product |

`README.md` is the documented root entrypoint and `docs/getting-started.md` is the canonical documentation entrypoint. The docs require durable material to be added to this parent `docs/` tree rather than repo-local READMEs or design documentation in the API, SDK, or app repositories ([`README.md`](../target-repo/README.md), [`docs/getting-started.md`](../target-repo/docs/getting-started.md)). Historical material under `docs/design/` is context, not the primary current contract.

The documented default branch is `master` unless a project explicitly says otherwise. Deterministic checkout evidence also records `master` at commit `4f55d94506f181d179f705173ecd54606b44c90c`.

## Remote-identity contradiction — needs review

The documentation says the parent `class-kit/` folder is a **local-only documentation repository** and “should not have a remote origin” ([`docs/repositories/structure.md`](../target-repo/docs/repositories/structure.md)). That is in direct conflict with the deterministic checkout record in [`repository-identity.json`](../repository-identity.json), which identifies the registered/repository root as `/Users/liadgoren/Repositories/class-kit` and records:

```text
origin = https://github.com/khgs2411/class-kit.git
branch = master
```

Treat the no-remote statement as stale or conflicting until repository ownership is reconciled. The checkout record is the current deterministic identity evidence; it does not, by itself, establish whether the remote is intended or whether the documentation should be changed. The API and SDK are separately documented as private repositories; the snapshot does not provide their independent Git identity records.

## Supported browser-to-backend boundary

The supported product-website path is:

```text
frontend website -> @class-kit/react -> class-kit-* Edge Functions -> class_kit schema
```

Product websites use SDK methods and React context rather than querying ClassKit tables, calling RPCs, knowing Edge Function action names, or implementing authorization policy themselves ([`README.md`](../target-repo/README.md), [`docs/sdk/client-sdk.md`](../target-repo/docs/sdk/client-sdk.md), [`docs/api/backend-api.md`](../target-repo/docs/api/backend-api.md)). This separation has concrete source support:

- `class-kit-sdk/src/client/product-api.ts` prefixes SDK calls with `class-kit-`, attaches the path-aware `x-class-kit-site-url` header, and invokes Edge Functions through the SDK's Supabase transport.
- `class-kit-sdk/src/client/class-kit-client.ts` creates the configured client and supplies the client-facing auth methods; it sends a `product_key` hint only when the browser origin is localhost.
- `apps/demo2/src/class-kit-client.ts` creates the SDK client and `apps/demo2/src/main.tsx` wraps the app in `ProductProvider`, rather than creating its own ClassKit transport.
- Backend request handling requires `Origin`; a supplied site URL must be HTTP(S) and have the same origin (`class-kit-api/supabase/functions/_shared/cors.ts`). Product resolution then reads the validated site URL and applies the backend-owned product context (`class-kit-api/supabase/functions/_shared/context.ts`).

The supported boundary therefore assigns these responsibilities:

| Concern | Owner | Contractual outcome |
| --- | --- | --- |
| Layout, routes, copy, visual design, and interaction polish | Website | Website-specific presentation stays local to the consuming app. |
| Typed methods, provider/context, session facade, request normalization, and hiding function/action details | `@class-kit/react` | Product UI calls the facade, not raw ClassKit database or action contracts. |
| Product lookup, auth/access policy, authorization, validation, Edge Functions, RPC orchestration, migrations, and RLS | `class-kit-api` | The backend remains authoritative for user-visible policy and mutations. |

### Product identity values and request outcomes

The frontend/backend boundary includes product-resolution inputs that affect user-visible access:

| Condition | SDK/request behavior | Backend outcome |
| --- | --- | --- |
| Normal browser request | SDK sends the current origin or path-aware URL in `x-class-kit-site-url`. | Backend resolves the product from allowed origin/site URL. |
| Header is absent | SDK does not create this case in a browser, but the backend treats the request origin as the site URL. | Product resolution proceeds from `Origin`. |
| Header is non-HTTP(S) or has a different origin than `Origin` | Invalid request. | Rejected as `bad_request` or `forbidden`, respectively. |
| Localhost/loopback development with a configured local product key | SDK adds `product_key`; it does not add it from a non-local browser origin. | The backend can use the local hint while still resolving against allowed origins. |
| Multiple local products on a local Supabase stack | Backend may be configured with `CLASS_KIT_LOCAL_PRODUCT_KEY`. | One local stack uses one selected product hint at a time; it is not a per-client production identity mechanism. |

Production product identity is backend-owned; a frontend must not choose an arbitrary product key for a production origin. The SDK path-aware header permits distinct path-based products that share one browser origin, but backend validation binds the header to the actual request origin.

## Observed exceptions and boundary risk

The implementation is not a literal universal prohibition on `supabase.functions.invoke` in every app. `apps/class-kit-admin` directly invokes `class-kit-platform-app-context` to select an admin Google redirect (`apps/class-kit-admin/src/components/admin-auth-panel.tsx`). Its product-reset component also falls back to direct `class-kit-admin-products` invocation only when the installed SDK client lacks `admin.products.truncate` (`apps/class-kit-admin/src/components/product-reset-panel.tsx`).

These are platform/admin control-surface exceptions, not a supported pattern for consumer product websites. They should remain narrowly scoped: extending them to `apps/demo2` or another product website would bypass the SDK's facade boundary. The docs' blanket wording that frontend apps do not call Edge Functions directly is therefore incomplete with respect to these existing admin-only exceptions and needs review if it is intended to cover every app category.

## Current evidence and limits

The snapshot contains implementation source for the SDK, API Edge Functions, and the two apps, plus a small SQL regression-test set. The normal SDK transport, demo2 SDK usage, origin/site-URL validation, and the two admin exceptions above are source-verified. The supplied SQL tests cover registration, schedule, and destructive-admin workflows, not an end-to-end browser-boundary contract.

## Known gaps

- No regression test was found that proves a consuming app cannot directly query `class_kit` tables/RPCs or directly invoke ClassKit Edge Functions; this remains an architectural contract supported by source inspection and documentation.
- No end-to-end test was found for the complete SDK-to-Edge-Function product-resolution path, including the same-origin path-aware header and localhost-only product-key behavior.
- The parent repository remote claim conflicts between [`repository-identity.json`](../repository-identity.json) and [`docs/repositories/structure.md`](../target-repo/docs/repositories/structure.md); intended ownership has not been verified.
- No deterministic Git identity evidence was supplied for the separate `class-kit-api` and `class-kit-sdk` repositories.
