# Product truncation

ClassKit supports a destructive platform-admin reset of one product's operational data; it is not permanent product deletion.

## Command boundary and gate precedence

The supported facade is `client.admin.products.truncate({ productKey })`. It sends the `truncate_product` action and an exact, nonblank `product_key` to `class-kit-admin-products` (`class-kit-sdk/src/client/class-kit-client.ts`, `class-kit-sdk/src/admin/admin-api.ts`, `class-kit-api/supabase/functions/class-kit-admin-products/index.ts`). The action has no additional mode or confirmation field.

The current gate order is:

1. The Edge Function authenticates the bearer token and requires a platform role at level 100. Product membership, product role, permission key, access-entry state, approval, and membership eligibility cannot satisfy this platform gate.
2. It requires a nonblank `product_key`, then resolves it. An absent/blank key is `400 bad_request`; an unknown key is `404 not_found`.
3. It invokes the service-role `class_kit.truncate_product` RPC with the resolved product ID and the authenticated platform admin's user ID. The private implementation takes a product advisory transaction lock, verifies both the product and the invoking auth user, and restores the built-in roles before reset work.

`admin.products.truncate` returns `{ product_key, truncated: true }` after a successful reset. It is a control-plane action and must not be used by a product website as an ordinary product flow.

## Reset and preservation contract

For the selected product only, truncation deletes:

- class participants, registrations, schedule skips, concrete classes, schedules, and templates;
- membership ledger entries, grants, and types;
- product access entries;
- all non-invoking product users; and
- every product-role assignment except the invoking administrator's active `manager` assignment.

It deliberately preserves the product row, allowed origins, auth redirects, product roles, and role-permission bundles. It also leaves global `auth.users` untouched and does not affect another product's rows. Before deletions, the RPC ensures that the invoking platform administrator is an active product user with the built-in `manager` role; afterward that user has exactly one active product-role assignment, the manager baseline.

The regression fixture verifies deletion of each listed product-scoped resource, preservation of the product/origin/redirect/custom role/custom role permission/admin baseline, and preservation of an unrelated product's class (`class-kit-api/supabase/tests/truncate_product_admin_action.sql`).

## Destructive-action confirmation

The backend validates the exact product key as its target selector, but does not receive or validate a separately typed confirmation. A consuming platform-admin UI must require the operator to type the exact target product key before enabling this call, clearly state the reset and preservation effects above, and prevent a product-scoped manager surface from exposing it. This is a UI safety requirement documented in the backend and SDK usage documentation; the available regression evidence exercises the database reset, not a browser confirmation flow (`docs/api/backend-api.md`, `docs/sdk/client-sdk.md`).

## Known gaps

- The available automated regression invokes the private RPC directly. It does not verify the Edge Function's level-100 request guard, SDK request mapping, error mapping, or an admin UI's exact-key confirmation interaction.
- The reset test covers the listed core product data. It does not establish handling for every newer product-scoped table, so additions require an explicit truncation-policy review and regression update.
