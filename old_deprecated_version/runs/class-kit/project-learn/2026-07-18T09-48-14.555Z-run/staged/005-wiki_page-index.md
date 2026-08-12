# ClassKit

ClassKit is a multi-product class and membership platform built on a shared Supabase environment. Product browser applications use the `@class-kit/react` SDK, while the `class-kit-*` Edge Function family resolves product context and enforces access, authorization, and lifecycle rules.

The deterministic checkout record identifies the current repository as the available `master` checkout with an `origin` remote; see [repository identity](../../state/class-kit/repository-identity.json).

## Canonical documentation

- [Architecture and repository boundaries](architecture-and-boundaries.md) — repository roles, browser/API boundaries, Supabase ownership, and product isolation.
- [SDK and product-facing API](sdk-and-product-api.md) — the typed browser client, React context, customer and management namespaces, and response contract.
- [Product resolution, authentication, and access](product-access-and-authentication.md) — origin resolution, authentication policy, access entries, and product-membership activation.
- [Authorization and roles](authorization-and-roles.md) — platform and product roles, permission and level guards, capability derivation, and manager authority.
- [Classes and registrations](classes-and-registrations.md) — class visibility and lifecycle, registration gates, approvals, capacity, and cancellation.
- [Templates, schedules, and attendance](templates-schedules-and-attendance.md) — template defaults, recurring schedule generation, skips, and attendance outcomes.
- [Memberships and entitlements](memberships-and-entitlements.md) — membership types and grants, stock, eligibility, and ledger effects.
- [Product documents and signup links](product-documents-and-signup-links.md) — document publication and acceptance, versioning, and public signup-link resolution.
- [Product administration and reset](product-administration-and-reset.md) — platform product configuration, users and roles, authentication settings, and product reset.
- [Change requests and project-management integration](change-requests-and-pm-integration.md) — request revisions, private attachments, platform review, and Trello work-item synchronization.
- [Operator workflows and local apps](operator-workflows-and-local-apps.md) — local API and SDK workflows, deployment and release operations, and the admin and Demo2 consumers.
