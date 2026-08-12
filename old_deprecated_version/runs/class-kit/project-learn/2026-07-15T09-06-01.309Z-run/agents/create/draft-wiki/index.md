# ClassKit project memory

ClassKit is a Supabase-backed class and membership platform whose product boundary is an SDK calling ClassKit Edge Functions and the `class_kit` schema.

## Repository identity

The sanitized checkout evidence identifies this snapshot as `class-kit`, on `master`, at commit `4f55d94506f181d179f705173ecd54606b44c90c`, with registered origin `https://github.com/khgs2411/class-kit.git`. This is current checkout evidence, not an inference from repository prose.

## Documentation subjects

- [Architecture and public boundary](architecture-and-public-boundary.md)
- [Product resolution, authentication, and access](product-access-and-authentication.md)
- [Authorization, roles, and permissions](authorization-roles-and-permissions.md)
- [Class, template, and schedule lifecycle](class-template-and-schedule-lifecycle.md)
- [Registration, approval, and membership entitlement](registration-approval-and-membership.md)
- [Attendance lifecycle](attendance-lifecycle.md)
- [Administrative control plane](administrative-control-plane.md)
- [SDK and Edge Function API surface](sdk-and-edge-function-api-surface.md)
- [Product management software integration](product-management-software-integration.md)

## Evidence and confidence

These are planning placeholders, not completed knowledge pages. Subject pages must ground behavior in the API functions and SQL migrations listed in the subject manifest; historical design material may supply context but cannot establish current behavior alone. Four SQL regression scripts exist for member auto-approval, pending cancellation, schedule backfill, and product truncation. Coverage gaps are recorded in `reports/documentation-planner-report.json`.
