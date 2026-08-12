# Product documents

Product documents are product-scoped, versioned markdown records for terms, policies, waivers, agreements, and similar text; public readers use the SDK facade, while publication and archival remain manager-authorized backend actions.

## Supported surface

The browser contract is deliberately split by authority:

| Consumer | SDK operation | Backend action | Outcome |
| --- | --- | --- | --- |
| Anyone in a resolved product context | `client.productDocuments.list({ locale? })` | `list` | Returns published summaries only; markdown content and `created_by` are omitted. An optional locale filters the list exactly. |
| Anyone in a resolved product context | `client.productDocuments.get(type, { locale?, fallbackLocale? })` | `get` | Returns one published document including markdown, preferring the requested locale then the fallback locale. |
| Authenticated active product user | `client.productDocuments.accept(type, { locale?, fallbackLocale?, context? })` | `accept` | Records acceptance of the published document selected by the same locale rules. |
| Product principal with explicit `product_documents.manage` | `client.management.productDocuments.upsert(input)` | `upsert` | Inserts a new version; it does not edit an existing record. |
| Product principal with explicit `product_documents.manage` | `client.management.productDocuments.archive(documentId)` | `archive` | Marks that version archived only when it belongs to the resolved product. |

`list` and `get` use anonymous product resolution, so they are public only after ClassKit resolves the product from the request origin (or the local-browser product-key rule). They do not expose drafts or archived versions. `accept`, `upsert`, and `archive` first require authenticated product context. For acceptance, active product-user status is an additional gate; for manager actions, the permission-key gate follows product-context resolution. A manager role receives the key by default, but the implementation checks the explicit grant rather than role level alone. See `class-kit-api/supabase/functions/class-kit-product-documents/index.ts` and `class-kit-api/supabase/migrations/20260705060042_product_documents.sql`.

## Document and locale contract

Each record belongs to one product and contains a lowercase `document_type`, locale, nonblank title and `content_markdown`, positive version, optional `effective_at`, creator, and timestamps. Document types match `^[a-z][a-z0-9_]{1,63}$`; locales match `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$`. Omitted or empty locales default to `en`; an invalid type, locale, title, content, status, or non-ISO effective timestamp is rejected.

The supported statuses are:

| Status | Public-read outcome | Manager outcome |
| --- | --- | --- |
| `draft` | Never returned by `list` or `get`. | Can be created as a new version. |
| `published` | Eligible for `list`, `get`, and acceptance. | Can be created as a new version; creation archives the previously published version with the same product, type, and locale first. |
| `archived` | Never returned publicly and cannot be accepted. | Can be created as a new version, or applied to a specific existing in-product version through `archive`. |

There can be at most one published record per product/type/locale, enforced by a partial unique index. `get` loads eligible published rows for the requested locale and fallback locale, sorts each locale's candidates by `effective_at` descending (null last) and version descending, then chooses any requested-locale result before any fallback result. This means locale preference takes precedence over a newer fallback-locale document.

An `upsert` determines the next version from the highest version for its product/type/locale and inserts it. It can therefore create draft or archived versions as well as published ones. Its name describes the SDK operation, not database update semantics. The post-insert retention trigger deletes non-published versions beyond the newest five rows for that product/type/locale, with published rows included in that five-row ordering. Consequently, when a published row exists, fewer than five non-published rows can remain. This is more precise than the older authored claim that five non-published rows are always retained.

## Acceptance snapshots

Acceptance is not a bare acknowledgement of a type. After resolving the currently published document, the backend stores its id, type, selected locale, version, title, markdown content, the accepting user, product, context, and acceptance time in `product_document_acceptances`. The snapshot preserves what was accepted even if the referenced document is later archived or its foreign-key reference becomes null after deletion.

`context` defaults to `general` and uses the same lowercase identifier format as a document type. The uniqueness key is `(product, user, type, selected locale, version, context)`, so repeating acceptance for the same snapshot and context upserts that acceptance, while a different context or a newly published version has a distinct record. The acceptance table additionally requires that the user is a member of the same product; the Edge Function independently rejects a missing or non-`active` product user before the write.

## Caching and response shape

Successful public `list` and `get` responses carry `Cache-Control: public, max-age=300, stale-while-revalidate=86400`; `get` also supplies an ETag derived from the document id. The SDK caches successful public responses in memory and browser `localStorage` for five minutes, scoped by product key (or auth-storage key) and request payload. Management `upsert` and `archive` clear that SDK cache prefix after their calls. This is a convenience cache, not an authorization or publication boundary: the Edge Function still filters for `published` records.

Concrete browser types and cache behavior live in `class-kit-sdk/src/client/class-kit-client.ts`; the exported document and acceptance shapes live in `class-kit-sdk/src/manager/manager-api.ts`.

## Evidence and confidence

Current behavior is grounded in the Edge Function, database migration, and SDK implementation named above. The deterministic checkout record reports `master` at `4f55d94506f181d179f705173ecd54606b44c90c` with the registered `origin`; see [repository identity](../state/repository-identity.json).

Known verification gap: the snapshot contains no product-document-specific SQL, SDK, or Edge Function regression test. The available SQL regressions cover registration, schedule generation, and admin truncation instead. The production code establishes the documented behavior, but automated coverage is missing for locale preference/fallback, active-user rejection, version publication/archival, acceptance idempotency, retention, and permission enforcement.
