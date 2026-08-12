# ClassKit Project Memory

ClassKit is a Supabase-backed, multi-product class and membership platform whose product boundary is a typed React SDK over ClassKit Edge Functions and schemas.

## Documentation map

- [Architecture and repository boundaries](architecture-and-repository-boundaries.md) — ownership of the docs shell, API, SDK, and consuming applications.
- [SDK integration](sdk-integration.md) — the supported browser-facing integration contract.
- [Backend API and data contracts](backend-api-and-data-contracts.md) — Edge Function request, response, schema, and migration responsibilities.
- [Identity, product access, and authorization](identity-product-access-and-authorization.md) — shared Supabase identity and ClassKit authorization semantics.
- [Class operations and lifecycle](class-operations-and-lifecycle.md) — discovery, registration, management, attendance, templates, and schedules.
- [Product operations](product-operations.md) — memberships, product documents, signup links, and product change requests.
- [Platform administration and PM integration](platform-administration-and-pm-integration.md) — platform control surfaces and the admin-only Trello boundary.
- [Deployment and releases](deployment-and-releases.md) — shared Supabase deployment and private SDK release/consumption rules.
- [Product integration roadmap](product-integration-roadmap.md) — reusable implementation sequence for consuming product websites.
- [Design history and unresolved proposals](design-history-and-unresolved-proposals.md) — historical design context that must not override current canonical contracts without verification.

## Reading order

Start with architecture and authorization before changing a contract. Use SDK integration for website work, backend API for server work, and the capability/lifecycle subjects for feature-specific behavior. Treat the design archive as supporting context: several archived artifacts are drafts or plans and conflict with newer living references.
