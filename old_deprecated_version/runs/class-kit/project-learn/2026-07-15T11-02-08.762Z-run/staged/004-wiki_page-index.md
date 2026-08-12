# ClassKit Project Memory

ClassKit is a Supabase-backed, multi-product class, membership, and operational-management platform whose supported browser boundary is `frontend -> @class-kit/react -> class-kit-* Edge Functions -> class_kit schema`.

## Repository identity

Sanitized checkout evidence identifies this project as `class-kit`, registered at `/Users/liadgoren/Repositories/class-kit`, on `master`, with `origin` `https://github.com/khgs2411/class-kit.git` (`repository-identity.json`). The mounted `repo:.git` instead reports a Myelin `origin` and a different HEAD. This is a snapshot-metadata contradiction; repository identity is documented from the supplied deterministic evidence, while implementation claims are grounded in the mounted source tree.

## Planned canonical subjects

- [Repository identity and product boundaries](repository-identity-and-boundaries.md)
- [Product resolution, authentication, and access lifecycle](product-resolution-auth-and-access.md)
- [Authorization, roles, and permission evaluation](authorization-roles-and-permissions.md)
- [Class discovery, visibility, and lifecycle](class-discovery-visibility-and-lifecycle.md)
- [Registration and attendance lifecycle](registration-and-attendance-lifecycle.md)
- [Membership entitlements and stock](membership-entitlements-and-stock.md)
- [Templates, schedules, and generated classes](templates-schedules-and-generated-classes.md)
- [SDK facade and application integration](sdk-facade-and-application-integration.md)
- [Platform administration and product configuration](platform-administration-and-product-configuration.md)
- [Documents, signup links, and product change requests](documents-signup-links-and-change-requests.md)
- [Product-management software integration](product-management-software-integration.md)

## Evidence standard

The eventual pages should treat migrations, Edge Functions, and SDK types as the current implementation contract. SQL regression tests corroborate only the behavior they exercise; historical design plans and existing prose may explain intent but do not establish current behavior on their own.
