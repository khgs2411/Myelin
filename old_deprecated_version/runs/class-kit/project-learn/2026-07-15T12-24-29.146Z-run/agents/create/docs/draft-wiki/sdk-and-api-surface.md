# SDK and API surface

The SDK is the supported app boundary. `classes`, `profile`, `productDocuments`, and `signupLinks` serve customer/public flows; `management.*` serves product-scoped operational flows; `admin.*` serves platform/control-plane flows. Apps should not expose Edge Function action strings, direct tables, or RPCs.

The backend map documents a corresponding `class-kit-*` Edge Function family for product context, signup, classes, registrations, templates, schedules, attendance, memberships, roles, users, documents, change requests, and admin operations. Product-facing Edge Function calls use `{ data, error }` responses with `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, or `internal_error`; management and admin facade calls throw on API errors.

Evidence: `target-repo/docs/api/backend-api.md`, `target-repo/docs/api/class-api-map.md`, `target-repo/docs/sdk/client-sdk.md`. Missing: generated API types, source implementations, and SDK/backend contract tests for facade mapping and error normalization.

