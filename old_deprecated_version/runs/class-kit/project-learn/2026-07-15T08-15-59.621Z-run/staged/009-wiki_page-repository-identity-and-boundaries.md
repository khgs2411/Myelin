# Repository identity and boundaries

ClassKit is a Supabase-backed class and membership platform organized as a documentation-root checkout with sibling API, SDK, and app surfaces; its supported browser path is website → `@class-kit/react` → ClassKit Edge Functions → `class_kit` schema.

## Sanitized checkout identity

`repository-identity.json` is the deterministic identity record for this snapshot. It identifies the registered repository as `class-kit` at `/Users/liadgoren/Repositories/class-kit`, on branch `master`, at commit `4f55d94506f181d179f705173ecd54606b44c90c`. Its status is `available` and it records no diagnostics.

The same record lists one configured remote:

| Remote | URL |
| --- | --- |
| `origin` | `https://github.com/khgs2411/class-kit.git` |

Treat this manifest as the checkout fact for this Project Memory run. It is more specific and current for checkout identity than a prose ownership statement in repository documentation.

## Repository and runtime boundaries

The root `README.md` names `class-kit-sdk/` and `class-kit-api/` as the ClassKit product boundary:

- `class-kit-sdk/` is the installable React SDK and typed client facade. It owns the client methods, React provider/context, auth/session facade behavior, request/response normalization, and hiding Edge Function names and action strings from websites (`README.md`; `docs/product-shape.md`).
- `class-kit-api/supabase/` is the authority boundary. It owns migrations, Edge Functions, RPCs, RLS/security, validation, permissions, product policy, and product-access rules (`README.md`; `docs/product-shape.md`).
- `apps/` contains consumer and operating surfaces, not product source. In the current layout, `apps/demo2/` is the example/client-facing product website and `apps/class-kit-admin/` is the admin control panel (`docs/getting-started.md`; `docs/product-shape.md`).
- `docs/` is the canonical durable documentation surface. The root `README.md` is its only project-root entrypoint, leading to `docs/getting-started.md`, then the rest of `docs/` (`README.md`; `docs/repositories/structure.md`).

This yields the supported browser boundary:

```text
frontend website -> @class-kit/react -> class-kit-* Edge Functions -> class_kit schema
```

Websites own presentation and local interaction design. They should use the SDK facade rather than query ClassKit tables or invoke ClassKit RPCs/Edge Function action contracts directly. A website need for Supabase details, backend payload shapes, permission rules, or action strings is an extraction signal toward the SDK or backend, not a reason to broaden the website boundary (`README.md`; `docs/product-shape.md`).

## Shared remote platform, product-scoped local runtime

The remote Supabase project is a shared platform: it contains the global `auth.users` identity layer alongside ClassKit's `class_kit` and `class_kit_private` schemas and may contain separately owned future-product namespaces. A ClassKit local stack must remain narrower: it runs only ClassKit schemas, functions, and seed data. ClassKit must not manage another product's schema, private helper schema, Edge Functions, or migrations, and a local ClassKit checkout must not mirror unrelated remote-product state (`docs/shared/deployment.md`).

The supporting authentication guide records the complementary browser boundary: Supabase Auth is shared identity, while `class_kit.users`, roles, permissions, and Edge Functions decide ClassKit product access. Product OAuth redirect URLs are runtime configuration in ClassKit's product records, but each URL must also appear in the Supabase Auth redirect allow-list; neither frontend environment values nor a redirect record alone bypasses the other gate (`docs/shared/authentication.md`).

## Ownership and release boundaries

The authored repository structure assigns command ownership as follows (`docs/repositories/structure.md`):

| Surface | Owner / allowed responsibility |
| --- | --- |
| `class-kit-api/` | Supabase deployment and backend implementation |
| `class-kit-sdk/` | SDK release tags and facade implementation |
| `apps/` | Local frontend examples and control-panel development; apps consume or administer ClassKit |
| root `docs/` | Durable usage, command, API, SDK, deployment, design, and product-boundary documentation |

For local iteration, dogfood examples may consume the sibling SDK through `file:../../class-kit-sdk`. Deployed apps and customer projects should instead use tagged SDK releases over Git SSH. The documented static-host rule additionally requires `apps/class-kit-admin/` to pin the current released SDK tag so its deployed build uses the same SDK contract as other static hosts (`docs/repositories/structure.md`).

The product-shape document further rules out an old SDK role: `class-kit-sdk` must not become a packaged UI component library, UI-adapter library, or styleless workflow-component library. Custom UI stays in each consuming website; product behavior stays in the SDK facade or API according to the boundary above (`docs/product-shape.md`).

## Remote-origin contradiction

There is an unresolved conflict between the deterministic checkout evidence and authored documentation:

| Evidence | Claim | Status |
| --- | --- | --- |
| `repository-identity.json` | The parent `class-kit` checkout has `origin` at `https://github.com/khgs2411/class-kit.git`. | Deterministic snapshot evidence. |
| `docs/repositories/structure.md` and `docs/getting-started.md` | The parent folder is a local-only documentation repository and should not have a remote origin. | Stale, conflicting, or needs review. |

Do not infer that the remote should be removed, or that the documentation-root model is invalid. The current evidence supports the repository split and documentation ownership, but does not explain whether the configured parent remote is intentional, transitional, or accidental. Until an owner resolves that question, preserve both facts and avoid automation that assumes a remote-less parent checkout.

## Known gaps

- The sanitized checkout manifest establishes only the parent checkout identity. It does not provide the nested API, SDK, or app repositories' exact commits, remotes, or working-tree states.
- The snapshot contains the documented directories but does not independently establish why the parent remote exists; resolving the contradiction requires owner confirmation or newer authoritative repository policy.
- This subject documents repository ownership and product boundaries only. It does not verify individual access, eligibility, membership, approval, or lifecycle gate behavior; those contracts belong to their assigned subject pages.
