# Architecture and repository boundaries

ClassKit is a shared-Supabase product whose public browser contract is the `@class-kit/react` SDK and whose server contract is the `class-kit-*` Edge Function family.

## Runtime boundary

The supported browser path is:

```text
product browser app -> @class-kit/react -> class-kit-* Edge Functions -> class_kit schema
```

`class-kit-sdk/src/client/class-kit-client.ts` creates a Supabase client with a publishable key and exposes typed `product`, `profile`, `classes`, authentication, management, and administration operations. `class-kit-sdk/src/client/product-api.ts` turns each product operation into a `supabase.functions.invoke` call, automatically prefixes unqualified names with `class-kit-`, and sends the current same-origin page URL in `x-class-kit-site-url`.

The SDK is the application-facing authority: product websites and local apps should use its typed facade rather than construct raw function requests. The SDK may use Supabase authentication for session operations, but it does not grant browser code direct ownership of ClassKit data. The user-visible result is a stable, typed API with uniform `{ data, error }` responses rather than UI-specific knowledge of function names, schemas, or permission internals.

Browser applications must not directly query ClassKit tables or RPCs. `README.md` and `docs/shared/deployment.md` both make this explicit, and the API configuration exposes `class_kit` for platform operation without making direct browser-table access the supported product contract. Bypassing the facade risks skipping origin, product access, membership, permission, and lifecycle enforcement implemented in the Edge Functions.

### Origin is part of the browser contract

Every product request requires an `Origin` header. The API accepts the optional `x-class-kit-site-url` only when it is an HTTP(S) URL with the same origin (`class-kit-api/supabase/functions/_shared/cors.ts`). The shared context then resolves a product by the request origin, optionally using a product key only for local origins; no match returns `Product is not allowed for this origin` (`_shared/context.ts`). If a local origin maps to more than one product and has no local product-key hint, the API rejects it as ambiguous.

This means an allowed origin is an access boundary, not merely frontend configuration. A consumer can use `VITE_CLASS_KIT_LOCAL_PRODUCT_KEY` while developing, and can opt into a local Supabase stack with `VITE_CLASS_KIT_TARGET=local` plus local URL and publishable-key settings. In normal Vite use, the SDK targets the shared remote project. A missing/incorrect allowed origin produces a visible product-context failure; changing the frontend to call tables directly is not a supported workaround.

## API and product-scoped Supabase ownership

`class-kit-api/` owns ClassKit's Supabase migrations, local seed data, Edge Functions, product policy, and permission enforcement. Edge Functions use a service-role client configured for the `class_kit` schema (`class-kit-api/supabase/functions/_shared/context.ts`); that privileged access is server-only and must not be moved into a browser application.

The shared remote Supabase project has one identity layer, `auth.users`, and separately owned product namespaces. ClassKit owns exactly:

- `class_kit.*` product tables and product-facing RPCs;
- `class_kit_private.*` internal helper functions;
- `class-kit-*` Edge Functions;
- ClassKit migrations, seed data, and API deployment pipeline; and
- the SDK package and release tags.

`docs/shared/deployment.md` assigns other products their own schemas, private schemas, and function prefixes. ClassKit must not create, alter, or drop another product's resources. The initial schema migration revokes schema access from `public`, `anon`, and `authenticated`, while granting the private schema only to `service_role`; current migrations enable RLS on ClassKit tables. The private helper schema is an implementation boundary, not a browser RPC surface.

`class-kit-api/supabase/config.toml` defines the ClassKit local project as `class_kit`, exposes `class_kit` alongside Supabase's required `public` and `graphql_public` schemas, and searches `class_kit`, `public`, and `extensions`. It also provides local auth redirect URLs and local seed loading. This configuration supports an isolated ClassKit stack; it is not authority to mirror unrelated production products locally.

The remote project is shared, so function names are globally scoped and ClassKit functions must retain the `class-kit-` prefix. Adding a new product resource outside those namespaces, broad browser grants to `anon`/`authenticated`, or a service-role key in a client would breach the ownership boundary.

## Product customers and access users

`class_kit.users` is the product-customer relation. Every row has a permanent `customer_id`; its nullable `user_id` is only the link to a Supabase authentication identity. The relationship is unique within a product for both `(product_id, customer_id)` and a non-null `(product_id, user_id)`, so a person can have separate customer records in different products. Customer-targeted queries and foreign keys carry both product scope and `customer_id`; there is no cross-product lookup or automatic identity matching.

