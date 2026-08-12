# Operator workflows and local apps

ClassKit operators run and validate the product-scoped Supabase API, publish the browser SDK, and use the admin and Demo2 Vite applications as consumers of that released contract.

## Scope and authority

The root `Makefile` only includes the Symphony reviewer makefile; it is not the operational command surface. Command ownership instead follows the independently versioned repositories described in `docs/repositories/structure.md`:

- `class-kit-api/` owns the `class_kit` and `class_kit_private` database resources, ClassKit seed data, and `class-kit-*` Edge Function deployment.
- `class-kit-sdk/` owns `@class-kit/react` builds and release tags.
- `apps/` owns local frontend examples and the control-panel development experience. Its applications consume or administer ClassKit; they are not implementation authority or a product-facing backend boundary.

This separation matters in the shared Supabase project: ClassKit may deploy only its namespaced schema and prefixed functions. It must not modify another product's schemas, functions, or data. Browser applications go through `@class-kit/react` and Edge Functions rather than directly querying ClassKit tables or RPCs.

The current checkout is available on `master` and has an `origin` remote according to [repository identity](../repository-identity.json). That deterministic evidence conflicts with the statement in `docs/repositories/structure.md` that the parent documentation repository is local-only with no remote; the authored statement is stale or needs review and must not be used to infer that this checkout has no remote.

## Local API workflow and validation

From `class-kit-api/`, operators have these supported commands in `package.json`:

| Operation | Command | Outcome and boundary |
| --- | --- | --- |
| Start local stack | `npm run supabase:start` | Loads `supabase/.env` when present and starts Supabase with `--ignore-health-check`; this accommodates PostgREST beginning before migrations expose the product schema. |
| Reset local database | `npm run supabase:reset` | Runs `supabase db reset`, recreating the local database from migrations and seed data. This is destructive to local data. |
| Inspect local state | `npm run supabase:status` / `npm run supabase:migrations` | Reports service state or the local migration list. After a reset, `supabase status` should be healthy; an unhealthy stack then is a real local problem, not an expected startup condition. |
| Validate database/functions | `npm run supabase:db-lint` / `npm run deno:check` | Lints the local database and type-checks all Edge Function TypeScript through the repository's Deno Docker service. `deno:check:classes` narrows that check to the classes function. |
| Build SDK | `npm run build` in `class-kit-sdk/` | Runs TypeScript compilation to generate the SDK distribution consumed by applications and included in a release. |
| Build consumer apps | `npm run build` in `apps/` | Builds both workspaces; `npm run build:demo` and `npm run build:demo2` build the admin and Demo2 app individually. `npm run dev:demo` and `npm run dev:demo2` start their Vite development servers. |

The local product workflow is intentionally narrow: only ClassKit schemas, functions, and seed data should run locally. Product apps opt into this stack with `VITE_CLASS_KIT_TARGET=local`, local URL and publishable-key values, and `VITE_CLASS_KIT_LOCAL_PRODUCT_KEY`. The SDK uses those local connection values only when that target is selected; otherwise it selects the embedded shared remote project. A product key is supplied only to Vite development mode, so deployed applications resolve their product from their browser origin rather than preserving a local override.

`class-kit-api/scripts/setup.sh`, which is called before an API remote deployment, requires `supabase/.env`, lists migrations, and runs the full Deno check. Missing private deployment values or a failing check stops the process before the deploy command.

## API deployment

`npm run deploy:remote` in `class-kit-api/` runs setup and then `supabase:deploy`. The latter requires `quill --full`, pushes linked migrations, and deploys the configured `class-kit-*` functions with the fixed shared project reference and Supabase Management API mode. The user-visible result is that the shared hosted ClassKit API and its Edge Functions receive the checked-in product changes.

The deployment boundary is forward-only and product-scoped:

- `supabase db push --linked` changes the linked shared project, so operators must have the intended project linkage and migrations.
- Deploy every changed ClassKit-prefixed function, but never use this repository to alter another product's resources.
- Do not casually run `supabase config push`; local auth URLs and rate limits could leak into the shared project. A narrow Management API update is the documented route for PostgREST schema/search-path changes.
- Never run `supabase db reset` against the shared remote project. It would destructively reset every product sharing that Supabase project; only forward migrations are supported remotely.

Deployment requires `SUPABASE_ACCESS_TOKEN` outside source control. Public project values may appear in Vite examples, but service-role keys, database passwords, and CLI authentication tokens must remain local or in CI secrets.

