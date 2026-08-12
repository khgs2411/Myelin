# Product documents and signup links

Product documents provide product-scoped markdown content, versioned publication, and acceptance records; signup links provide public, product-scoped pointers to either a class or a caller-defined filter object.

## Browser and authority boundary

The published `@class-kit/react` client is the browser boundary: `client.productDocuments.list`, `get`, and `accept`, plus `client.signupLinks.resolve`, are the public-facing operations. Manager operations live under `client.management.productDocuments.upsert/archive` and `client.management.signupLinks.create` (`class-kit-sdk/src/client/class-kit-client.ts`). The SDK adds the browser site URL header and, for local browser origins, can include its configured product key; the API still resolves the product server-side from the request origin/site URL and optional key (`class-kit-sdk/src/client/product-api.ts`, `class-kit-api/supabase/functions/_shared/context.ts`). Product data must therefore be accessed through this facade rather than directly from tables or raw functions.

The Edge Functions do not rely on Supabase's function-level JWT switch alone: both functions are configured with `verify_jwt = false`, then establish their own context. `resolveAnonymousProductContext` resolves the product and allows an unauthenticated request; `requireProductContext` additionally requires a bearer-authenticated user. Permission checks are product-scoped and evaluated by the backend (`class-kit-api/supabase/config.toml`, `class-kit-api/supabase/functions/_shared/context.ts`).

## Product documents

### Visibility and states

`class_kit.product_documents` stores a non-empty markdown body, title, type, locale, integer version, optional `effective_at`, creator, and one of these statuses (`class-kit-api/supabase/migrations/20260705060042_product_documents.sql`):

| Status | Public result | Manager result |
| --- | --- | --- |
| `draft` | Never returned by `list` or `get`. | May be created as the next version by a caller with `product_documents.manage`. |
| `published` | Included by `list`; `get` returns the requested locale or its fallback. | Creating a new published version archives the prior published version for the same product, type, and locale. A partial unique index allows at most one published version for that tuple. |
| `archived` | Never returned by `list` or `get`. | An authorized manager can explicitly archive any document ID in the resolved product. |

Public `list` exposes summaries of all published documents for the resolved product, optionally filtered to one locale. Public `get` requires a valid `document_type`, uses `locale` (default `en`), and falls back to `fallback_locale` (default `en`) only when no requested-locale version is found. It returns 404 when neither published candidate exists. The current implementation sorts candidates by `effective_at` and version, but does not prevent a future `effective_at` from being public; it is ordering metadata, not a publication gate (`class-kit-api/supabase/functions/class-kit-product-documents/index.ts`). Public responses carry a five-minute cache policy with one-day stale-while-revalidate; a document detail response also uses its document ID as an ETag. The SDK separately caches successful public list/get responses in memory for five minutes and clears that cache after its own manager upsert/archive calls.

The supported document type is lowercase letters followed by lowercase letters, digits, or underscores (2--64 characters). Locale is a two- or three-letter language code with an optional `-` subtag. Blank title/body, invalid status, invalid locale/type, and non-ISO `effective_at` are rejected.

### Acceptance and precedence

`accept` first requires authentication, then an existing `productUser` with `status === active`; a user who is authenticated but not active is denied before any document lookup or acceptance write. It then resolves the same published locale/fallback candidate used by public `get`; a missing candidate returns 404. On success, the acceptance stores a snapshot of the document ID, type, locale, version, title, markdown content, context, and time in `product_document_acceptances`. This preserves what was accepted even if the linked document is later removed; `document_id` is allowed to become null on document deletion (`20260705060042_product_documents.sql`, `class-kit-api/supabase/functions/class-kit-product-documents/index.ts`).

`context` defaults to `general` and uses the same lowercase identifier grammar as a document type. The unique key is product, user, document type, document locale, document version, and context: repeating the same acceptance upserts that record, while a new version or a distinct context creates a distinct acceptance. Users may read their own acceptance rows; managers and platform administrators may read product rows through RLS. There is no API here that makes document acceptance a class-registration prerequisite, so no acceptance-before-eligibility or membership precedence is established by this subject.

### Management and irreversible effects

`upsert` is version creation, not an in-place edit: it derives the next version for the product/type/locale tuple and inserts a new row. The action, and `archive`, require authenticated product-scoped `product_documents.manage`; that permission is assigned to the built-in manager role by the migration. A manager cannot author into another resolved product because every query/write scopes `product_id` to the server-resolved context.

Publishing a new version archives the previously published version before the new row is inserted. Explicit archival can also remove the only published document, making it unavailable publicly. These are availability-changing actions. In addition, the insert trigger retains at most five newest versions per product/type/locale while exempting published rows: excess non-published versions are deleted permanently. Operators should not rely on drafts or archived versions as an unlimited audit history. Acceptance snapshots remain independently retained unless their product/user is cascaded away.

## Signup links

Public `client.signupLinks.resolve(slug)` resolves a link only within the anonymous request's server-resolved product. It returns the stored link or 404; it does not itself register a user, check class eligibility, membership, approval, capacity, class publication, or class lifecycle. Those gates remain the responsibility of the consumer that follows the resolved target and the relevant class/registration API.

The link model has exactly two target types (`class-kit-api/supabase/migrations/20260705053145_product_user_profile_metadata_membership_links.sql`, `class-kit-api/supabase/functions/class-kit-signup-links/index.ts`):

| Target type | Required/forbidden fields | Resolution outcome |
| --- | --- | --- |
| `class` | Requires a class ID; filters are stored as `{}`. Creation verifies the class belongs to the resolved product. | Returns the class ID as a public pointer. It does not guarantee the class is currently sign-up eligible. |
| `filter` | Requires no class ID; accepts an object-valued `filters` payload. | Returns that opaque filter object. This function does not interpret or apply it to a class search. |

Creation requires authenticated product-scoped `class_signup_links.manage`, which the migration grants to the built-in manager role. A supplied slug must be 6--64 URL-safe alphanumeric, underscore, or hyphen characters; omitted slugs are generated as 12-character UUID-derived values. Slugs are unique per product, not globally, and duplicates return 409. The API supports create and resolve only: it exposes no update, deactivate, revoke, expiry, or delete action.

Consequently, link creation is durable until a database-level cascade removes it (product deletion, or class deletion for a class-targeted link). A filter target has no linked class cascade. Because resolution is public and links cannot be revoked through the current API, managers should treat a created slug as externally discoverable operational state; withdrawing one requires a capability outside this function's supported surface.

## Known gaps

- The snapshot has no focused Supabase SQL or SDK regression tests for document visibility, fallback selection, acceptance snapshots, version pruning, permission denial, or signup-link creation/resolution. The behavior above is implementation- and migration-grounded, not test-confirmed.
- The signup-link resolver returns targets but no consumer in the assigned flow proves how a filter is applied or whether a resolved class is later subjected to registration gates. This page therefore does not infer eligibility or entitlement from resolving a link.
- The deterministic checkout evidence says the current `master` checkout has an `origin` remote; this conflicts with the authored no-remote statement noted in the project index and should be treated as stale/conflicting documentation, not as a basis for access behavior ([repository identity](../state/repository-identity.json)).
