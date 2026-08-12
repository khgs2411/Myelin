# Backend API and Data Contracts

ClassKit's backend is `class-kit-api/supabase`: it owns Supabase migrations, the `class_kit` schema, Edge Functions, trusted service-role access, product resolution, authorization, and the API contracts consumed through `@class-kit/react`. Product websites use the SDK rather than invoking Edge Functions, tables, or RPCs directly ([`docs/api/backend-api.md`](../target-repo/docs/api/backend-api.md); [`docs/product-shape.md`](../target-repo/docs/product-shape.md)).

## Ownership and execution boundary

The product has three deliberately separate layers:

- Postgres/RPC owns durable state, constraints, transactional transitions, and RLS backstops.
- Edge Functions own request handling, origin/product/session resolution, validation, authorization, RPC orchestration, and response shaping.
- The SDK owns typed namespaces, client inputs and outputs, and transport normalization. It is not a security boundary.

Functions may use a service-role client, so every protected or mutating path must enforce a ClassKit permission guard; RLS is a database backstop, not a replacement for function authorization. New product behavior should stabilize in the backend first, then receive an SDK facade only when a browser consumer needs it. This keeps apps free of Supabase details and raw action strings ([`docs/api/class-api-map.md`](../target-repo/docs/api/class-api-map.md); [`supabase/functions/_shared/permissions.ts`](../target-repo/class-kit-api/supabase/functions/_shared/permissions.ts)).

## Transport and common response contract

Edge Functions accept POST JSON; CORS handles OPTIONS. Browser callers provide `Origin`, `Authorization`, and Supabase `apikey`, with optional `x-class-kit-site-url` for path-aware product selection on a shared browser origin. The site URL must be HTTP(S), match `Origin`, and ignores query/hash. A production caller must not send `product_key`; it is only a localhost development hint and remains origin-checked. The backend can alternatively obtain `CLASS_KIT_LOCAL_PRODUCT_KEY` in a local stack ([`docs/api/backend-api.md`](../target-repo/docs/api/backend-api.md); [`supabase/functions/_shared/context.ts`](../target-repo/class-kit-api/supabase/functions/_shared/context.ts)).

Every function uses the envelope:

```ts
type ApiResponse<T> =
  | { data: T; error: null }
  | { data: null; error: { code: ApiErrorCode; message: string } };

type ApiErrorCode =
  | "bad_request" | "unauthorized" | "forbidden"
  | "not_found" | "conflict" | "internal_error";
```

`bad_request` covers malformed/missing input, unsupported action, invalid site URL, or a disallowed key hint; `unauthorized` covers missing/invalid required JWTs; `forbidden` covers origin, provider, access-policy, and permission denials. Preserve this envelope and code vocabulary when adding functions so the SDK can normalize failures consistently ([`supabase/functions/_shared/errors.ts`](../target-repo/class-kit-api/supabase/functions/_shared/errors.ts)).

## Product context and authorization contract

Shared context resolves, in order: request origin and optional site URL; the product and its allowed origin; auth policy and matched-origin redirects; an optional Supabase Auth identity; active product role assignment; and provider availability. Context exposes product key/name, `auth_mode` (`open` or `invite_only`), email/Google provider flags, scoped redirects, optional user, product user, and product access state. No origin match is a forbidden response. Origin-specific OAuth redirects win; environment-scoped defaults are used only when no origin-scoped redirect exists.

Supabase Auth establishes a global identity; ClassKit establishes product access. `class_kit.users` represents product membership, not platform administration. A platform admin is not implicitly a product user. Product-level numeric guards may fall back to an equivalent platform level, while product permission-key guards require an explicit product-role grant. Platform checks remain platform-scoped ([`docs/api/backend-api.md`](../target-repo/docs/api/backend-api.md); [`supabase/functions/_shared/permissions.ts`](../target-repo/class-kit-api/supabase/functions/_shared/permissions.ts)).

`class-kit-product-context` is anonymous-aware: signed-out callers receive policy and no capabilities; signed-in callers receive product-user/access summaries and derived product-local capability flags. The flags inform navigation only; backend authorization remains authoritative. Invite-only membership is activated only through an active access entry, and provider success never by itself grants product authorization.

## Function and facade map

SDK method names conceal the `class-kit-` prefix and action strings. The following is the supported responsibility map; consult [`docs/api/backend-api.md`](../target-repo/docs/api/backend-api.md) or [`docs/api/class-api-map.md`](../target-repo/docs/api/class-api-map.md) for endpoint-specific input and result fields.

