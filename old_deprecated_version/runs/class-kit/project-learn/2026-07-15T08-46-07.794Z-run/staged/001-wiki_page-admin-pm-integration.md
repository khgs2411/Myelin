# Admin PM integration

ClassKit has a platform-admin-only, Trello-only integration for promoting a product change-request thread to a Trello card while retaining ClassKit as the canonical request store.

## Boundary and access

`class-kit-admin-pm-integrations` authenticates the bearer token and requires platform permission level 100 before dispatching any action (`class-kit-api/supabase/functions/class-kit-admin-pm-integrations/index.ts`, `class-kit-api/supabase/functions/_shared/admin_api.ts`). Product managers do not use this API: they continue to create and manage product-scoped change requests through the separate product-management boundary. PM links and cards are admin metadata around a ClassKit request thread; a product site must not depend on them.

Only `trello` is a supported provider. The provider is constrained to `trello` in the PM tables and in the shared PM type (`class-kit-api/supabase/migrations/20260708110703_pm_software_integrations.sql`, `class-kit-api/supabase/functions/_shared/pm/types.ts`). Server-side `TRELLO_API_KEY` and `TRELLO_TOKEN` are required at provider construction; neither is part of the admin configuration or browser state (`class-kit-api/supabase/functions/_shared/pm/factory.ts`). Missing credentials produce an internal error.

## Global Trello configuration and setup

There is exactly one global configuration row: `admin_pm_integration_settings.singleton_key` is fixed to `global` and unique. It requires nonblank `board_id`, `todo_list_id`, `in_progress_list_id`, `blocked_list_id`, and `done_list_id`; `enabled` defaults to `false`. `update_config` upserts that one row and replaces all configured label mappings for its board. Duplicate submitted provider-label IDs are deduplicated, but blank IDs or display names are rejected (`class-kit-api/supabase/functions/class-kit-admin-pm-integrations/index.ts`).

The setup actions are:

| Action | Outcome |
| --- | --- |
| `get_config` | Returns the global config (or `null`) and its board's configured label mappings. |
| `test_connection` | Verifies that the Trello board is reachable and each of the four configured list IDs is present; the result reports `found` or `missing` per route. |
| `sync_board_snapshot` | Fetches a board's metadata, lists, labels, and members from Trello and upserts the cached snapshot. It can use an explicitly supplied board ID even if no config is enabled. |
| `get_board_snapshot` | Reads the cache for an explicit board ID, or the configured board when omitted. |

Snapshots are setup-helper data, not routing authority. `admin_pm_integration_board_snapshots` is keyed by provider and board ID, while the global config remains the source of truth for route list IDs (`class-kit-api/supabase/migrations/20260709072033_pm_board_snapshots.sql`). Configured labels are likewise global to the configured board; an attempted work-item creation rejects selected IDs that are not configured for that board. When a card is synchronized, only its labels still present in the configuration are retained as ClassKit link labels; unmapped Trello labels are ignored.

## Work-item link lifecycle

`create_work_item` requires a non-deleted ClassKit request ID, loads its complete product/thread revision history in version order, and uses the latest revision for the resulting link. It also includes only attachments whose ClassKit attachment status is `uploaded`. The integration must be configured and enabled before it can create a card.

| Condition | Creation outcome |
| --- | --- |
| No existing Trello link for the product/thread | Creates a card in `todo_list_id`, mirrors eligible attachments, stores a link, attachment-link rows, and mapped label rows. |
| Existing link and `force_new` absent/false | Returns the existing local link and its attachment/label rows; it does not create another card. |
| Existing link and `force_new: true` | Creates a new Trello card, then deletes and replaces only the local association. The old Trello card is not deleted. |
| Integration missing or disabled | Rejects the action. |
| Request missing, deleted, or its current thread has no active revisions | Rejects the action. |

The database enforces at most one link per `(provider, product_id, request_thread_id)` and one local link per provider card ID. A link stores the latest request ID at creation, card/board/list IDs and URL, provider status, mapped ClassKit status, attachment summary state, and last-sync time (`class-kit-api/supabase/migrations/20260708110703_pm_software_integrations.sql`). A link is not a second source of truth for the request: status writes always target the latest active revision in the thread.

`detach_work_item` deletes only the ClassKit link. Foreign-key cascades remove its attachment and label link rows, but the function makes no Trello deletion or mutation. During either one-link or batch synchronization, a Trello 404 has the same local-detach result; other sync errors are surfaced (and batch sync records that item as failed while continuing the rest).

## Trello list and ClassKit status synchronization

Cards are always created in the configured To Do list, regardless of request type. A platform-admin sync fetches the card's current list and applies this mapping to the latest active ClassKit request revision only if a mapping exists:

| Trello list condition | Stored provider status | Stored mapped request status | ClassKit request effect |
| --- | --- | --- | --- |
| `todo_list_id` | `todo` | `open` | Updates status to `open` when different. |
| `in_progress_list_id` | `in_progress` | `in_progress` | Updates status to `in_progress` when different. |
| `blocked_list_id` | `blocked` | `in_progress` | Updates status to `in_progress` when different; `blocked` remains visible on the PM link. |
| `done_list_id` | `done` | `done` | Updates status to `done` when different. |
| Any other list, or no list | `unknown` | `null` | Updates link metadata but does not mutate the ClassKit request. |

`sync_work_item` handles one link. `sync_linked_work_items` processes all Trello links, optionally narrowed by `product_key`, and returns totals for synced, detached, and failed items. The request status is only changed after the provider status has been fetched and a mapped status exists; it is not pushed to Trello from ClassKit.

## Attachment synchronization

For each eligible attachment, the Trello provider downloads the object from its ClassKit storage bucket, uploads it as a multipart Trello card attachment, and records one local attachment-link row. A per-attachment result has these current states:

| Attachment result | Meaning |
| --- | --- |
| `uploaded` | Trello accepted the upload; provider attachment ID and URL may be recorded. |
| `failed` | Storage download or Trello upload failed; the error message is recorded and a warning with `attachment_upload_failed` is returned. |
| `skipped` | Reserved by the shared PM type but not emitted by the current Trello upload implementation. |
| `pending` | Database-only initial value allowed by the attachment-link schema; creation writes provider results rather than creating pending rows. |

The parent link summarizes creation-time results as follows: no eligible attachments produces `not_started`; all results without failures produces `complete`; both uploaded and failed results produces `partial`; and only failures produces `failed`. The latter two store a summary error. Existing attachments are not retried by `sync_work_item` or `sync_linked_work_items`; those actions refresh card list/labels only. This leaves attachment retry behavior outside the currently verified PM actions.

## Known gaps

- The snapshot contains no PM-integration-focused automated tests under the available test directories. The configuration validation, Trello HTTP error handling, force-new replacement, list-to-request-status mapping, missing-card detach, label filtering, and attachment-summary behavior are grounded in current implementation and schema, but lack direct regression coverage in this evidence set.
- The attachment-link schema permits `pending` and the shared type permits `skipped`, but the current creation path only persists returned Trello results and the Trello provider only emits `uploaded` or `failed`. No current action verifies a transition from `pending` or `skipped`.
- Attachment upload is attempted only at card creation. The available implementation does not expose a retry or reconciliation action for failed/partial attachment mirroring.
