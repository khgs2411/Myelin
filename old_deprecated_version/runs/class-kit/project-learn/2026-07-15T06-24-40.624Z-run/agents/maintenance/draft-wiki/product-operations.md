# Product Operations

ClassKit provides product-scoped operational capabilities for managers and public product sites beyond the class lifecycle: membership entitlements, signup routing, versioned product documents, and product change-request intake.

## Boundary and access model

Product websites should use the typed SDK facades rather than call raw Edge Function actions or access ClassKit tables directly. Manager capabilities live under `client.management.*` and require resolved product context plus the relevant backend permission; public reads remain constrained to the browser-resolved product. The backend is the authorization authority, so product capability flags are navigation hints rather than permission proof. See `docs/sdk/client-sdk.md#management-apis`, `docs/api/backend-api.md#management-apis`, and `docs/api/class-api-map.md#capability-map`.

This subject deliberately excludes platform-wide request handling and Trello integration. Product managers submit and revise internal requests through `management.changeRequests.*`; platform admins review requests across products, update their status, and may promote them into Trello through the separate `admin.*` surface. `docs/changelog.md#admin-trello-pm-integration` explicitly says product websites and manager dashboards should not know about Trello.

## Membership operations

`client.management.memberships.*` manages membership types, grants, active entitlement state, stock corrections, revocation, and ledger history. Membership modes are `stock`, `limited_stock`, `limited`, and `infinite`; types provide defaults while a grant may override dates or total stock. The backend validates product user, active type, stock, and validity rules (`docs/sdk/client-sdk.md#memberships`; `docs/api/class-api-map.md#capability-map`).

For a manager form that means “make this user have this membership,” use `setForUser(...)`. It creates a grant when none is active, updates a same-type active grant in place, or marks a different active grant `replaced` and creates the requested one. It also records a `membership_set` ledger event. `upgrade(...)` is intentionally narrower: it only permits rank-based moves to a higher membership mode, not arbitrary overrides (`docs/api/backend-api.md#management-apis`).

`adjustStock(...)` is a balance correction for active stock-based grants. It accepts a non-zero delta, changes only `remainingStock`, and records a `manager_adjustment` ledger event; it does not change the entitlement's `totalStock`, dates, or type. A correction can therefore leave a visible balance such as `9 / 8`, which is expected rather than a data inconsistency.

Customer-facing membership visibility belongs to `client.profile.get()`, which returns the caller's own grants. `management.memberships.listUserGrants(userId)` is a manager/dashboard read, not a substitute for customer profile UI (`docs/changelog.md#product-profile`).

## Signup links

Managers with `class_signup_links.manage` can create durable links through `client.management.signupLinks.create(...)`. A link targets either one class (`targetType: "class"`) or a product-controlled discovery filter object (`targetType: "filter"`). Public sites resolve a slug with `client.signupLinks.resolve(slug)` and route it to the class detail or filtered discovery experience.

Resolution is anonymous-safe but is still product-scoped through normal origin resolution or the localhost product-key hint. This avoids hard-coded table access and prevents a slug from becoming a cross-product lookup mechanism. See `docs/sdk/client-sdk.md#signup-links` and `docs/api/backend-api.md#management-apis`.

## Product documents and acceptance

Product documents support terms, policies, waivers, and agreements. Public `productDocuments.list(...)` returns published summaries only, while `productDocuments.get(documentType, { locale, fallbackLocale })` returns the latest published document for that type and locale, including markdown content. Successful public reads are cached by the SDK for five minutes in memory and `localStorage` (`docs/sdk/client-sdk.md#product-documents`).

Accepting a document requires an authenticated active product user. `productDocuments.accept(...)` snapshots the accepted document id, locale, version, title, markdown content, and optional flow context (for example `signup` or `checkout`) into `class_kit.product_document_acceptances`. Subsequent edits cannot rewrite historical acceptances.

Managers with `product_documents.manage` create documents through `management.productDocuments.upsert(...)`, which always inserts an immutable version. Publishing archives the previously published version for the same product/type/locale; archiving targets one specific version. The backend retains only the latest five non-published versions for each product/type/locale, and management writes clear the SDK's public-document cache (`docs/api/backend-api.md#management-apis`; `docs/changelog.md#product-documents`).

## Product change requests

Managers with `product_change_requests.manage` use `management.changeRequests.*` to create, list, revise, soft-delete, and attach files to product-scoped `issue` or `feature_request` records. Optional `context` is an app-owned JSON object such as a route, label, path, or URL; ClassKit persists it but does not impose an application route model.

Edits are append-only: each revision remains in the same `thread_id`, increments `version_number`, and points to `previous_request_id`. Listing returns the latest visible revision per thread plus its revision history. Deleting soft-deletes the complete thread from manager and admin list surfaces while retaining the audit trail.

Attachments use the private `product-change-request-attachments` Storage bucket. The SDK follows a two-step backend-signed flow—create attachment/upload URL, upload to Storage, then complete the upload—rather than sending file contents in JSON or granting broad bucket access. Platform admins can list across products, update status (`open`, `in_progress`, `done`, or `closed`), soft-delete, and create short-lived attachment download or preview URLs through `admin.changeRequests.*` (`docs/api/backend-api.md#management-apis`; `docs/api/class-api-map.md#capability-map`).

## Operational integration guidance

- Build manager dashboards with `management.memberships`, `management.signupLinks`, `management.productDocuments`, and `management.changeRequests`; render only the controls appropriate to the resolved product context, but let backend errors enforce access.
- Build customer experiences with `profile.get()` for their own grants, public signup-link resolution, and published-document reads. Document acceptance is the authenticated transition.
- Treat documents and change requests as durable audit surfaces: document acceptance is a content snapshot, document publishing creates immutable versions, and request edits create immutable revisions.
- Keep external PM tooling in the platform-admin control plane. The product request system is deliberately useful without a Trello-specific dependency (`docs/changelog.md#v018`).
