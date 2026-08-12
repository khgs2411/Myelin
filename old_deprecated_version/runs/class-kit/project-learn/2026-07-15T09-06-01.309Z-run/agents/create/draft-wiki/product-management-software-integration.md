# Product management software integration

ClassKit documents a platform-admin-only boundary for promoting canonical product change-request threads into product-management work items; Trello is the only documented provider in this snapshot.

## Evidence status

The checkout identity reports `class-kit` on `master` at `4f55d94506f181d179f705173ecd54606b44c90c` (`repository-identity.json`). This sanitized target checkout does **not** include the assigned implementation evidence under `class-kit-api/supabase/functions/_shared/pm`, `class-kit-api/supabase/functions/class-kit-admin-pm-integrations`, or either assigned PM migration. It also contains no PM integration regression tests. Consequently, the behavior below is a documented API contract from `docs/api/backend-api.md`, `docs/sdk/client-sdk.md`, and `docs/api/class-api-map.md`, not implementation-verified behavior.

## Boundary and authority

The documented entry point is `class-kit-admin-pm-integrations`, exposed through `client.admin.pmIntegrations.*`. It is platform-admin-only. Managers continue to create and manage ClassKit change requests through `management.changeRequests.*`; product websites and manager dashboards are not meant to call the PM integration or depend on Trello state.

ClassKit remains the canonical request store. A PM link and its Trello card are admin-operations metadata around a request thread. An external list move changes ClassKit request state only when a platform-admin-triggered sync runs; there is no documented webhook-driven update.

The provider boundary is intended to keep browser code away from provider credentials. The documented first provider is `trello`; `TRELLO_API_KEY` and `TRELLO_TOKEN` are read by Edge Functions from server-side secrets/environment and are not returned in browser configuration.

## Global configuration and board setup

The documented global configuration is `class_kit.admin_pm_integration_settings`. It holds one Trello board's `enabled` flag and list routes: `board_id`, `todo_list_id`, `in_progress_list_id`, `blocked_list_id`, and `done_list_id`. Product-specific boards are explicitly out of scope in this slice.

`class_kit.admin_pm_integration_board_snapshots` caches board metadata, lists, labels, and members by provider and board ID. It is setup helper data only: the saved settings row is the documented source of truth for board and route-list selection. Friendly configured label mappings are global as well (`class_kit.admin_pm_integration_label_mappings`); sync retains configured labels on a link and ignores unmapped Trello labels.

| Action | Documented outcome |
| --- | --- |
| `get_config` | Returns the global mapping or `null`, with configured label mappings. |
| `get_board_snapshot` | Returns the cached snapshot for an explicit board or the configured board. |
| `update_config` | Upserts global board/list routing and replaces that board's configured label mappings. |
| `test_connection` | Verifies server-side credentials, the board, and every configured route-list ID with Trello. |
| `sync_board_snapshot` | Fetches board name, URL, lists, labels, and members and overwrites the cache. |

## Work-item and link lifecycle

`create_work_item` creates a Trello card in the configured `todo_list_id`, optionally applies selected configured labels, mirrors request attachments, and writes a local link. The documented uniqueness boundary is one link per provider, product, and request thread.

- With an existing link and no `force_new`, creation returns that link.
- With `force_new`, it creates a new Trello card and replaces the local link; the prior Trello card is neither deleted nor changed.
- `detach_work_item` removes only the local PM link plus its local attachment/label association rows. It never deletes or mutates the Trello card.
- `sync_work_item` refreshes one linked card; `sync_linked_work_items` refreshes all links, optionally narrowed by `product_key`.
- A Trello not-found response during either sync detaches the local link and returns/records it as detached, so the request can be linked again.

Documented link state includes the provider card ID and URL, current list ID, provider status, mapped ClassKit status, attachment sync state, and last-sync timestamp. The concrete attachment-sync enum and persistence constraints cannot be verified without the missing migration/function source.

## Sync state contract

New cards always start in the configured to-do list; request type does not choose an alternative Trello route. On sync, Trello list position is the sole documented external status signal:

| Configured Trello list condition | Provider status stored on link | ClassKit request-state effect |
| --- | --- | --- |
| matches `todo_list_id` | `todo` | set to `open` |
| matches `in_progress_list_id` | `in_progress` | set to `in_progress` |
| matches `blocked_list_id` | `blocked` | set to `in_progress` |
| matches `done_list_id` | `done` | set to `done` |
| matches no configured route | `unknown` | leave ClassKit request state unchanged |
| Trello card is not found | link is detached | no documented request-state mutation |

Thus `blocked` and `unknown` remain meaningful provider-side states even though the documented ClassKit request vocabulary has no matching `blocked` or `unknown` value. Repeating a sync is described as safe for unchanged list position, but idempotency and transaction behavior require source verification.

## Explicitly deferred behavior

The documentation marks product-specific board overrides, Trello webhooks, OAuth/per-admin authorization, automatic manager-created cards, and manager-side Trello visibility as out of scope. The local admin UI may poll linked items every 30 seconds while its Requests tab is open; this is a UI behavior, not a server-side synchronization guarantee.

## Known gaps

- The assigned provider implementation, admin Edge Function, and migrations are absent from this target snapshot, so provider dispatch, configuration validation, secret handling, database constraints/RLS, and actual authorization checks are unverified.
- No PM integration tests are present. In particular, there is no executable evidence for the full precedence of platform-admin authorization, configuration existence/enabled state, request/thread eligibility, existing-link handling, or sync mutation gates.
- The docs describe a `disabled` configuration flag but do not state the result of each action while disabled, or whether disabled takes precedence over a valid existing link; do not infer that behavior.
- The docs do not establish attachment failure/retry states, partial-mirror semantics, race behavior for `force_new`, or whether an unknown/missing list is persisted before any request-status decision.

## Evidence paths

- `repository-identity.json`
- `docs/api/backend-api.md` (Admin PM Integration)
- `docs/sdk/client-sdk.md` (Admin PM Integration)
- `docs/api/class-api-map.md` (Admin PM integration capability map)
- `docs/changelog.md` (`v0.1.18`)
