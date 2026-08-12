# Documents, signup links, and product change requests

ClassKit provides product-scoped published documents and acceptance records, durable public signup-link resolution, and a manager-to-admin change-request workflow with private attachments.

## Evidence status

This snapshot does not contain the assigned Edge Function, migration, or regression-test files: `class-kit-api/supabase/functions/class-kit-product-documents/index.ts`, `class-kit-api/supabase/functions/class-kit-signup-links/index.ts`, `class-kit-api/supabase/functions/class-kit-product-change-requests/index.ts`, `20260705060042_product_documents.sql`, and `20260707144646_product_change_requests.sql` are absent from `target-repo/`. The behavior below is therefore documented-contract evidence from the current API map, SDK guide, backend guide, and changelog, not direct source verification. The supplied checkout identity identifies the registered repository as `class-kit` on `master` (`repository-identity.json`); the source snapshot is documentation-only.

## Ownership and access boundary

All three capabilities are product-scoped. Public lookups resolve the product through the normal browser origin or localhost product-key hint; they do not accept arbitrary cross-product access.

| Capability | Public caller | Active product user | Product manager with explicit permission | Platform admin |
| --- | --- | --- | --- | --- |
| Signup-link resolution | May resolve a slug anonymously | May resolve it | Creates links with `class_signup_links.manage` | Not separately documented for this surface |
| Published document reads | May list/get published content anonymously | Same reads; may accept | Versions/archives with `product_documents.manage` | Not separately documented for this surface |
| Change requests | No public workflow | No ordinary user workflow documented | Creates, revises, lists, deletes with `product_change_requests.manage` | Lists across products, changes status, deletes, and issues attachment URLs |

The built-in product `manager` role is documented as receiving all three permission keys by default. Permission-key grants remain explicit; a role's numeric level alone does not satisfy a key-guarded operation (`docs/product-shape.md`, `docs/api/backend-api.md`).

## Signup links

Signup links are durable manager-created routes stored in `class_kit.class_signup_links`. A manager creates either:

- a `class` target, which resolves to `target_type: "class"` with `class_id`; or
- a `filter` target, which resolves to `target_type: "filter"` with the product-owned `filters` object (for example category or weekdays).

Creation uses `class-kit-signup-links` action `create` through `management.signupLinks.create(input)` and requires `class_signup_links.manage`. Resolution uses `resolve` through `signupLinks.resolve(slug)` and is anonymous-safe. A consuming website should route the resolved class target to class detail or the filter target to discovery; it does not need direct table access. The documented precedence is product resolution first (origin or localhost hint), then slug lookup within that resolved product.

## Product documents and acceptance history

Documents are immutable, versioned product content for terms, policies, waivers, agreements, and similar material. Current documentation names `class_kit.product_documents` for versions and `class_kit.product_document_acceptances` for acceptance snapshots.

### Version and publication state

`management.productDocuments.upsert(input)` inserts a new version; it does not update an existing row. A manager supplies a document type, locale, title, markdown content, status, and optional effective time. When a version is published, the prior published version for the same product, type, and locale is archived. `management.productDocuments.archive(documentId)` archives one specific version. The documented retention trigger prunes older non-published versions beyond the newest five for that product/type/locale.

| State/operation | Public `list`/`get` outcome | Manager outcome |
| --- | --- | --- |
| Published | Eligible for public reads | A later publish archives it for the same type/locale |
| Non-published | Not returned publicly | Retained unless older than the five-version non-published limit |
| Archived | Not returned publicly | Remains an archived historical version |
| New upsert | Cannot replace an existing version | Creates a distinct immutable version |

The documentation does not enumerate the exact persisted status enum beyond the public/archived behavior above; direct migration verification is required before treating additional status values or exact transition validation as complete.

### Public reads and locale selection