## SDK release workflow

`npm run deploy:remote -- [--patch|--minor|--major]` in `class-kit-sdk/` runs `quill --full` before `scripts/deploy.sh`; the script defaults to `--patch`. It requires a clean working tree, calculates the next semantic version, rejects an existing local or remote tag, updates `package.json`, runs setup, commits the release artifacts when they changed, pushes the branch, then creates and pushes the `v<version>` tag. This is an externally visible, partially irreversible publication: it makes a Git commit and tag and pushes both to `origin`.

The resulting `@class-kit/react` tag is the deployment contract for static consumers. Deployed sites must use the explicit `git+ssh://git@github.com/khgs2411/class-kit-sdk.git#v<version>` form rather than a raw commit hash or scp-style Git URL. Their build environment needs a separate read-only deploy key for the private SDK before installing dependencies; personal SSH keys and write access are not appropriate. A stale Bun resolution after a previously unavailable tag can be cleared with `bun pm cache rm`.

## Administrative and dogfood consumers

`apps/` is an npm workspace containing `class-kit-admin` and `class-kit-demo2`. The supplied Demo2 manifest pins `@class-kit/react` to `v0.1.19`, making its production build input a released SDK rather than the sibling checkout. During active local SDK iteration, the repository documentation permits a `file:../../class-kit-sdk` dependency instead; that is a local dogfood convenience and must not be carried into deployed/customer applications.

### ClassKit Admin

`apps/class-kit-admin/src/App.tsx` is the platform control panel. It gets the session through the SDK, lists products through `classKitClient.admin.products.list()`, and renders signed-out, loading, permission-denied, and unavailable states. A user without the required platform access sees “Platform admin required” rather than the product inventory.

The app invokes SDK admin surfaces for product creation, auth policy and redirect management, origin management, users and roles, reset, change requests, and PM integrations. Those UI actions are requests to the backend authorization contract; the Vite app does not itself grant authority or mutate database tables directly. It stores its own auth state under `class-kit-admin-auth`, defaults to the remote target for production builds, and can point to local Supabase while developing. Its deployed/control-panel role is reinforced by its released SDK tag and the documented GitHub Pages deployment identity.

Administrative actions can be consequential, especially product reset and access/role changes. The panel is therefore an operator interface, not evidence that a browser user may bypass server-side permission checks. The exact reset semantics and authorization gates are documented in [Product administration and reset](product-administration-and-reset.md).

### Demo2

`apps/demo2/src/App.tsx` is a Vite dogfood/product example for the `demo2` product. It uses `useProductContext` and `useClassKitClient` rather than direct Supabase table access. Its visible flows include product-capability-based navigation, email/password and Google authentication, profile/dashboard access, public class listing and detail fields, and registration behavior supplied by the SDK. The `.env.example` names `demo2` as its local product key; the app uses a separate `class-kit-demo2-auth` browser storage key.

In local development, Demo2 can demonstrate the seeded ClassKit product against the local stack. In production, its SDK resolves the product from the app origin and uses the shared remote service, so a local key does not become a deployed product-selection override. Its user-visible pages and marketing content are dogfood UI, not the canonical source of class, membership, eligibility, approval, or authorization rules; those remain backend-enforced API contracts.

## Symphony reviewer registration

The root `Makefile` includes `.symphony-reviewer/reviewer.mk`, which defines `register-symphony-reviewer`. An operator must provide either `PROJECT` or `SYMPHONY_REVIEWER_PROJECT`; the target combines the standard reviewer message with an optional `PROMPT`, then invokes the configured Symphony registration script with that project and the repository root. `SYMPHONY_REVIEWER_REGISTER`, `SYMPHONY_REVIEWER_MESSAGE_FILE`, and `SYMPHONY_REVIEWER_REPO_ROOT` are override points for the harness integration. This is a local operator-registration bridge, not a product API or evidence that a review was registered successfully.

## Known gaps

- This snapshot establishes scripts and application call sites but does not include an observed successful local start/reset, remote API deployment, SDK publication, or static-site deployment run. Credentials, shared-project linkage, deploy-key access, and external CI/hosting configuration therefore remain operator verification points.
- `apps/` supplies build and development commands only; no app deployment workflow is present in the assigned workspace files. The documentation describes the admin control panel as deployed, but this subject cannot verify its current hosted build or deployment automation from these sources.
- The `Makefile` contributes only the reviewer include in this checkout, so it does not independently verify the broader command set presented in higher-level documentation.
