# Change requests and project-management integration

Change requests let authorized product managers submit versioned issues or feature requests with private attachments, while platform administrators review the current request state and optionally connect a request thread to a global Trello workflow.

## Authority and scope

The product-facing `class-kit-product-change-requests` Edge Function first resolves the calling product from the request context, then requires the product-scoped `product_change_requests.manage` permission. The built-in `manager` role receives that permission. A manager can therefore operate only within their resolved product; all request and attachment queries are additionally constrained by its `product_id`. The API does not expose this workflow to ordinary product users.

The platform-admin functions, `class-kit-admin-product-change-requests` and `class-kit-admin-pm-integrations`, require a platform-admin request. They can list requests across products (or filter by `product_key`), set request handling status, soft-delete a thread, issue attachment download URLs, and administer the single global Trello configuration. This is deliberately a higher boundary than product management: a product manager cannot review another product's request or create/synchronize a Trello card.

The request and attachment tables have RLS enabled and grant write access only to `service_role`; the Edge Functions are the supported write path. The current checkout is the available `master` repository with an `origin` remote, according to [repository identity](../repository-identity.json).

## Request threads, revision history, and deletion

Each request is one of two types:

- `issue` — a product problem report.
- `feature_request` — a requested capability.

Creating a request produces version 1 in a new `thread_id`, with required non-blank `description`, optional non-blank `title`, and optional object-valued `context` (default `{}`). A new request starts `open`. The current handling states are `open`, `in_progress`, `done`, and `closed`.

Updating a request does not overwrite its content. The function resolves the latest non-deleted row for the supplied request's thread, then inserts the next `version_number`, points `previous_request_id` to that latest row, and carries forward the current status. As a result, a manager who supplies an older revision still creates the next revision from the thread's latest version; history remains visible in the `revisions` array while list responses present the newest revision as the thread's current request. Attachments remain associated with the revision to which they were uploaded.

Only a platform administrator can directly change a request's status. `update_status` resolves the thread's latest revision and updates that row in place; it accepts only the four states above. Product-manager updates preserve that latest status rather than resetting it.

Deletion is a soft deletion of the entire thread, not a physical request-row delete: every row with the same `product_id` and `thread_id` receives `deleted_at` and `deleted_by_user_id`. Product and admin list/read helpers exclude these rows, so the request disappears from normal manager and platform-admin workflows. The migration deliberately retains the request and its revision history, but there is no restore action in the current API. This is therefore user-visible removal with retained database evidence rather than a recoverable UI transition. Foreign-key cascading only applies if the product or a request row is later physically removed; this subject does not establish a deletion or pruning operation for objects already stored in the private attachment bucket.

## Attachments

An attachment belongs to one request revision and is stored in the private `product-change-request-attachments` bucket. `create_attachment_upload` creates a `pending` attachment row and returns a signed upload URL. The row records the original file name, optional content type and size, uploader, bucket, and generated product/request-scoped object path. The caller then uses `complete_attachment_upload` to change that row to `uploaded`.

The supported attachment states are:

- `pending` — an upload URL and metadata exist, but the caller has not completed the workflow. Pending attachments are returned with their revision but are excluded from Trello mirroring and cannot receive an admin download URL.
- `uploaded` — eligible for a platform administrator's 10-minute signed download URL and for mirroring when a Trello card is created.

The Edge Function accepts only non-negative integer `size_bytes` up to 10 MiB; the storage bucket itself is private, has the same 10 MiB limit, and allows PNG, JPEG, WebP, PDF, and plain-text objects. If signed-URL creation fails, the just-created attachment row is deleted. Completion currently marks the metadata row uploaded without separately proving that the object exists, so the storage provider remains the final upload enforcement point.

## Platform review surface

Platform administrators see current threads across all products, including each revision and its attachments, rather than only the selected product's manager view. They can filter by `product_key`, assign `open`, `in_progress`, `done`, or `closed` to the latest revision, soft-delete the whole thread, and request a download URL only for an `uploaded` attachment. Download links normally force a download using the original file name; a caller may set `download: false` for a non-download response. The URL expires after 600 seconds.

