# Product documents and change requests

ClassKit keeps product-facing legal/policy text and manager-submitted website feedback as separate product-scoped records: documents are versioned markdown with acceptance snapshots, while change requests are append-only revision threads with platform-owned handling status.

## Product documents

`class_kit.product_documents` stores a document for one product, `document_type`, locale, and positive integer version. A type must match `^[a-z][a-z0-9_]{1,63}$`; locales use a two- or three-letter language code with an optional BCP-47-style suffix. Both title and markdown content must be non-blank. The current supported status values are:

| Status | Public visibility | Management effect |
| --- | --- | --- |
| `draft` | Not returned by public list/get | A saved version that is not public. |
| `published` | Returned by public list/get | At most one published version exists for each product/type/locale. |
| `archived` | Not returned by public list/get | Retained historical version. |

The public `class-kit-product-documents` `list` and `get` actions resolve the product by the normal anonymous product-context boundary (site origin, or the permitted product-key hint), then query only `published` rows. `list` may filter by locale and returns summaries without markdown; `get` requires a type, defaults both requested and fallback locale to `en`, and chooses the latest published requested-locale row before trying the fallback locale. Within a locale it orders by non-null `effective_at` descending and then version descending. Successful public responses advertise five-minute freshness with stale-while-revalidate support and a document `ETag` for `get`; the SDK also caches successful document reads for five minutes.

### Version, publishing, and retention contract

`management.productDocuments.upsert(...)` is an insert-only operation, despite its name. After product context and `product_documents.manage` permission pass, it calculates the next version from the latest row for the same product/type/locale and inserts that version. The permission is granted to the built-in `manager` role by default, but the runtime guard checks the permission key rather than assuming the role name.

- Omitting `status` publishes the new version; `draft`, `published`, and `archived` are the only accepted values.
- Before inserting a `published` version, the function archives the existing published row for that same product/type/locale. The partial unique index then enforces the one-published-version invariant.
- `effective_at` is optional but, when supplied, must parse as an ISO timestamp; it orders public `get` selection but does not itself prevent a published row from being returned before that timestamp.
- `management.productDocuments.archive(documentId)` requires the same permission and changes that exact product-scoped version to `archived`; it does not promote an older version.
- An after-insert trigger keeps the newest five non-published rows for each product/type/locale and deletes older non-published rows. Published versions are excluded from this pruning rule.

The write paths clear the SDK's product-document cache. The migration and Edge Function establish the intended current behavior; this snapshot has no focused SQL or Edge Function regression test for concurrent publishing, pruning, locale selection, or cache invalidation.

### Acceptance snapshots

`productDocuments.accept(type, { locale, fallbackLocale, context })` first requires an authenticated caller, then requires an `active` product-user row. This is stricter than public reading but does not impose a membership or class-registration gate. It resolves the same published document selection as `get` and writes an acceptance snapshot containing its id (nullable if later deleted), chosen locale, version, title, and complete markdown content.

`context` defaults to `general` and must use the same lower-snake-case pattern as document types. The unique key is `(product, user, document type, document locale, document version, context)`, so repeating the same acceptance is idempotent, while a new version, locale, or context creates a separate record. Managers and platform admins can read acceptance records; a user can read their own. There is no direct product-user write policy: the Edge Function's service client is the supported write boundary.

The access precedence is therefore: resolve product and allowed auth provider → for `accept`, require a bearer-authenticated user → require active product-user status → resolve a published document with requested-locale-before-fallback precedence → validate context → persist the snapshot. Public list/get stop after product resolution and published-status filtering.

## Product change requests

`class_kit.product_change_requests` represents manager-originated issues and feature requests. It is not a public product-site feedback endpoint: every product API action requires an authenticated product context and `product_change_requests.manage`. Built-in managers receive that permission by default, but custom roles may receive it as well.

