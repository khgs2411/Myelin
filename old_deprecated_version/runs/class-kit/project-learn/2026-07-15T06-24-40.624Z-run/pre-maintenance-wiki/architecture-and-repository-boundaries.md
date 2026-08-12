# Architecture and Repository Boundaries

ClassKit is a shared, Supabase-backed platform whose supported product boundary is a typed React SDK in front of its backend APIs; the parent repository is the documentation shell that records the cross-layer contract.

## Product boundary

The supported browser path is:

```text
frontend website -> @class-kit/react -> class-kit-* Edge Functions -> class_kit schema
```

Frontend websites must use `@class-kit/react`; they must not query ClassKit tables, call RPCs, or depend on Edge Function action names and payload shapes directly. A website-specific need for any of those details is an extraction signal: presentation stays in the website, while reusable behavior belongs in the SDK or backend. See `README.md`, `docs/getting-started.md`, and `docs/product-shape.md`.

## Ownership split

| Surface | Owns | Does not own |
| --- | --- | --- |
| Documentation shell (`README.md`, `docs/`) | The canonical cross-layer documentation, product decisions, integration and deployment guidance | Runtime implementation, SDK releases, or Supabase deployment |
| Backend API (`class-kit-api/supabase`) | Migrations; `class_kit` and `class_kit_private` behavior; Edge Functions; RPCs; product resolution; validation; authorization; product policy; RLS/security backstops | Website UI and browser-facing facade ergonomics |
| SDK facade (`class-kit-sdk`, published as `@class-kit/react`) | Typed client methods; React provider/context; auth/session facade behavior; request/response normalization; hiding backend names and payloads | Reusable visual components, UI adapters, or website styling |
| Consuming applications (`apps/demo2` and external product sites) | Routes, layout, copy, visual design, page composition, and product-specific interaction polish | Database access, raw RPC/Edge Function calls, or authorization policy |
| Admin control panel (`apps/class-kit-admin`) | A platform/operator control surface that consumes the supported contracts to provision and manage products | The ClassKit product boundary itself, or ordinary client-product UI |

The deprecated packaged-component-library direction must not return through the SDK: customer websites build their own React UI, including Tailwind/shadcn/framer/lucide choices, and use the SDK for behavior.

## Repository and documentation boundaries

The local parent folder contains `docs/`, `apps/`, `class-kit-api/`, and `class-kit-sdk/`, but these are intentionally separate repositories. The parent is a local-only documentation repository with no remote origin. Its documentation flow is `README.md -> docs/getting-started.md -> docs/*`; source repositories should remain focused on code, package metadata, and scripts rather than carrying competing durable READMEs or design documentation. `docs/repositories/structure.md` is the command-ownership reference.

`apps/` is a local examples/control-panel workspace, not product source. During active local iteration, dogfood apps may use the sibling SDK through a `file:../../class-kit-sdk` dependency. Deployed apps and customer projects must instead pin a tagged private SDK Git SSH release. This keeps deployed integrations on an intentional SDK contract rather than an arbitrary local checkout.

## How to classify work

- Put UI or experience changes in the relevant consuming website.
- Put reusable browser behavior, typed API ergonomics, session handling, or response normalization in `class-kit-sdk` after the backend contract is stable.
- Put business logic, product-wide policy, schema constraints, product resolution, and authoritative permission enforcement in `class-kit-api/supabase`.
- Keep a backend-only policy or enforcement change out of the SDK unless browsers need a new supported facade method or type.
- Update the documentation shell when a fact or decision is durable across layers; do not let archive material override the living references in `docs/getting-started.md`, `docs/product-shape.md`, and `docs/repositories/structure.md` without verification.

## Security and authority boundary

Supabase Auth establishes global identity and sessions. ClassKit establishes product access, membership, roles, and permissions. Edge Functions are the authoritative business-action layer, with RLS as a database backstop. Service-role clients can bypass ordinary RLS, so they still require explicit ClassKit permission checks. Browser capability checks can shape UI, but cannot replace backend authorization.

Product resolution is backend-owned: the SDK provides the path-aware site URL information needed for configured product origins, while the backend verifies the header against the actual request origin before resolving a product. Local product hints are deliberately restricted to localhost flows and do not change this ownership model.

## Practical implications

When diagnosing a ClassKit issue, first identify the affected boundary. Registration policy, schema behavior, and permission enforcement belong in `class-kit-api`, even when a website displays the result. A missing typed operation or frontend normalization belongs in the SDK. A visual workflow or page composition issue belongs in its consuming application. This prevents an app from becoming an alternate backend client and keeps the SDK as the stable integration contract.