`productDocuments.list(options?)` is anonymous-safe and returns published summaries without `content_markdown`. `productDocuments.get(documentType, options?)` returns markdown content for the latest published version matching the requested type and locale. If the requested locale has no published version, it may fall back to `fallbackLocale`. Both calls are product-scoped, set public cache headers at the backend boundary, and successful SDK responses are cached in memory and `localStorage` for five minutes. Management writes clear that SDK read cache.

### Acceptance gate and snapshot

`productDocuments.accept(documentType, input?)` requires an authenticated **active product user**. It records the accepted document id, type, locale, version, title, markdown content, and optional context; SDK documentation says context defaults to `"general"` and can distinguish flows such as `"signup"` or `"checkout"`. Because the content is copied into the acceptance record, later document edits or later publications do not rewrite prior acceptances. The documented gate order is: resolve product, identify/authenticate caller, confirm active product-user membership, resolve the published document/version and locale, then create the snapshot. Exact error and idempotency behavior are unverified in this snapshot.

## Product change requests

Product change requests are the internal manager-facing ticket surface for website fixes, content changes, issues, and features. They are stored in `class_kit.product_change_requests`; attachment metadata is stored in `class_kit.product_change_request_attachments`, while file bytes reside in the private `product-change-request-attachments` Storage bucket.

### Request states and revision model

The documented request types are `issue` and `feature_request`. The complete documented status vocabulary is `open`, `in_progress`, `done`, and `closed`.

| Operation | Result |
| --- | --- |
| Create | Adds a current-product request with type, title, description, and optional app-owned JSON `context` |
| Update | Appends a new revision in the same `thread_id`, increments `version_number`, and points `previous_request_id` at the prior latest revision |
| List | Returns the latest visible revision for each thread with attachment metadata and visible history in `revisions` |
| Delete | Soft-deletes the entire thread from manager and admin list surfaces while retaining the database audit trail |
| Admin status update | Sets a request to one of the documented status values; exact transition restrictions are not source-verified |

ClassKit stores `context` as a JSON object without interpreting view, label, path, URL, or route semantics. Managers use `management.changeRequests.create/update/delete/list`; all require `product_change_requests.manage` according to the backend/API map. The platform-admin surface uses `admin.changeRequests.list({ productKey })`, `updateStatus`, and `delete`, permitting cross-product review through an explicit product key where applicable.

### Private attachment workflow

Attachments never travel in the JSON API response as broad public Storage access. The normal manager SDK `uploadAttachment(requestId, input)` flow is:

1. The backend creates attachment metadata and returns a signed upload URL (`create_attachment_upload`).
2. The SDK uploads the file directly to the private Storage bucket.
3. The SDK marks the attachment uploaded (`complete_attachment_upload`).

Custom UIs may call the lower-level create/complete methods. Platform admins obtain a short-lived signed URL only when opening an attachment: the default is download behavior, and `{ download: false }` requests an inline-preview URL. Product websites receive no broad Storage permission. Exact upload status values, expiry, file validation, and recovery behavior require the missing function/migration sources.

## External work-item boundary

The optional Trello integration is platform-admin-only and mirrors this internal ticket system; product websites and manager dashboards should continue to use `management.changeRequests.*` and should not need Trello knowledge. Admin code can create or detach an external card and sync its status. Documented mapping is `todo -> open`, `in_progress -> in_progress`, `blocked -> in_progress`, `done -> done`; an `unknown` external state causes no ClassKit status mutation. This integration is described in `docs/changelog.md` and `docs/sdk/client-sdk.md`, but its implementation is outside this subject's assigned source paths.

## Known gaps

- Direct confirmation of database schemas, enum/check constraints, RLS policies, and triggers is unavailable because both assigned migrations are absent.
- Direct confirmation of action request/response shapes, error ordering, authorization precedence, locale fallback edge cases, acceptance idempotency, and cache-control values is unavailable because the assigned Edge Functions are absent.
- No regression tests are mounted, so the documented lifecycle and authorization behavior has no test corroboration in this snapshot.
- The exact document status enum and the allowed/blocked change-request status transitions must be verified from source before this subject can be considered a complete implementation contract.
