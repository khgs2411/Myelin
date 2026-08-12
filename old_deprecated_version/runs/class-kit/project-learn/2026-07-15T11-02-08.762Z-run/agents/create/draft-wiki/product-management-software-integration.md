# Product-management software integration

ClassKit has a platform-admin-only, globally configured product-management integration whose current and only provider is Trello; it creates and synchronizes Trello cards for product change-request threads.

## Boundary and configuration

`class-kit-api/supabase/functions/class-kit-admin-pm-integrations/index.ts` is the admin Edge Function boundary. Every supported action calls `requirePlatformAdminRequest` before dispatch, so configuration, snapshots, card creation, detachment, and synchronization are not product-manager or ordinary-user operations.

The provider abstraction in `class-kit-api/supabase/functions/_shared/pm/types.ts` defines create, attachment-upload, status-fetch, board-snapshot, and connection-test capabilities. `class-kit-api/supabase/functions/_shared/pm/factory.ts` currently instantiates only `TrelloProductManagementProvider`; the provider and database checks accept only `trello`. Trello credentials are server environment variables `TRELLO_API_KEY` and `TRELLO_TOKEN`; a missing value returns an internal-error response before provider use.

`admin_pm_integration_settings` is a singleton (`singleton_key = 'global'`), not a per-product connection. A saved configuration requires non-blank board and all four list IDs:

| Route | Meaning | Initial-card / sync effect |
| --- | --- | --- |
| `todo_list_id` | To do | New cards are created here; mapped to ClassKit `open`. |
| `in_progress_list_id` | In progress | Maps to `in_progress`. |
| `blocked_list_id` | Blocked | Maps to `in_progress`. |
| `done_list_id` | Done | Maps to `done`. |

The `enabled` flag gates card creation and linked-card synchronization. `test_connection` still requires a saved configuration, but uses the provider test directly; it verifies that the board can be read and reports each configured route as `found` or `missing`. Board-snapshot refresh can instead use an explicit `board_id` and constructs a provider with disabled routing, so snapshot retrieval is not gated by `enabled`.

## Admin operations

The SDK exposes the same boundary as `client.admin.pmIntegrations` in `class-kit-sdk/src/client/class-kit-client.ts`:

| Action | Result |
| --- | --- |
| `get_config` | Reads the global configuration and mappings for its configured board. |
| `update_config` | Upserts the singleton configuration and replaces that board's label mappings. Empty mappings are allowed; duplicate provider-label IDs are de-duplicated. |
| `test_connection` | Reads the configured Trello board and validates all four configured list IDs. |
| `get_board_snapshot` | Returns the last persisted snapshot for an explicit or configured board, or `null`. |
| `sync_board_snapshot` | Fetches Trello board metadata and upserts the snapshot. |
| `create_work_item` | Creates or returns a linked Trello card for a change-request thread. |
| `detach_work_item` | Deletes only the ClassKit link; it does not delete the Trello card. |
| `sync_work_item` | Refreshes one link from Trello, updates its status and mapped labels, and may update the latest request. |
| `sync_linked_work_items` | Refreshes all Trello links, optionally restricted by `product_key`; returns per-link outcomes and totals. |

## Board snapshots and labels

`admin_pm_integration_board_snapshots` stores one JSON snapshot per `(provider, board_id)`, with `synced_at`; `class-kit-api/supabase/migrations/20260709072033_pm_board_snapshots.sql` requires the value to be a JSON object. A fresh Trello snapshot contains board ID, name, URL, and closed state; lists (ID, name, closed, position) sorted by position; labels (ID, name, color) sorted by name; and members (ID, username, full name, initials, avatar URL) sorted by full name. Snapshot data is cached state, not a live read from `get_board_snapshot`.

Configured label mappings live in `admin_pm_integration_label_mappings` and are scoped to the selected board. Card creation accepts mapping IDs only; IDs that are unknown, from another board, or otherwise not configured fail with `bad_request`. The provider sends the associated Trello label IDs on creation. Link labels in `product_change_request_pm_link_labels` preserve only labels that match the current configured mapping; unconfigured labels present on a Trello card are not surfaced as ClassKit link labels.

## Work-item creation, links, and attachments