| Field/contract | Supported values and outcome |
| --- | --- |
| `type` | `issue` or `feature_request`; required on create and revision. |
| `status` | `open`, `in_progress`, `done`, or `closed`; create defaults to `open`. Product managers preserve the existing status when revising; they do not set it through the product API. |
| `context` | Optional JSON object, default `{}`. ClassKit stores it without interpreting app route, view, label, or URL semantics. Arrays and non-objects are rejected. |
| `title` | Optional non-blank string; omitted/empty becomes `null`. |
| `description` | Required non-blank string. |
| deletion | A soft deletion marks every revision in the thread with `deleted_at` and `deleted_by_user_id`; normal lists omit the entire thread. |

Create produces version 1 with a new `thread_id`. Update requires an existing visible request, resolves the latest visible revision in its thread, and inserts a new row with the same `thread_id`, `previous_request_id` set to that latest row, and `version_number + 1`. The type, context, title, and description come from the update request; status is carried forward. Rows are not edited in place by the manager API. List returns only each thread's latest visible row, ordered by latest creation time, with that row's visible revisions ordered oldest-to-newest and attachments grouped under the owning revision.

This yields the following gate order for a manager action: product/origin resolution and allowed auth provider → bearer authentication → `product_change_requests.manage` for the resolved product → action-specific request/attachment lookup constrained to that product and not soft-deleted → validation → create a revision, mark a thread deleted, or return its current view. Membership eligibility, registration state, and document acceptance are not consulted by this contract.

### Attachments

Attachment metadata lives in `class_kit.product_change_request_attachments`; files live in the private `product-change-request-attachments` Storage bucket. The bucket allows PNG, JPEG, WebP, PDF, and plain text with a 10 MiB object limit. The API independently rejects a supplied `size_bytes` outside 0 through 10,485,760, but does not validate the `content_type` against the bucket allow-list before issuing the signed URL.

The lifecycle is `pending` then `uploaded`:

1. A permitted manager calls `create_attachment_upload` for a visible request. The service creates a `pending` metadata row and a signed upload URL whose path contains product key, request id, attachment id, and a sanitized file name.
2. The client uploads directly to Storage with that signed URL.
3. The manager calls `complete_attachment_upload`, which changes that product-scoped attachment's status to `uploaded`.

If signed URL creation fails, the function deletes the just-created metadata row. Completion does not inspect Storage before changing status, so the implementation does not prove that an object exists at completion time. Pending attachments are returned in manager/admin lists, but platform download URLs are available only for `uploaded` attachments.

## Platform handling and PM synchronization

Platform admins, not product managers, use `admin.changeRequests.*` / `class-kit-admin-product-change-requests` to list all products or one explicit `product_key`, change the latest revision's status, soft-delete a thread, and mint a ten-minute signed download URL for an uploaded attachment. This platform boundary is level-100 platform-admin authority; it does not rely on the product manager permission.

An optional platform-only Trello integration promotes a request thread into external PM work. ClassKit remains the canonical request store. During an explicit sync, mapped provider states update the latest ClassKit revision as follows: `todo` → `open`; `in_progress` and `blocked` → `in_progress`; `done` → `done`; an unmapped/other provider state leaves ClassKit's status unchanged. `closed` is a ClassKit status accepted by the admin API, but no current PM mapping produces it. A manager revision after platform handling preserves the current status, so editing content does not reopen or otherwise reset the workflow.

## Evidence and known gaps

Current implementation evidence is the document migration and `class-kit-product-documents` function, the change-request migration and both product/admin Edge Functions, plus SDK source exposing the supported namespaces. The repository's own API and SDK documentation agrees with those code paths. There are no snapshot tests specifically covering document state transitions, acceptance idempotency, change-request revisions/deletion, attachment completion, platform status updates, or Trello status mapping; these behavior contracts should receive regression coverage before being treated as exhaustively verified.

Relevant paths: `class-kit-api/supabase/migrations/20260705060042_product_documents.sql`, `class-kit-api/supabase/functions/class-kit-product-documents/index.ts`, `class-kit-api/supabase/migrations/20260707144646_product_change_requests.sql`, `class-kit-api/supabase/functions/class-kit-product-change-requests/index.ts`, `class-kit-api/supabase/functions/class-kit-admin-product-change-requests/index.ts`, and `class-kit-api/supabase/functions/class-kit-admin-pm-integrations/index.ts`.
