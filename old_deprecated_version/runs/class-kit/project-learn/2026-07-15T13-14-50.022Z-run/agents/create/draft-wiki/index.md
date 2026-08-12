# ClassKit

ClassKit is a Supabase-backed, multi-product platform for class discovery, registration, memberships, operational class management, and platform administration. Its supported browser boundary is `@class-kit/react` to `class-kit-*` Edge Functions; browser applications do not directly query ClassKit tables or RPCs.

## Current canonical pages

- [Repository topology and ownership](repository-topology.md) — repository split, ownership, and checkout identity.
- [SDK integration and public API](sdk-integration.md) — supported client construction, provider usage, public namespaces, and request boundary.
- [Product access and authentication](product-access.md) — origin resolution, auth policy, membership/access states, providers, and redirect gates.
- [Access gates and state contract](access-gates-and-states.md) — auth modes, provider flags, product-access states, and the precedence of origin, identity, eligibility, membership, and approval gates.
- [Authorization and product roles](authorization.md) — platform versus product authority, permission guards, roles, and capability flags.
- [Classes and registration lifecycle](classes-and-registration.md) — discovery, concrete-class lifecycle, self-registration, approval, and cancellation.
- [Class and attendance state contract](class-and-attendance-states.md) — publication, registration, and attendance transitions and the user-visible outcomes of each supported state.
- [Operational class delivery](operational-class-delivery.md) — management of classes, templates, schedules, attendance, and signup links.
- [Memberships and product-user records](memberships-and-users.md) — membership modes and grants, profiles, metadata, and product-user roles.
- [Entitlement and schedule state contract](entitlement-and-schedule-states.md) — membership modes and grant outcomes, schedule recurrence/status rules, and generation gates.
- [Product documents and change requests](documents-and-change-requests.md) — published documents, acceptance snapshots, request revisions, attachments, and request statuses.
- [Document and request state contract](document-and-request-states.md) — document publication/archival and request/PM synchronization statuses and retention behavior.
- [Platform administration and PM integration](platform-administration.md) — product provisioning, access decisions, control-plane roles, truncation, and Trello synchronization.
- [Deployment and release operations](deployment-and-releases.md) — shared-Supabase boundaries, local and remote workflows, and private SDK delivery.

## Evidence status

This run received a documentation-only repository snapshot. The current living API, SDK, deployment, and product-shape documents define the documented interface map, while implementation files, migrations, and regression tests are unavailable here. Behavior pages therefore require implementation and test verification before being treated as complete operational evidence.

## Repository-identity contradiction

[Repository Structure](../target-repo/docs/repositories/structure.md) says that the parent documentation repository is local-only and has no remote origin. Sanitized deterministic checkout evidence instead records an available `master` checkout with an `origin` remote at `https://github.com/khgs2411/class-kit.git`. Both statements are preserved as conflicting evidence; the checkout evidence is available at [repository identity](../state/repository-identity.json).
