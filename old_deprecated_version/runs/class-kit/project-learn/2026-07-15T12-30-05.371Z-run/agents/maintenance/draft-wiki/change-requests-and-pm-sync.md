# Product change requests and Trello synchronization

Product change requests are manager-authored, product-scoped revision threads. Platform administrators triage their current revision and can optionally route a thread to one Trello card, whose configured list position is reflected back into the request status.

## Access and request scope

Every action in `class-kit-product-change-requests` first resolves the request's product context and then requires the product-scoped `product_change_requests.manage` permission. The built-in `manager` role receives that permission in `class-kit-api/supabase/migrations/20260707144646_product_change_requests.sql`; a platform-admin role alone is not the product-function authorization contract. The product API supports `list`, `create`, `update`, `delete`, `create_attachment_upload`, and `complete_attachment_upload`.

Platform triage uses `class-kit-admin-product-change-requests` and requires platform-admin access. Its `list` can span all products or be filtered by `product_key`; `update_status`, `delete`, and attachment-download actions operate across the platform. The PM-integration API (`class-kit-admin-pm-integrations`) is platform-admin-only as well, so managers can submit and revise requests but cannot create, detach, or synchronize external work items.

## Thread and revision model

`class_kit.product_change_requests` stores one row per revision rather than overwriting prior content. A new request receives a generated `thread_id`, version `1`, and one of these required types:

| Type | Meaning in the current contract |
| --- | --- |
| `issue` | A product issue submitted for review. |
| `feature_request` | A product feature request submitted for review. |

Creating requires a non-empty `description`; `title` is optional but, when present, must be non-empty after trimming. `context` is an object and defaults to `{}`. Updating requires an existing, non-deleted request and inserts a new row in the same thread with `previous_request_id` set to the current latest revision and `version_number + 1`. It requires a new type, description, title/context payload, and carries the prior revision's status forward. Thus a request update is a content revision, not an in-place edit and not a status transition.

Lists exclude deleted rows, group retained rows by `thread_id`, order each group's revisions from oldest to newest, and expose the latest revision as the thread's current request. Threads are ordered by the latest revision's creation time. Both product and platform APIs attach files to their owning revision while returning the full revision list.

## Request status and deletion

The request status vocabulary is `open`, `in_progress`, `done`, and `closed`; new requests start as `open`.

| Status | Current handling |
| --- | --- |
| `open` | Default state; also the mapped result of a Trello `todo` list. |
| `in_progress` | A platform-admin triage value; mapped from Trello `in_progress` and `blocked`. |
| `done` | A platform-admin triage value; mapped from Trello `done`. |
| `closed` | A platform-admin triage value with no current Trello-list mapping. |

Platform `update_status` first resolves the thread's latest non-deleted revision and updates that row in place. This means manual triage does not create a new revision. Product managers do not have a status-update action.

Deletion is soft and thread-wide: either the product manager (for their resolved product) or a platform admin resolves one non-deleted revision, then sets `deleted_at` and `deleted_by_user_id` on every row with its product and `thread_id`. Deleted rows are excluded from list, update, attachment-upload, and PM-routing lookups; the database's cascading foreign keys do not remove them merely because they are soft-deleted.

## Attachment lifecycle

Attachments live in the private `product-change-request-attachments` storage bucket. The bucket allows PNG, JPEG, WebP, PDF, and plain-text files and has a 10 MiB limit. The API separately validates only that supplied `size_bytes`, if provided, is a non-negative integer no larger than 10 MiB; its object row records `pending` first.

1. A permitted product manager selects a non-deleted request revision and calls `create_attachment_upload` with a non-empty file name, optional content type, and optional size.
2. The service creates an attachment row with status `pending` and an object path shaped as `<product_key>/<request_id>/<attachment_id>/<sanitized-file-name>`, then returns a signed upload URL and token.
3. If signed-URL creation fails, the newly created attachment row is deleted. Otherwise the client uploads to that URL.
4. The caller invokes `complete_attachment_upload`; the service marks the attachment `uploaded` when the attachment ID belongs to the resolved product. It does not itself verify the object exists or re-check its stored bytes/content type at completion.
5. Platform admins can request a signed download URL only for an `uploaded` attachment. It expires after 600 seconds and defaults to a download using the recorded file name.

