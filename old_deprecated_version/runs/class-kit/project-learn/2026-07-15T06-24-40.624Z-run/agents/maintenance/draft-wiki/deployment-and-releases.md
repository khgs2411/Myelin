# Deployment and Releases

ClassKit deploys as one product within a shared Supabase project, while the API, SDK, and consuming websites retain separate release and deployment responsibilities.

## Ownership and repository boundaries

The parent `class-kit/` folder is a local-only documentation shell, not a remote product repository. It is the canonical location for cross-layer documentation; the nested source repositories retain their own Git histories. [Repository Structure](target-repo/docs/repositories/structure.md)

- `class-kit-api/` owns ClassKit's Supabase migrations, Edge Functions, and remote deployment. Its supported deployment command is `npm run deploy:remote`; its setup phase must succeed before deployment proceeds.
- `class-kit-sdk/` owns SDK release tags. `npm run deploy:remote` creates the release, with patch as the default bump and `--minor` or `--major` for larger bumps.
- `apps/` owns local examples and control-panel development. It is not ClassKit product source, although `apps/class-kit-admin` is a deployed operating surface and must build against a released SDK tag.

This separation is substantive: app and product-site repositories consume the SDK contract, while backend deployment is confined to the API repository. [Repository Structure](target-repo/docs/repositories/structure.md); [Getting Started](target-repo/docs/getting-started.md)

## Shared Supabase deployment model

All products share the remote Supabase project `xhkymcpkvekuvoxiucoe` in `eu-west-1` (`https://xhkymcpkvekuvoxiucoe.supabase.co`). Supabase Auth (`auth.users`) is shared identity infrastructure; each product owns only its product namespace, private helper namespace, Edge Function prefix, migrations, seed data, and release pipeline. [Shared Supabase Deployment](target-repo/docs/shared/deployment.md)

For ClassKit, the owned surface is:

```text
class_kit.*
class_kit_private.*
class-kit-* Edge Functions
ClassKit local seed data
ClassKit SDK/package releases
```

Product tables and RPCs belong in the product schema, internal helpers in the private schema, and browser applications reach those capabilities through `@class-kit/react` and `class-kit-*` Edge Functions. They must not directly query ClassKit tables or RPCs. Edge Function names are global in the shared project, so the product prefix is required. [Shared Supabase Deployment](target-repo/docs/shared/deployment.md); [Getting Started](target-repo/docs/getting-started.md)

### Remote change rules

Remote ClassKit deployment links the shared project, pushes forward migrations, updates the PostgREST schema/search-path configuration narrowly when required, and deploys every changed `class-kit-*` function. The documented examples include `class-kit-product-context`, `class-kit-classes`, `class-kit-register-class`, and `class-kit-admin-products`. [Shared Supabase Deployment](target-repo/docs/shared/deployment.md)

Do not use `supabase db reset` against this remote project: it would destroy data for every product sharing it. Use forward migrations only. Also avoid casual `supabase config push`, which can overwrite local-only shared settings such as Auth URLs and rate limits; use the narrow Management API PostgREST update for exposed-schema/search-path changes. [Shared Supabase Deployment](target-repo/docs/shared/deployment.md)

Public Supabase project values may appear in app `.env.example` files. Deployment credentials and privileged values—`SUPABASE_ACCESS_TOKEN`, service-role keys, database passwords, and Supabase CLI auth tokens—must remain local or in CI secrets. [Shared Supabase Deployment](target-repo/docs/shared/deployment.md)

## Local versus remote environments

Local development is intentionally product-scoped. A ClassKit checkout runs the shared `auth.users` layer plus only `class_kit.*`, `class_kit_private.*`, and `class-kit-*` functions; it must not mirror unrelated production product schemas or functions. The remote project is the integrated multi-product platform. [Shared Supabase Deployment](target-repo/docs/shared/deployment.md)

The SDK facade normally targets the shared remote project. A product app can provide `VITE_CLASS_KIT_LOCAL_PRODUCT_KEY` as a localhost-only product hint. Local Supabase use is explicit through `VITE_CLASS_KIT_TARGET=local` plus the local URL and publishable key from `supabase status`. [Shared Supabase Deployment](target-repo/docs/shared/deployment.md)

For ClassKit API work, the documented local verification sequence is:

```bash
npm run supabase:start
npm run supabase:reset
npm run deno:check
npm run build
npm run lint
```

`supabase:start` may initially ignore health checks because PostgREST can come up before migrations create the exposed product schema. After reset, an unhealthy `supabase status` is a real local-stack failure rather than an expected condition. [Shared Supabase Deployment](target-repo/docs/shared/deployment.md)

## SDK releases and consuming applications

Deployed websites and customer projects install the private SDK by explicit SSH Git URL and release tag, currently `v0.1.18`:

```text
git+ssh://git@github.com/khgs2411/class-kit-sdk.git#v0.1.18
```

The manifest and install command stay tag-based even if `bun.lock` stores the resolved commit. Do not use raw release commit hashes, local `file:` dependencies, or the scp-style Git shorthand; the latter can hang Bun's Git resolver. Local dogfood applications may use `file:../../class-kit-sdk` only while iterating. If Bun has cached an unavailable tag, run `bun pm cache rm` and retry the tag-based install. [Shared Supabase Deployment](target-repo/docs/shared/deployment.md); [Repository Structure](target-repo/docs/repositories/structure.md); [Changelog](target-repo/docs/changelog.md)

The changelog is the developer-facing release record: consuming websites should use it to decide required integration changes when upgrading SDK tags. At this snapshot, it lists no unreleased developer-facing changes after `v0.1.18`. [Changelog](target-repo/docs/changelog.md)

## Static-host access to the private SDK

Every clean deployment environment that installs the private SDK needs SSH read access before dependency installation. A developer laptop may use the developer's existing SSH access; GitHub Pages, Netlify, Vercel, Cloudflare Pages, and other CI hosts do not inherit it. Clone failures are generally private-dependency access failures, not static-host failures. [Shared Supabase Deployment](target-repo/docs/shared/deployment.md)

For each consuming product or deployment surface:

1. Create a dedicated SSH key pair.
2. Add its public key to `khgs2411/class-kit-sdk` as a read-only deploy key.
3. Store the private-key contents as an encrypted secret in the consuming deployment system.
4. Before `bun install`, `npm install`, or the host's automatic dependency step, write the key under `~/.ssh`, set mode `600`, add `github.com` to `known_hosts`, and configure Git to use that key.
5. Keep the private key out of source control and do not reuse a personal or write-enabled key.

For GitHub Pages, the expected consuming-repository secret is `CLASS_KIT_SDK_DEPLOY_KEY`; it holds the key contents, not a filesystem path. The workflow must configure SSH before `bun install --frozen-lockfile`. If a host installs dependencies before custom commands, use its native private-dependency mechanism or take control of the install step so SSH setup occurs first. [Shared Supabase Deployment](target-repo/docs/shared/deployment.md); [Changelog](target-repo/docs/changelog.md)

## Deployment guardrails

- Keep product resources namespaced; never create, alter, or drop another product's resources in the shared project.
- Keep browser access at the SDK/Edge Function boundary, enable RLS on product tables, and avoid broad browser-role table grants.
- Verify local reset, function type checks, package builds, and lint before shared-project deployment.
- Ensure the SDK tag exists and the static host has the matching read-only deploy key before it begins dependency installation.

The documentation describes the intended deployment commands and controls. This snapshot does not include the API repository's deployment scripts or a consuming site's CI workflow, so their current executable implementation and configured secrets require verification in those separate repositories.
