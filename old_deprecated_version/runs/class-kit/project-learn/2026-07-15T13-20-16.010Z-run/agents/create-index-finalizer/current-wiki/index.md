# ClassKit

ClassKit is a Supabase-backed, multi-product class and membership platform whose browser contract is the `@class-kit/react` SDK and whose server contract is the `class-kit-*` Edge Function family.

## Current orientation

Product websites use the SDK rather than tables, RPCs, or raw Edge Functions. The API resolves a product from the browser origin and optional same-origin site URL, then applies authentication, product-access, membership, permission, and lifecycle rules in the backend. The `class_kit` and `class_kit_private` schemas, migrations, and Edge Functions are the implementation authority; the `apps/` projects are control and dogfood consumers rather than the product boundary.

The sanitized checkout evidence records an available `master` checkout at `/Users/liadgoren/Repositories/class-kit` with an `origin` remote. This contradicts `docs/repositories/structure.md`, which says the parent documentation repository has no remote. The evidence is current deterministic checkout evidence; the repository document remains a recorded contradiction rather than a basis for a no-remote claim. See [repository identity](../state/repository-identity.json).

## Canonical pages

- [Architecture and repository boundaries](architecture-and-boundaries.md) — runtime ownership, repository topology, and product isolation.
- [SDK and product-facing API](sdk-and-product-api.md) — browser integration, typed facade, context, and response contract.
- [Product resolution, authentication, and access](product-access-and-authentication.md) — origin resolution, provider policy, access entries, and membership activation.
- [Authorization and roles](authorization-and-roles.md) — platform/product scope, level and key guards, roles, and capabilities.
- [Classes and registrations](classes-and-registrations.md) — discovery, eligibility, approval, capacity, cancellation, and class state.
- [Templates, schedules, and attendance](templates-schedules-and-attendance.md) — source configuration, generation, skips, and attendance lifecycle.
- [Memberships and entitlements](memberships-and-entitlements.md) — membership modes, grant status, stock, and ledger effects.
- [Product documents and signup links](product-documents-and-signup-links.md) — public content, acceptance snapshots, version lifecycle, and discovery links.
- [Product administration and reset](product-administration-and-reset.md) — platform administration, product setup, and destructive product truncation.
- [Change requests and project-management integration](change-requests-and-pm-integration.md) — request revisions, attachments, lifecycle state, Trello linking, and sync.
- [Operator workflows and local apps](operator-workflows-and-local-apps.md) — local stack, validation, deployment, and the admin/demo consumers.

## Evidence and coverage boundaries

Current implementation and SQL regression tests establish the registration membership/approval outcomes, pending-registration cancellation exception, schedule-generation backfill, and product-truncate isolation. The remaining authorization, access, document, change-request, and PM contracts are implementation-grounded but lack focused regression coverage in this snapshot; their exact missing coverage is recorded in the planner report.