| Customer shape | Access and service outcome |
| --- | --- |
| Linked customer (`user_id` present) | The linked identity can hold a product role/access assignment and use authenticated self-service operations when its access is active. Linked provisioning creates the customer if absent, initializing the product row from the current profile display name/phone and Auth email. Later customer contact/profile writes update the product-owned row; the current implementation has no automatic profile synchronization job. |
| Ghost customer (`user_id` absent) | A manager can create and manage the customer without creating a Supabase Auth user. It has no synthetic role, product-role assignment, JWT, or self-service access; its legacy `role` is null. It can still receive customer-targeted memberships, registrations, and attendance. |
| Active customer | It can receive new membership grants, registrations, and walk-ins when the action's other class or entitlement gates pass. |
| Inactive customer | History remains readable through the applicable manager/history paths, but new membership, registration, and walk-in mutations fail with `customer_inactive` until a manager reactivates the customer. |
| Merged customer | This is a tombstone, not a serviceable customer. A manager `get` returns `409 customer_merged` with the one-hop survivor and merge identifiers; it cannot receive new customer mutations. |

Customer lifecycle and application-access lifecycle are independent. `class-kit-customers` supports manager level-75 `list`, `get`, `create`, `update`, `deactivate`, and `reactivate`; it does not offer hard delete. Create/update reject `user_id`, role, and access-status fields, while status changes use the two lifecycle actions. Conversely, access-user administration remains linked-user-only: deactivating access changes its role assignment/access state and does not delete or deactivate the customer or erase service history. `contact_email` is product contact data; the access-oriented `email` remains the Auth/login address.

The customer API and canonical domain actions use `customer_id`. Existing linked-user actions remain compatibility wrappers that resolve a product-scoped customer from `user_id`; they cannot address a ghost. Canonical requests that accept either identifier reject both together rather than guessing the target. This protects the customer/access boundary while allowing linked consumers to transition without a second customer table.

The current SDK source exposes `management.customers.list`, `get`, `create`, `update`, `deactivate`, `reactivate`, `previewMerge`, and `merge`. Its customer shape uses `customerId`, `userId`, `identityStatus`, `customerOrigin`, and `status`; registration summaries likewise carry `customerId`, nullable `userId`, and customer status. The merge facade maps the two-phase preview token, required idempotency key, and field-resolution payload to the backend contract; applications must still refresh from the successful server result because merge is irreversible. This expanded customer facade is present in the current SDK source but remains unreleased from `v0.1.19`.

### Ghost-customer merge

`class-kit-customers` provides a manager-facing, product-scoped merge for a manager-created unlinked ghost customer into a linked, identity-provisioned survivor. Product resolution, authenticated manager identity, and the product level-75 guard precede pair validation. The source must be a `manager_created` unlinked customer, the survivor must be linked and `identity_provisioned`, and the customers must be distinct and in the same product. Either eligible customer may be `active` or `inactive`; linked sources, unlinked survivors, legacy-origin sources, and reversed pairs are rejected. This is an explicit merge, not automatic matching.

The flow is two-phase. `preview_merge` returns an opaque preview token plus source/survivor comparisons and reconciliation information. `merge` requires that token, a product-scoped UUID idempotency key, and explicit resolutions for display name, contact email, phone number, and metadata conflicts. Each scalar resolution chooses `source`, `survivor`, or a validated `replacement`; metadata conflicts use the same choices. The database performs the reconciliation atomically. Replaying the same completed command with the same idempotency key returns the same result, while state changes or expiry invalidate the preview.

On success, the survivor remains the serviceable customer and the source transitions to `merged` with a one-hop redirect. The merge preserves history while reconciling customer-owned memberships, registrations, attendance, and recipient data according to the database strategy catalog. A current linked active membership wins over a colliding ghost membership; the ghost grant becomes `replaced` and receives an audit-ledger event. The public error contract distinguishes a stale preview (`merge_preview_stale`), a command/concurrency conflict (`merge_conflict`), an already-merged source (`customer_merged`), and an unavailable recipient strategy (`merge_recipient_strategy_missing`). These are all `409` outcomes when their validated details are present.

These claims are grounded in `20260720085642_customer_identity_foundation.sql`, `20260720090353_customer_crud_and_access_separation.sql`, `20260721092534_ghost_customer_merge.sql`, the customer-oriented membership/registration/attendance/discovery migrations, and the `class-kit-customers`, shared-context, membership, registration, and attendance handlers. `product_customer_merge.sql` covers eligibility, atomic reconciliation, tombstones, idempotent replay, stale previews, membership collision handling, and private merge evidence; `class-kit-customers/index.test.ts` covers the Edge Function command/error and redirect contract; `scripts/test-customer-merge-concurrency.sh` defines multi-session races. Focused handler tests also cover customer CRUD shape/lifecycle, canonical versus legacy membership and walk-in targeting, direct ghost registration, and inactive-customer error mapping. The snapshot has no focused database regression suite that exercises the full ghost lifecycle, cross-product nondisclosure, or deactivation under concurrent membership/registration mutations.

## Repository roles and documentation authority

The root repository is the documentation authority. `README.md` directs durable documentation to `docs/`; `docs/repositories/structure.md` assigns the source repositories focused source, scripts, and package metadata rather than their own durable product documentation.