| Backend function(s) | Actions / responsibility | SDK surface |
| --- | --- | --- |
| `product-context`, `profile`, `product-signup` | Context resolution; current-user profile; password signup | `product.getContext`, `profile.*`, `auth.signUp*` |
| `classes`, `register-class` | Safe discovery/detail; lifecycle management; self registration/cancellation | `classes.*`, `management.classes.*` |
| `templates`, `schedules`, `schedule-generate` | Reusable defaults, recurrence rules, generation and skips | `management.templates.*`, `management.schedules.*` |
| `manage-registrations`, `attendance` | Roster transitions and attendance sessions | `management.registrations.*`, `management.attendance.*` |
| `memberships` | Types, grants, replacement/upgrade, stock and ledger | `management.memberships.*` |
| `product-roles`, `product-users`, `product-user-roles` | Product roles, permissions, users, metadata, role assignments | `management.roles.*`, `management.users.*` |
| `signup-links`, `product-documents` | Public link resolution; document reads/acceptance/version management | `signupLinks.*`, `productDocuments.*`, `management.productDocuments.*` |
| `product-change-requests` | Product request threads and two-stage attachment upload | `management.changeRequests.*` |
| `admin-products`, `admin-product-users`, `admin-product-roles` | Platform provisioning, origins/auth settings, access/users/roles | `admin.products.*`, `admin.users.*`, `admin.productRoles.*` |
| `admin-product-change-requests`, `admin-pm-integrations` | Cross-product request handling and Trello link administration | `admin.changeRequests.*`, `admin.pmIntegrations.*` |

`management.*` is the product-scoped operational surface and accepts only the resolved product context. `admin.*` is the control-plane surface, may take explicit `productKey`, and is not for ordinary product websites. Do not bypass a missing SDK method by calling an Edge Function directly; add the facade after the backend contract is stable.

## State and schema responsibilities

Migrations under [`class-kit-api/supabase/migrations/`](../target-repo/class-kit-api/supabase/migrations/) are append-only product history. They own the schema and RPC contract for:

- products, allowed origins, auth policy, redirects, product access, product users, roles, role assignments, permission grants, and permission-requirement catalog;
- concrete classes, templates, schedules, generated-class provenance, registrations, attendance, memberships/grants, and membership ledger entries;
- public-field policy and profile/product-membership metadata;
- versioned product documents and acceptance snapshots;
- product change-request revisions, private attachment metadata, PM links, label mappings, and cached board snapshots.

Concrete classes are the operational unit; templates and schedules are supporting records. A manual class can optionally use template defaults but cannot claim schedule provenance. Generated classes must carry the complete `schedule_id`, `template_id`, `generated_for_date`, and `source_timezone` source set. Registration and attendance state changes, capacity, stock consumption/restoration, and invalid transition handling belong in backend transition RPCs rather than client code ([`docs/api/backend-api.md`](../target-repo/docs/api/backend-api.md)).

Product documents are versioned by product/type/locale: public reads see published versions only; acceptance snapshots retain the accepted content metadata; publishing archives the previously published version. Change-request edits are append-only revisions connected by thread, predecessor, and version number. Attachments use signed Storage upload/download URLs; files do not travel through the JSON API.

## Change expectations

For any backend change, preserve the chain of responsibility:

1. Add an append-only migration for durable schema, constraint, or RPC changes.
2. Validate input and enforce product resolution and the appropriate explicit backend guard in the function.
3. Keep service-role operations behind that guard and return the shared response envelope.
4. If the result is browser-facing, update SDK types/facade and the living API documentation together; apps then consume the SDK shape.
5. Add focused migration/function regression coverage for externally observable policy or transition changes.

Before release, verify disallowed origins and non-local key hints are rejected; anonymous context still works where intended; disabled providers and invite-only rules cannot create unauthorized product membership; and platform admins do not become implicit product users. The backend package provides `npm run deno:check`, targeted Deno checks, Supabase migration/reset/lint commands, and deployment through `scripts/deploy.sh` ([`class-kit-api/package.json`](../target-repo/class-kit-api/package.json); [`docs/api/backend-api.md`](../target-repo/docs/api/backend-api.md)).

## Important boundaries

- `truncate_product` is a platform level-100 destructive operation. The consuming admin UI must require exact product-key confirmation; the backend preserves the product configuration, roles/permissions, origins/redirects, and invoking admin manager baseline while removing product-scoped operational data.
- PM integration is platform-admin-only. ClassKit remains the canonical request store; Trello links/cards are external work metadata. Detaching a local link must not delete a Trello card.
- Custom class fields are backend-validated by field schema (type, options, required/default values, and data keys), so clients cannot treat arbitrary JSON as trusted class data ([`supabase/functions/_shared/class_schema.ts`](../target-repo/class-kit-api/supabase/functions/_shared/class_schema.ts)).
