# Product change requests and Trello links

Product managers create product-scoped change requests of type `issue` or `feature_request`. Recorded request statuses are `open`, `in_progress`, `done`, and `closed`. Updates are append-only revisions in a thread; listing returns the latest visible revision with revision history, and deletion soft-deletes the thread while retaining its audit trail. Attachments are uploaded through backend-created signed URLs to private storage.

The Trello integration is platform-admin only. Its documented status mapping is `todo -> open`, `in_progress -> in_progress`, `blocked -> in_progress`, and `done -> done`; an unknown Trello list preserves external link status but does not mutate the ClassKit request. A missing Trello card detaches the local link, allowing re-linking. Detach never deletes the external card.

Precedence is management permission for product request operations, then platform-admin authority for Trello configuration and promotion. Local link state changes never authorize or modify arbitrary external Trello content outside the documented commands.

Evidence: `target-repo/docs/sdk/client-sdk.md`, `target-repo/docs/api/class-api-map.md`, `target-repo/docs/changelog.md`. Missing: source and tests for revision visibility, soft deletion, attachment lifecycle, Trello failure handling, and synchronization idempotency.