| Surface | Authority and supported role | User-visible outcome |
| --- | --- | --- |
| root `README.md` and `docs/` | Canonical documentation and deployment/product-boundary guidance | One durable starting point for users and operators. |
| `class-kit-sdk/` | Installable `@class-kit/react` SDK and typed browser facade | Consumers integrate with supported product operations without raw database/function coupling. |
| `class-kit-api/` | Supabase schema, migrations, functions, policies, local seed data, and API deployment | Backend evaluates product context and enforces product policy. |
| `apps/` | Local control and dogfood consumers (`class-kit-admin`, `demo2`) | Operators can develop and build example/admin UI without redefining the product boundary. |

The `apps/` workspace can use a sibling SDK during active local iteration, while deployed consumers must pin a released SDK tag over Git SSH. In this snapshot, both `class-kit-admin` and Demo2 select `file:../../class-kit-sdk`; the root source switcher restores exact remote tags and the Admin deployment workflow rejects local or unpinned dependencies. An app may administer or demonstrate ClassKit, but it does not own migrations, Edge Functions, or the canonical product API.

Root `AGENTS.md` is the contributor guide for this documentation repository. It makes `README.md` and `docs/` the canonical documentation surface, requires source changes and commits to stay in their owning sibling repositories, and directs documentation changes to verify the affected contract without treating this root as a monorepo. It also records the root's Markdown, validation, and focused pull-request conventions. Repository-local guidance in a sibling checkout takes precedence for work in that checkout.

`class-kit-api/AGENTS.md` and `class-kit-sdk/AGENTS.md` are repository-local contributor guides. They govern work inside their owning source repositories: the API guide covers its isolated backend boundary and native verification, while the SDK guide additionally requires regeneration of tracked distribution artifacts and npm-based verification. They complement rather than replace the root documentation authority: durable product, API, SDK, and deployment documentation remains in this repository's `README.md` and `docs/` tree. A source-repository change should read the applicable local guide before editing or validating that repository.

## Operator workflow: local development, validation, deployment, and release

The supported operator workflow is split by ownership; do not use an app workspace to deploy the API or release the SDK.

| Operation | Owning surface and command | Outcome and consequence |
| --- | --- | --- |
| Start local API stack | `class-kit-api`: `npm run supabase:start` | Starts the product-scoped Supabase stack. It may initially ignore the health check because PostgREST can start before migrations expose `class_kit`; after reset, an unhealthy `supabase status` is a real stack problem. |
| Inspect local state | `class-kit-api`: `npm run supabase:status` and `npm run supabase:migrations` | Shows local service status and applied/available local migrations; read-only inspection. |
| Rebuild local data | `class-kit-api`: `npm run supabase:reset` | Recreates the local database from migrations and `supabase/seed.sql`. This is destructive to local database state and should not be used as a remote deployment command. |
| Validate API changes | `class-kit-api`: `npm run supabase:db-lint`, `npm run deno:check`, and the relevant build/lint checks | Lints the local database and type-checks Edge Functions before deployment; validation does not itself deploy remote changes. |
| Deploy API remotely | `class-kit-api`: `npm run deploy:remote` | `scripts/deploy.sh` first requires `supabase/.env`, lists migrations, and type-checks functions; it then runs `supabase:deploy`, which performs the repository setup gate, pushes linked migrations, and deploys functions. Remote changes are forward migrations in the shared project; never run `supabase db reset` remotely because it would destroy every product sharing that project. Deploy each changed `class-kit-*` function. |
| Release SDK | `class-kit-sdk`: `npm run deploy:remote -- [--patch\|--minor\|--major]` | The default is a patch bump. The script requires a clean worktree, changes `package.json`, runs setup, commits release artifacts when changed, pushes the current branch, creates a `v<version>` tag, and pushes that tag. It is externally visible and irreversible without a corrective release/history action. |
| Build consumer apps | `apps/`: `npm run build`, or `npm run dev:demo` / `npm run dev:demo2` | Builds or starts the admin/demo consumers against their SDK dependency; this validates consumption but does not deploy API resources or publish SDK versions. |

Remote deployment must remain product-scoped: apply only ClassKit migrations/functions, use forward migrations, and make a narrow PostgREST schema/search-path update only when needed for the ClassKit schema. Operators must not casually push the full Supabase configuration to the shared project, because local-only auth URLs and rate limits can affect other products. Remote deployment credentials, service-role keys, database passwords, and Supabase access tokens are secrets; only the documented publishable client values are safe to place in client examples.

Static consumers installing the private SDK need a read-only deploy key configured before dependency installation. This is a supply boundary: a failed SSH clone is generally a deployment-identity/configuration issue, not a reason to copy the SDK or fall back to raw API calls.

## Known gaps

- The snapshot includes SQL regression tests for product truncation isolation, but it does not include an end-to-end remote deployment or SDK-release test. The operator commands and their destructive effects are implementation/documentation-grounded, not exercised here against the shared project.
- No focused regression test in the supplied snapshot verifies the SDK's complete origin-resolution matrix (unique origin, ambiguous local origin, pathful origin, and rejected origin) through a browser request. The Edge Function and SDK source establish the current behavior.
