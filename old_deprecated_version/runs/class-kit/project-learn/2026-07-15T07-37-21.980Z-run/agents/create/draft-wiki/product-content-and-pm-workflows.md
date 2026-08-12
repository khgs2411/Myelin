# Product Documents, Change Requests, And PM Mirroring

ClassKit provides product-scoped immutable document acceptance and manager-authored change-request threads; platform administrators can optionally mirror those threads to a single global Trello board without making Trello part of product-site behavior.

## Evidence and verification status

The current snapshot contains the relevant migrations and Edge Function implementations under `class-kit-api/supabase/`, plus SDK and backend API documentation. This page describes behavior implemented in those files. No focused regression tests for these document, request, attachment, or Trello flows were found in the supplied snapshot, so the contracts below still need runtime/test verification; see [Known gaps](#known-gaps).

Product websites use the `@class-kit/react` SDK, rather than calling Edge Functions or database tables directly (`docs/sdk/client-sdk.md`). The browser-facing product and management boundary is deliberately separate from platform administration.

## Product documents and acceptance evidence

`class_kit.product_documents` stores a product's versioned Markdown documents. A document has a product id, `document_type`, locale, title, Markdown body, integer version, optional `effective_at`, creator, and one of these statuses:

| Status | Product-facing outcome |
| --- | --- |
| `draft` | Not returned by public list/get. It remains a manager-visible version. |
| `published` | Returned by public reads. There can be only one published version for a product, document type, and locale. |
| `archived` | Not returned by public reads. It remains historical data. |

Document types must match lowercase snake-case (`^[a-z][a-z0-9_]{1,63}$`); locales use a two- or three-letter language code with an optional language subtag. The product does not maintain a fixed enum of document types, allowing values such as `terms`, `privacy_policy`, or product-specific agreements (`class-kit-api/supabase/functions/class-kit-product-documents/index.ts`).

### Read and publication behavior

- `productDocuments.list()` is anonymous-safe after product resolution and returns published summaries only; it does not expose `content_markdown`.
- `productDocuments.get(documentType, { locale, fallbackLocale })` returns the latest effective published version for the requested locale, then the fallback locale. `locale` defaults to `en`, as does `fallbackLocale`.
- Public reads are cached for five minutes by the SDK and carry backend public-cache headers. A manager document write clears the SDK read cache (`docs/sdk/client-sdk.md`).
- `management.productDocuments.upsert(...)` requires the explicit product-scoped permission key `product_documents.manage`. It always inserts a new version; it never overwrites a prior version. Publishing archives the prior published version for that product/type/locale before inserting the new published row.
- `management.productDocuments.archive(documentId)` also requires `product_documents.manage` and changes that specific product-owned row to `archived`.
- After each insert, a database trigger retains up to the five most recent non-published versions for the product/type/locale. Published rows are excluded from that prune operation (`20260705060042_product_documents.sql`).

The gate order is: resolve the request product from origin/site URL (or the permitted localhost hint), then use anonymous product context for public `list`/`get`; for `accept`, require authenticated product context and active product-user access; for document writes, require authenticated product context followed by the explicit product permission. A valid platform-admin level alone does not imply a product permission key.

### Immutable acceptance record

`productDocuments.accept(documentType, { locale, fallbackLocale, context })` is available only to an authenticated **active** product user. It loads the same currently published document selection used by public get; missing published content is `not_found`.

An acceptance stores the accepted document id, locale, version, title, and full Markdown body in `class_kit.product_document_acceptances`, along with the product, user, context, and timestamp. Consequently, later publication, archive, or deletion of the source document cannot rewrite the accepted text. The unique key is product, user, document type, document locale, document version, and context: retrying the same acceptance is idempotent, while a new version, locale, or context records a distinct acceptance. `context` defaults to `general`; it must be lowercase snake-case and can distinguish flows such as `signup` and `checkout`.

## Product change-request lifecycle

Change requests are product-scoped manager work items, not public customer tickets. `management.changeRequests.*` requires a resolved authenticated product context and the explicit `product_change_requests.manage` permission. Built-in manager roles receive that key by default, but authorization is evaluated from the actual product permission grant, not the role name (`20260707144646_product_change_requests.sql`).

Each row has a thread id, revision number, optional predecessor, creator, optional app-owned JSON-object `context`, optional nonblank title, required description, and these values:

| Field | Supported values | Meaning |
| --- | --- | --- |
| `type` | `issue`, `feature_request` | Required when creating or revising a request. |
| `status` | `open`, `in_progress`, `done`, `closed` | A new request starts `open`; manager revision creation preserves the prior latest status. |
| attachment `status` | `pending`, `uploaded` | A metadata row is pending after signed-upload setup and becomes uploaded only after explicit completion. |

### Create, revise, list, and delete

- `create` inserts version 1 with a new thread id and status `open`.
- `update` is append-only: it first resolves the current latest visible revision, then inserts a new row in that thread with `version_number + 1` and `previous_request_id` pointing to the prior latest revision. It does not edit the old row and carries forward status only; the caller supplies the replacement type, context, title, and description.
- `list` excludes soft-deleted rows, groups visible revisions by thread, and returns the latest revision as the request with ascending historical revisions in `request.revisions`.
- Manager `delete` soft-deletes every revision in the thread, recording time and actor. Deleted threads no longer appear in manager or admin lists, but rows remain as an audit trail.
- A platform admin can list requests across all products or one explicit `product_key`, update the latest visible revision's status to any supported status, and soft-delete the entire thread through `admin.changeRequests.*` (`class-kit-admin-product-change-requests/index.ts`).

There is no manager action to set status directly. The authoritative internal status changes through platform-admin handling or a later platform-admin PM sync. This avoids a product manager's revision from silently changing the operational status.

### Private attachments

Attachments belong to a concrete request revision and product, and use the private `product-change-request-attachments` Supabase Storage bucket. The bucket admits only PNG, JPEG, WebP, PDF, and plain-text content and has a 10 MiB limit (`20260707144646_product_change_requests.sql`).

For a manager upload, the backend validates request ownership, nonblank filename, and an optional integer `size_bytes` between 0 and 10 MiB; it creates a pending metadata row and a signed upload URL. If signed URL creation fails, it removes that metadata row. The client uploads using that narrow signed URL and calls `completeAttachmentUpload`, which changes the owned attachment to `uploaded`. The current completion implementation does not independently verify that the object exists before marking it uploaded; treat that as an integrity coverage gap.

Neither a product website nor a manager gets broad bucket access. Only a platform admin can request an on-demand, 10-minute signed URL for an attachment whose status is `uploaded`; it defaults to download disposition, while `{ download: false }` supports an inline preview.

## Admin-only Trello mirror

`admin.pmIntegrations.*` and `class-kit-admin-pm-integrations` require platform-admin authority. They are intentionally outside both product websites and manager dashboards. ClassKit's request thread remains the canonical ticket record; a Trello card and PM-link rows are operational mirror metadata (`docs/api/backend-api.md#admin-pm-integration`).

The current provider set is exactly `trello`. Configuration is a global singleton with `enabled`, one board id, and route ids for `todo`, `in_progress`, `blocked`, and `done`; per-product boards, webhooks, OAuth, and automatic manager-created cards are out of scope. Trello credentials remain server-side Edge Function secrets (`TRELLO_API_KEY`, `TRELLO_TOKEN`). A cached board snapshot helps an admin select lists, labels, and members, but it is not the routing source of truth.

### Promotion and link behavior

After a platform admin configures and enables the integration:

- `createWorkItem(requestId, labelMappingIds?, forceNew?)` reads the complete request thread, includes only attachments marked `uploaded`, creates the Trello card in the configured to-do list, and records one local link per provider/product/thread.
- It mirrors selected configured labels and uploaded attachments. Individual attachment failures are recorded as failed mirror results and warnings; they do not undo an otherwise-created card.
- A second normal promotion returns the existing link. `forceNew: true` creates another Trello card, removes and replaces only the local link, and does not delete or alter the earlier Trello card.
- `detachWorkItem(pmLinkId)` deletes only the local link and its local attachment/label-link metadata. It never deletes the Trello card.
- If a synced Trello card is missing, ClassKit detaches the local link and returns `detached: true`, permitting later re-linking.

Only configured label mappings survive sync; unmapped labels present on Trello are ignored in ClassKit's PM-link representation.

### Status synchronization

Trello movement is not a webhook or autonomous state transition. A platform-admin `syncWorkItem` or `syncLinkedWorkItems` fetches the card state and may update the **latest** ClassKit request revision. The mapping is:

| Configured Trello list | PM status retained on link | ClassKit request status effect |
| --- | --- | --- |
| to-do | `todo` | set `open` |
| in-progress | `in_progress` | set `in_progress` |
| blocked | `blocked` | set `in_progress` |
| done | `done` | set `done` |
| any other list | `unknown` | no change |

`closed` is a valid internal admin-set status but has no Trello-list mapping. Conversely, `blocked` and `unknown` are preserved in PM-link metadata even though the internal request status does not represent them. This precedence means a sync can replace a manager-visible latest status only when the mapped Trello value is `open`, `in_progress`, or `done`; unknown Trello placement leaves that status untouched.

## Known gaps

- No focused regression tests or executable end-to-end fixtures for product-document publication/locale fallback, acceptance snapshots/idempotency, permission gates, revision/thread behavior, attachment upload completion, or signed download authorization were found in this snapshot.
- The attachment completion path marks a record uploaded without checking storage-object existence or size/content-type after upload. Runtime behavior for a missing or substituted uploaded object is not covered here.
- Document publication archives the prior published row before inserting the next row through separate service-client operations. The unique partial index preserves the one-published-version invariant, but concurrency/retry behavior and rollback semantics lack focused verification evidence.
- Trello API behavior, credentials, rate limits, partial attachment failures, link replacement, and status-sync failure recovery have implementation evidence but no supplied integration tests or recorded live verification.
