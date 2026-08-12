# Repository identity and product boundaries

ClassKit is a Supabase-backed platform for class operations, membership, and product administration, organized as a documentation root plus separate API, SDK, and application workspaces.

## Repository identity and snapshot caveat

The deterministic checkout record identifies the project as `class-kit`, registered at `/Users/liadgoren/Repositories/class-kit`, with branch `master`, commit `4f55d94506f181d179f705173ecd54606b44c90c`, and `origin` `https://github.com/khgs2411/class-kit.git` ([`repository-identity.json`](../repository-identity.json)). Use that record for this Project Memory's repository identity.

The mounted source snapshot conflicts with that record: `repo:.git` reports branch `master`, commit `afa43fe26e113ee4f0195eb3c474a077a2b1b17e`, and origin `https://github.com/khgs2411/Myelin.git`. The same Myelin origin is reported when querying the mounted `class-kit-api`, `class-kit-sdk`, and `apps` folders. This is snapshot metadata, not evidence that the documented ClassKit source layout has changed.

There is a second, narrower conflict in authored documentation: `docs/repositories/structure.md` (`repo:docs/repositories/structure.md`) says the parent documentation folder is local-only and should not have an origin, whereas the deterministic record supplies a ClassKit GitHub origin. The authoritative resolution is **needs review**: retain the deterministic record for identity, but do not infer the intended remote policy from the mounted Git metadata or the stale/conflicting prose.

## Product boundary

The supported browser path is:

```text
frontend app -> @class-kit/react -> class-kit-* Edge Functions -> class_kit schema
```

`README.md` (`repo:README.md`) and `docs/getting-started.md` (`repo:docs/getting-started.md`) make the boundary explicit: browser applications use `@class-kit/react`; they must not query ClassKit tables or RPCs directly. The ClassKit product boundary is the SDK plus API. Applications consume, exercise, or administer that product boundary; they are not product source.

## System layout and ownership

| Layer / location | Owns | Does not own |
| --- | --- | --- |
| Parent `README.md` and `docs/` | The canonical, cross-layer documentation entrypoint and durable design/usage/deployment notes. | Runtime product logic. |
| `class-kit-api/supabase` | Supabase migrations, database/RPC behavior, Edge Functions, RLS and security backstops, validation, product resolution, authorization, permissions, and product policy. | Website presentation or a browser-facing dependency on raw Supabase contracts. |
| `class-kit-sdk` / `@class-kit/react` | Typed client methods, React provider/context, auth and session facade behavior, request/response normalization, and hiding Edge Function names/actions from websites. | Packaged visual components, UI adapters, or styleless workflow components; that prior direction is deprecated. |
| `apps/demo2` | Client-facing site layout, routes, copy, visual design, and interaction polish. | ClassKit table/RPC access, Edge Function action strings, or authorization policy. |
| `apps/class-kit-admin` | The administrative control-panel experience that operates ClassKit. Its manifest consumes the tagged `@class-kit/react` SDK. | The ClassKit API/SDK product source itself. |

This ownership model is stated in `docs/product-shape.md` (`repo:docs/product-shape.md`) and `docs/getting-started.md` (`repo:docs/getting-started.md`). Current manifests corroborate the executable split: `class-kit-sdk/package.json` (`repo:class-kit-sdk/package.json`) publishes `@class-kit/react`; `class-kit-api/package.json` (`repo:class-kit-api/package.json`) owns Supabase operations; and both application manifests depend on the tagged SDK.

## Operating boundary

ClassKit treats Supabase as the identity and platform runtime layer, while ClassKit owns product access and authorization semantics. The backend remains authoritative for product resolution, membership eligibility, policy, and permission checks. In particular, Edge Functions using a service-role client must still perform explicit ClassKit permission checks because that client bypasses ordinary user RLS (`docs/product-shape.md` (`repo:docs/product-shape.md`)).

For changes, the repository's documented routing rule is:

- Presentation and experience work belongs in the relevant website.
- Client behavior and facade changes belong in `class-kit-sdk`.
- Product logic and authority belong in `class-kit-api/supabase`.

If a website requires a Supabase detail, Edge Function action, permission rule, or backend payload shape that is not presentation-specific, that is an extraction signal toward the SDK or backend rather than a reason to expand the website boundary.

## Documentation and repository boundaries

The authored structure says the parent folder contains the single active documentation source (`README.md -> docs/getting-started.md -> docs/*`) and that API, SDK, and applications should not carry durable repo-local documentation. It also assigns deployment to `class-kit-api`, SDK release tags to `class-kit-sdk`, and local app development to `apps/` (`docs/repositories/structure.md` (`repo:docs/repositories/structure.md`)).

Treat those ownership statements as current product documentation, but treat branch/remote claims in that document as **conflicting or stale** until the snapshot-identity discrepancy is resolved.

## Known gaps

- The supplied evidence cannot establish why the mounted snapshot and its nested Git metadata identify Myelin rather than ClassKit, nor whether the recorded ClassKit commit remains reachable from the canonical remote.
- The deterministic record and authored repository-structure document disagree about whether the parent documentation repository should have an origin. This requires operator review before changing remote or repository-topology guidance.
- This subject documents boundaries, not feature-level behavior. It does not independently validate every Edge Function, RLS policy, or SDK method behind the stated ownership model.
