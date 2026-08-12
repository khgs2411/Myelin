# Platform Administration and PM Integration

Platform administration is ClassKit's control plane for cross-product setup, repair, and external PM coordination; it is deliberately separate from the product-scoped workflows a product manager runs.

## Control-plane versus product-manager boundary

ClassKit has distinct authority scopes:

- A platform admin operates ClassKit itself. They can provision products, manage origins and provider policy, assign platform admins and product managers, administer cross-product change requests, and use external PM integration.
- A product manager operates one product through `management.*` methods: classes, schedules, users where permitted, product documents, and that product's internal change requests.
- A product user has customer-facing workflows only.

Platform authority is not product membership. `class_kit.users` records membership in a particular product; a platform admin does not receive a product-user row or customer-facing product capabilities unless explicitly assigned to that product. Backend level guards may accept platform authority for deliberately level-gated product administration, but a product-scoped permission key still requires an explicit product-role grant. See `docs/product-shape.md` and `docs/api/backend-api.md`.

The SDK makes the separation visible: `management.*` uses the browser-resolved current product, while `admin.*` is a platform/control-plane surface and takes an explicit `productKey` when it targets a product. Product websites should use the typed SDK facade rather than raw Edge Functions; they must not use admin methods as ordinary product flows (`docs/sdk/client-sdk.md`, `docs/api/class-api-map.md`).

## Platform administration

`admin.products.*` owns product provisioning and platform policy: list/create products, update auth policy, manage allowed origins and OAuth redirects, and truncate a product. Provider toggles (`email_password_enabled`, `google_oauth_enabled`) are platform-admin-only; a level-75 product manager may update the product access mode (`open` or `invite_only`) through `management.product.updateAuthMode(...)` but not provider availability.

`admin.users.*` provisions or assigns product users, handles invitations and access decisions, and adds or removes platform admins. `admin.productRoles.*` administers product roles, permissions, and role assignments from the control plane. The corresponding Edge Functions remain the authorization authority (`docs/api/backend-api.md`).

Product truncation is an exceptional level-100 platform-admin operation. `admin.products.truncate({ productKey })` removes the product-scoped operational state—classes, schedules, templates, registrations, attendance, memberships, access entries, and non-admin product-user assignments—while preserving the product definition, origins, redirects, roles, permissions, and the invoking admin's active manager baseline. A consuming admin UI must require the exact product key before enabling it; this is not a product-manager reset action (`docs/sdk/client-sdk.md#admin-apis`, `docs/api/backend-api.md#admin-apis`).

Platform admins also handle change requests across products through `admin.changeRequests.*`: list, update status, soft-delete request threads, and create short-lived attachment download or preview URLs. Product managers create, revise, list, soft-delete, and upload attachments for their own requests through `management.changeRequests.*`. Requests are internal ClassKit records with `issue` or `feature_request` type and `open`, `in_progress`, `done`, or `closed` status; revisions are append-only within a request thread (`docs/sdk/client-sdk.md#product-change-requests`).

## Admin-only Trello integration

The released v0.1.18 integration begins with one global Trello board. `admin.pmIntegrations.*` is platform-admin-only and promotes an existing ClassKit change-request thread into a Trello card; managers and product websites neither call it nor need Trello knowledge. ClassKit remains the canonical request system. A PM link and external card are admin-operations metadata, and Trello can change internal request status only when an admin sync action runs (`docs/sdk/client-sdk.md#admin-pm-integration`, `docs/changelog.md`).

The global configuration stores whether the integration is enabled and its board/list routes: `todo`, `in_progress`, `blocked`, and `done`. `class_kit.admin_pm_integration_settings` is the source of truth. Cached board snapshots (`class_kit.admin_pm_integration_board_snapshots`) contain board metadata, lists, labels, and members only to help an admin choose known Trello values. Configured friendly label mappings are global board configuration in `class_kit.admin_pm_integration_label_mappings`.

Trello credentials never enter browser state or admin configuration. Edge Functions read `TRELLO_API_KEY` and `TRELLO_TOKEN` from server-side Supabase secrets or environment. The SDK supports configuration and connection checks, board snapshot reads/sync, work-item creation, local detachment, and individual or bulk link sync:

```ts
client.admin.pmIntegrations.getConfig()
client.admin.pmIntegrations.updateConfig(input)
client.admin.pmIntegrations.testConnection()
client.admin.pmIntegrations.getBoardSnapshot(options?)
client.admin.pmIntegrations.syncBoardSnapshot(options?)
client.admin.pmIntegrations.createWorkItem({ requestId, labelMappingIds?, forceNew? })
client.admin.pmIntegrations.detachWorkItem({ pmLinkId })
client.admin.pmIntegrations.syncWorkItem({ pmLinkId })
client.admin.pmIntegrations.syncLinkedWorkItems(options?)
```

Creating a work item puts the card in the configured to-do list, can apply selected configured labels, mirrors request attachments, and stores one local link per provider/product/request thread. A repeated create returns the current link unless `forceNew` creates a replacement local link and a new card; the older Trello card is not deleted or changed. Detaching likewise deletes only the local ClassKit association and mirror rows, never the Trello card. A missing Trello card during sync automatically detaches the local link so an admin may link the request again.

| Trello route | Stored provider status | Internal request effect |
| --- | --- | --- |
| To-do | `todo` | `open` |
| In progress | `in_progress` | `in_progress` |
| Blocked | `blocked` | `in_progress` |
| Done | `done` | `done` |
| Any other list | `unknown` | No status change |

The PM link preserves `blocked` and `unknown` even though the internal request status vocabulary has no matching values. Admin UIs may poll linked cards while the requests tab is open; the current admin application polls every 30 seconds. Product-specific board overrides, webhooks, OAuth/per-admin Trello authorization, and automatic card creation for manager requests are out of scope for this released slice (`docs/api/backend-api.md#admin-pm-integration`).

## Historical design note

`docs/design/2026-07-08-pm-software-integration/pseudocode/README.md` and `AgreedImplementationShape.md` are explicitly draft, non-executable planning artifacts. They correctly preserve the intended authority boundary, global-first configuration, server-side credentials, attachment mirroring, and no manager-side Trello exposure. They are not the current contract where they diverge: the draft says Trello labels are out of scope, while the living v0.1.18 SDK, backend API, class API map, and changelog document configured global label mappings and selected label application. Use the living references for implementation behavior.
