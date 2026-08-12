# Product documents and signup links

Product documents provide product-scoped public Markdown, a mutable manager draft, immutable publication history, and acceptance records. Signup links are public, product-scoped pointers to a class or caller-defined filter.

## Browser and authority boundary

The published `@class-kit/react` client is the browser boundary. Public methods are `client.productDocuments.list`, `get`, and `accept`, plus `client.signupLinks.resolve`; manager document methods are under `client.management.productDocuments`. The SDK supplies the browser site URL and only sends a configured product key from a local origin. The API still resolves product ownership server-side from the origin/site URL and enforces authentication and `product_documents.manage` before any manager operation (`class-kit-sdk/src/client/product-api.ts`, `class-kit-api/supabase/functions/_shared/context.ts`, `class-kit-api/supabase/functions/class-kit-product-documents/index.ts`).

## Product-document lifecycle

Each `(product, document_type, locale)` is one stream. `class_kit.product_document_streams` serializes changes, `product_document_drafts` holds at most one mutable draft, `product_document_versions` holds immutable publications, and `product_document_active_versions` points to the one version that public reads may expose. The versions-to-stream foreign key has `ON DELETE CASCADE` and is required for the manager reads that embed stream-owned versions (`20260715082037_product_document_publication_history.sql`, `20260716082959_add_product_document_versions_stream_foreign_key.sql`).

Supported states and transitions are:

| Resource/state | Supported operation and outcome |
| --- | --- |
| No draft | `save_draft` with `expected_revision: null` creates revision 1. |
| Draft at revision *n* | `save_draft` with exactly *n* updates it to *n* + 1; `discard_draft` with exactly *n* deletes only that draft. A stale revision returns `409 conflict`. |
| Draft plus active version (or no active version) | `publish_draft` requires both the exact draft revision and the expected active version ID (which may be `null`). It creates the next immutable version, moves the active pointer, and deletes the draft atomically. A stale expectation changes neither history nor public state. |
| Active version | `archive_active_version` requires its exact ID, then clears only the pointer. The immutable version remains in history; stale IDs return `409 conflict`. |
| Immutable version | `list_versions` returns summaries and the active ID; `get_version` returns one product-owned full version. A manager can restore content only by copying it into a new draft and publishing a new version. No update, delete, or history-pruning operation is supported. |

Manager actions require authenticated product context, `product_documents.manage`, and an exact locale: `get_draft`, `save_draft`, `discard_draft`, `list_versions`, `get_version`, `publish_draft`, and `archive_active_version`. The legacy `upsert` and `archive` actions are rejected. Missing authentication is `401`; a missing permission or a version in another product is `403`; missing resources are `404`; invalid input is `400`.

Public `list` exposes only streams with an active version. Public `get` prefers an active version in the requested locale, then an active version in the fallback locale; a draft-only preferred locale does not hide that fallback. Public reads use a five-minute cache policy; successful publish and active-version archive invalidate the SDK's relevant public-document cache, while draft/history operations do not. `document_type` and acceptance `context` use `[a-z][a-z0-9_]{1,63}`; locales use the API's two/three-letter language code plus optional subtag grammar.

### Acceptance and gate precedence

`accept` applies the gates in this order: resolve the product → require authenticated product context → require an active product user → resolve the active requested/fallback publication → validate context → upsert the acceptance snapshot. Authentication without active product access is therefore denied before document lookup or write. The snapshot records the active version's ID, locale, version, title, Markdown, context, and time, so later publication changes do not rewrite acceptance evidence. Repeating the same product/user/type/locale/version/context updates that acceptance; a new version, locale, or context creates another record. No current class-registration or entitlement operation treats acceptance as a prerequisite.

Demo2 currently composes this manager API into its Terms of Service editor for `terms` / `en`; it can save, publish, archive the active publication, inspect history, and restore an older version by drafting and republishing it (`apps/demo2/src/product-document-manager.tsx`). That UI is a consumer, not a second authority for the lifecycle.

## Signup links

Public `client.signupLinks.resolve(slug)` resolves only in the server-resolved product. It returns a stored pointer or `404`; it neither registers a user nor evaluates class eligibility, membership, approval, capacity, publication, or lifecycle. Those gates apply later when a consumer follows the target.

| Target type | Required shape | Resolution outcome |
| --- | --- | --- |
| `class` | A same-product class ID; filters are `{}`. | Returns the class pointer without guaranteeing current registration eligibility. |
| `filter` | No class ID and an object-valued `filters` payload. | Returns the opaque filter object; this function does not interpret it. |

Creation requires authenticated `class_signup_links.manage`. Slugs are unique per product and either supplied as 6–64 URL-safe characters or generated; duplicate slugs return `409`. The API has create and resolve only—no update, revoke, expiry, or delete—so a created link remains externally discoverable until a database-level cascade removes it.

## Evidence and known gaps

The lifecycle is grounded in `class-kit-api/supabase/functions/class-kit-product-documents/index.ts`, migrations `20260715082037_product_document_publication_history.sql` and `20260716082959_add_product_document_versions_stream_foreign_key.sql`, and SDK facade/tests `class-kit-sdk/tests/product-documents.test.mjs`. SQL regression coverage in `class-kit-api/supabase/tests/product_document_publication_history.sql` verifies draft and active-version compare-and-swap, immutable history, archive retention, legacy-action removal, and the stream foreign key; the SDK test verifies exact manager wire actions and public-cache invalidation boundaries.

- The snapshot does not contain an end-to-end deployed API/SDK test for public fallback, acceptance persistence, manager permission denial, or Demo2's visual workflow. Those outcomes are implementation-grounded but not fully regression-proven.
- No supplied consumer proves how a filter link is applied or whether a class resolved from a signup link later passes registration gates.