Creation loads the requested change request's complete non-deleted product/thread revision history, treats the highest version as the latest revision, and includes uploaded attachments from every revision. The Trello card name is `[product_key] Issue|Feature request: title`; without a title it uses the first eight description words. Its description includes request/thread IDs, product, type, current ClassKit status, version, optional admin URL, description, JSON context, revision list, and attachment inventory.

There is one persisted link per `(provider, product_id, request_thread_id)` and one link per provider card. If a link already exists, ordinary creation returns the existing link, associated attachment links, and labels without creating a card. `force_new` creates a new card, then deletes the existing ClassKit link (and its cascading attachment/label rows) before saving the replacement. This does not delete the old Trello card.

`product_change_request_pm_links` records the provider board/card/list and card URL, observed provider status, mapped ClassKit status, last-sync time, and aggregate attachment state. Per-attachment rows preserve provider attachment ID/URL, `uploaded`, `failed`, or `skipped` result, and error text. The provider reads each source object from Supabase Storage and uploads it individually after the card is created. A failed attachment does not roll back card creation: creation returns an `attachment_upload_failed` warning and aggregate state is `complete` when all upload, `partial` when some upload, `failed` when none upload, or `not_started` when there were no uploaded source attachments.

## Synchronization and status contract

Synchronization reads the Trello card's current list, labels, and `dateLastActivity`. It updates the link's list/status/mapped status and `last_synced_at` to the ClassKit sync time, then replaces mapped link labels. If Trello returns 404, ClassKit detaches the link locally and reports it as detached; it does not recreate or delete a Trello resource. Batch synchronization continues after individual failures and reports `total`, `synced`, `detached`, and `failed` counts.

| Trello card condition | Provider status | Mapped ClassKit change-request status | Sync outcome |
| --- | --- | --- | --- |
| In configured To do list | `todo` | `open` | Updates the latest non-deleted revision only when its status differs. |
| In configured In progress list | `in_progress` | `in_progress` | Updates the latest non-deleted revision only when it differs. |
| In configured Blocked list | `blocked` | `in_progress` | Updates the latest non-deleted revision only when it differs. |
| In configured Done list | `done` | `done` | Updates the latest non-deleted revision only when it differs. |
| Card has no list or is in any unconfigured list | `unknown` | `null` | Updates link observation but does not change the ClassKit request. |
| Card is absent (Trello 404) | n/a | n/a | Deletes the ClassKit link and reports `detached`. |

The integration never maps a Trello list to ClassKit `closed`; ordinary status synchronization also does not create a new revision, it mutates the current latest revision's status. Creation persists `open` only for an initial `todo` card; other initial provider statuses are stored with a null mapped status, though cards are normally created into the configured To do list.

## Provider responses and warnings

The Trello REST client converts rate limit responses to a 429 `bad_request`, missing resources to 404 `not_found`, and other non-success responses to a 502-style internal error. In the current provider implementation, the only emitted warning code is `attachment_upload_failed`. The shared SDK/types also reserve `attachment_skipped`, `provider_rate_limited`, and `provider_partial_response`, but no current code emits them. An incomplete board response (missing ID, name, or URL) is rejected; incomplete individual list, label, or member records are omitted or defaulted as implemented by the snapshot normalizer.

## Persistence and access controls

The integration migration `class-kit-api/supabase/migrations/20260708110703_pm_software_integrations.sql` enables RLS on settings, link, and attachment-link tables and grants CRUD to `service_role`; the label and snapshot migrations do the same for their tables. The Edge Function uses `serviceClient`, while request authorization is enforced before it is used. No end-user RLS policy is defined in these migrations.

## Known gaps

- No PM/Trello-focused Supabase or SDK regression tests were found in the snapshot, so the documented runtime behavior is grounded in current Edge Function, provider, SDK, and migration code rather than exercised test coverage.
- There is no webhook, polling scheduler, retry queue, or automatic synchronization mechanism in the inspected integration code; synchronization occurs only through the exposed admin actions.
- The current provider boundary has one implementation and one allowed enum value (`trello`); multi-provider behavior is not implemented or verifiable.
- The integration code does not validate that configured list IDs are mutually distinct, nor does `update_config` force a connection test before enabling; invalid routes are surfaced by `test_connection` or produce `unknown` status during sync.
