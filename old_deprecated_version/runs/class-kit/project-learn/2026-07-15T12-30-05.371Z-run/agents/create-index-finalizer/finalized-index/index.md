# ClassKit

ClassKit is a multi-product class platform with a typed browser SDK as its website-facing contract and Supabase Edge Functions and the `class_kit` schema as the authority for policy and state. The supported browser path is `frontend website -> @class-kit/react -> class-kit-* Edge Functions -> class_kit schema`; websites own presentation and use the SDK rather than querying ClassKit tables or RPCs directly.

The repository snapshot is `master` at `4f55d94506f181d179f705173ecd54606b44c90c`, with the `origin` remote recorded in [repository identity](../state/repository-identity.json).

## Canonical documentation

- [Architecture and supported API surface](architecture-and-api-surface.md) — layer ownership, the SDK facade, request routing, and backend authority.
- [Product resolution and access](product-resolution-and-access.md) — origin resolution, authentication policy, product-access entries, and membership creation.
- [Authorization and operational capabilities](authorization-and-capabilities.md) — platform and product roles, level and key permissions, active assignments, and dashboard capabilities.
- [Classes, discovery, and lifecycle](classes-discovery-and-lifecycle.md) — concrete-class state, customer discovery, response shaping, registration availability, and management operations.
- [Registrations and eligibility](registrations-and-eligibility.md) — eligibility gates, approval policy, capacity and membership effects, cancellations, and recovery.
- [Membership types, grants, and ledger](memberships-and-ledger.md) — membership modes, type and grant state, validity and stock, replacement, and ledger events.
- [Templates and schedules](templates-and-schedules.md) — reusable defaults, recurrence rules, generation, skips, and generated-class ownership.
- [Attendance](attendance.md) — participant kinds, attendance values, capability gates, and attendance lifecycle commands.
- [Product documents](product-documents.md) — versioned markdown documents, public reads, locale fallback, acceptance snapshots, and publication authority.
- [Product change requests and Trello synchronization](change-requests-and-pm-sync.md) — revision threads, attachments, platform triage, Trello routing, synchronization, and status mapping.
