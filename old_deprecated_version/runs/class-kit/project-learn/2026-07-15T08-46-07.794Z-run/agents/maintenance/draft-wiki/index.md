# ClassKit Project Memory

ClassKit is a Supabase-backed, multi-product class and membership platform whose supported browser boundary is product site → `@class-kit/react` → Edge Function → `class_kit` schema.

## Repository identity and documentation boundary

The sanitized checkout evidence identifies this project as `class-kit`, on `master` at `4f55d94506f181d179f705173ecd54606b44c90c`, with `origin` at `https://github.com/khgs2411/class-kit.git`. The repository documentation says the parent folder is local-only and should have no remote; that statement conflicts with the deterministic checkout evidence and is retained as a documented contradiction in [Repository identity and boundaries](repository-identity-and-boundaries.md).

## Subject map

- [Repository identity and boundaries](repository-identity-and-boundaries.md) — checkout facts, repository split, and the remote-origin contradiction.
- [Product access and authorization](product-access-and-authorization.md) — origin resolution, auth policy, access state, roles, and guard precedence.
- [Product truncation](product-truncation.md) — platform-admin destructive reset, preserved configuration, and confirmation boundary.
- [Class discovery, registration, and lifecycle](class-discovery-registration-and-lifecycle.md) — visibility, eligibility, approval policy, cancellation, capacity, and class/registration transitions.
- [Memberships and stock](memberships-and-stock.md) — membership modes, active-grant eligibility, stock, validity, grant transitions, and ledger behavior.
- [Templates and schedules](templates-and-schedules.md) — template defaults, schedule modes, generation provenance, and scheduling transitions.
- [Attendance lifecycle](attendance-lifecycle.md) — attendance participants, lifecycle commands, and allowed state transitions.
- [Product documents and change requests](product-documents-and-change-requests.md) — version/status contracts, attachments, revision history, and platform handling.
- [Admin PM integration](admin-pm-integration.md) — Trello-only configuration, work-item links, provider mapping, and attachment sync states.
- [SDK and API facade](sdk-and-api-facade.md) — supported product-facing namespaces and the backend enforcement boundary.

## Evidence posture

The pages are grounded in current migrations, Edge Functions, SDK source, and the available SQL regression tests. The snapshot contains targeted SQL regressions for member auto-approval, pending-registration cancellation, schedule backfill, and destructive product reset; it does not contain broad regression coverage for every documented policy. Those gaps are listed in the planner report rather than implied away.