Only `uploaded` attachments from every non-deleted revision in a routed thread are eligible for Trello mirroring. Pending attachments remain visible in ordinary request lists but are not passed to the PM provider.

## Trello configuration and routing

Trello is the only supported PM provider. One global configuration records whether it is enabled, the board ID, and non-empty IDs for `todo`, `in_progress`, `blocked`, and `done` lists. Platform admins can save that configuration, test that the board and every configured list are reachable, retrieve a cached board snapshot, or refresh a snapshot from Trello. Credentials are supplied through `TRELLO_API_KEY` and `TRELLO_TOKEN`, not through the configuration rows.

Optional label mappings are board-specific provider-label IDs with display names. Updating the configuration replaces all saved mappings for that board; creating or syncing a card preserves only labels that are still configured for its board.

Creating a work item requires configured **and enabled** PM integration. The service loads the full non-deleted thread, its latest revision, product metadata, uploaded attachments across its revisions, and selected configured labels. It creates a Trello card in the configured todo list containing the latest content, JSON context, revision summary, attachment names, product details, and—when an origin was supplied—an admin URL. A link is unique per `(provider, product_id, request_thread_id)`:

- An existing link is returned unchanged unless `force_new` is supplied.
- `force_new` creates the replacement card first, then deletes the old link and its dependent link records before storing the replacement.
- Detaching a work item deletes only the local PM-link row; it does not delete the Trello card.

The link records card/board/list identifiers and URL, provider status, the last mapped request status, sync time, and aggregate attachment result. Per-attachment links are unique per PM link and attachment. A failed attachment upload does not discard the newly created card: the aggregate is `complete` when all uploads succeed, `partial` when at least one succeeds and one fails, `failed` when every attempted upload fails, and `not_started` when there were no uploaded attachments.

## Synchronization and status mapping

`sync_work_item` synchronizes one local link; `sync_linked_work_items` iterates all Trello links, optionally limited to a product. For each available card, the provider reads its list and labels, updates the local link's list/status/mapped-status/sync time, and replaces its retained configured-label links. If the provider reports a missing card (404), the service detaches the local link and leaves the ClassKit request untouched. Other per-link failures are returned in the bulk result without stopping remaining links.

| Configured Trello list | Provider status | ClassKit request result |
| --- | --- | --- |
| Todo | `todo` | Set latest revision to `open`. |
| In progress | `in_progress` | Set latest revision to `in_progress`. |
| Blocked | `blocked` | Set latest revision to `in_progress`; ClassKit has no `blocked` request state. |
| Done | `done` | Set latest revision to `done`. |
| Any other/missing list | `unknown` | Record `unknown` on the link; do not mutate the request. |

The request is changed only when the mapping is non-null and differs from the latest revision's current status. Synchronization never creates a revision, and no Trello list automatically produces `closed`.

## Known gaps

- No focused current regression tests for these change-request or PM-integration Edge Functions were found in the supplied snapshot, so request/revision, attachment, and provider failure behavior is evidenced by the implementation and migrations rather than executable regression coverage.
- `complete_attachment_upload` trusts the completion call and does not verify that the storage object was uploaded or matches the declared metadata; callers and downstream mirroring must therefore treat `uploaded` as application-confirmed, not independently storage-verified.
- PM synchronization is request-driven (`sync_work_item` or bulk `sync_linked_work_items`); no server-side schedule was found in the inspected implementation.

## Evidence

- `class-kit-api/supabase/functions/class-kit-product-change-requests/index.ts`
- `class-kit-api/supabase/functions/class-kit-admin-product-change-requests/index.ts`
- `class-kit-api/supabase/functions/class-kit-admin-pm-integrations/index.ts`
- `class-kit-api/supabase/functions/_shared/pm/types.ts`
- `class-kit-api/supabase/functions/_shared/pm/providers/trello_provider.ts`
- `class-kit-api/supabase/migrations/20260707144646_product_change_requests.sql`
- `class-kit-api/supabase/migrations/20260708110703_pm_software_integrations.sql`
- `class-kit-api/supabase/migrations/20260708131835_pm_trello_labels.sql`
- `class-kit-api/supabase/migrations/20260709072033_pm_board_snapshots.sql`
- [repository identity](../state/repository-identity.json)