This review surface is part of platform administration, alongside the broader admin SDK/control app surfaces for products, origins, authentication configuration, product users, and roles. It does not grant managers platform-wide review authority.

## Global Trello configuration and work-item lifecycle

The only current PM provider is `trello`. Platform administrators maintain one global configuration (`singleton_key = global`) containing a board and one required list for each route: To do, In progress, Blocked, and Done. `enabled` defaults to false. Administrators can test connectivity, retrieve a saved board snapshot, refresh a snapshot from Trello, and replace the configured label mappings for that board. A snapshot preserves board identity, closed flag, ordered lists, labels, and members; it is cached data, not a second source of work-item truth.

A platform admin can create a work item for any live request thread only when the global integration is configured and enabled. The operation:

1. loads every non-deleted revision and every `uploaded` attachment in the thread;
2. creates a Trello card in the configured To-do list, containing the current revision, all revision summaries, product metadata, optional admin URL, selected configured labels, and attachment summary;
3. attempts to mirror each uploaded attachment and records per-attachment `uploaded` or `failed` outcomes (the persisted link contract also supports `pending` and `skipped`, but the current Trello provider does not emit either);
4. saves one local link per provider/product/thread, its card/list/status, mapped request status, labels, last-sync time, and aggregate attachment state.

The aggregate attachment states are `not_started` when there were no attachment results, `complete` when every attempted mirror succeeded, `partial` when at least one succeeded and at least one failed, and `failed` when all attempted mirrors failed. Attachment-mirroring failures are returned as warnings and do not undo the newly created Trello card.

Creating a card for an already linked thread is idempotent by default: the existing link, attachment links, and labels are returned. With `force_new`, ClassKit creates a new card, deletes the old local link, then records the new link. Detaching a work item likewise deletes only the local link and its dependent local attachment/label links; it never deletes the Trello card. This makes detachment and forced replacement externally consequential—an old card can remain active in Trello—but avoids destructive provider-side deletion.

## Trello status synchronization

Trello list location maps to the provider status and then, where defined, to the latest ClassKit request status:

| Trello route | Provider status | Request status after sync |
| --- | --- | --- |
| To do | `todo` | `open` |
| In progress | `in_progress` | `in_progress` |
| Blocked | `blocked` | `in_progress` |
| Done | `done` | `done` |
| Any other/no list | `unknown` | unchanged |

Syncing one link, or all links optionally filtered to a product, reads the Trello card, updates the local card/list/status and label-link records, and updates only the latest non-deleted request revision when the mapping differs. There is intentionally no Trello mapping to `closed`; a locally closed request stays closed when the card is in an unknown list, but a subsequent mapped Trello list can replace it with `open`, `in_progress`, or `done`. If Trello reports a linked card as missing, ClassKit detaches the local link rather than deleting or recreating a card. Other sync failures are reported per link in the bulk-sync summary.

## Evidence and known gaps

Current behavior is grounded in `class-kit-api/supabase/functions/class-kit-product-change-requests/index.ts`, `class-kit-api/supabase/functions/class-kit-admin-product-change-requests/index.ts`, `class-kit-api/supabase/functions/class-kit-admin-pm-integrations/index.ts`, `_shared/pm/types.ts`, `_shared/pm/providers/trello_provider.ts`, and migrations `20260707144646_product_change_requests.sql`, `20260708110703_pm_software_integrations.sql`, `20260708131835_pm_trello_labels.sql`, and `20260709072033_pm_board_snapshots.sql`.

There are no focused SQL or Edge Function regression tests for the request revision/soft-delete contract, attachment completion and signed-URL flow, Trello configuration, force-new/detach semantics, or status synchronization in this snapshot. In particular, the completion endpoint's lack of object-existence verification and provider-side behavior during partial attachment mirroring are implementation-derived rather than regression-proven.
