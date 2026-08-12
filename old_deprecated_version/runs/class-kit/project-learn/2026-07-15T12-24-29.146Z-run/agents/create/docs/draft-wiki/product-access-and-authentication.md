# Product access and authentication

Supabase Auth establishes global identity; ClassKit resolves the product from the request origin and decides product access. Product context loads the matched product and policy, origin-scoped redirects (falling back to environment-scoped redirects only when no origin match exists), optional JWT identity, active product roles, and provider availability.

Documented policy values and outcomes:

| Contract | Values | Outcome |
| --- | --- | --- |
| `auth_mode` | `open`, `invite_only` | `open` can create/confirm membership for eligible authenticated users; `invite_only` does not implicitly create membership and requires active access/membership. |
| password provider | enabled/disabled | Password sign-in is offered only when enabled; signup additionally requires `open`. |
| Google provider | enabled/disabled | Google sign-in is offered only when enabled; OAuth identity creation never bypasses product access. |
| product access status | `invited`, `pending`, `active`, `rejected`, `inactive` | It explains a signed-in identity that is not an active product user. |

Precedence is: configured allowed origin and product resolution first; then provider availability; then access policy; then active product access/membership. A valid Supabase session alone is insufficient. Platform admins do not gain implicit product membership. Redirect URLs must pass both the Supabase global allow list and ClassKit's product-owned redirect configuration.

Evidence: `target-repo/docs/api/backend-api.md`, `target-repo/docs/sdk/client-sdk.md`, `target-repo/docs/shared/authentication.md`, `target-repo/docs/product-shape.md`. Missing: implementation and tests for origin matching, provider gates, access transitions, and their ordering.

