# Platform product operations

ClassKit has a destructive platform-admin product reset, named `truncate`, rather than a permanent product-deletion API. It clears product-local operating data while retaining the product's configuration and a recoverable manager baseline.

## Product truncation contract

`admin.products.truncate({ productKey })` calls `class-kit-admin-products` with `action: "truncate_product"`. The request requires a nonblank exact `product_key`; the Edge Function resolves that key to a product ID and invokes the service-only `class_kit_private.truncate_product` RPC. There is no `delete_product` action in the current admin-products action union.

The action first requires a valid bearer token and then a platform role at numeric level 100. This is a platform-level gate: product-manager membership or a product permission alone does not authorize it. The RPC takes a transaction advisory lock for the target product, verifies both the product and invoking user, and restores the invoking platform admin's product baseline before clearing the product data.

| Scope | Outcome of a successful truncation |
| --- | --- |
| Cleared | Product-scoped class participants, registrations, schedule skips, classes, schedules, membership ledger entries, membership grants and types, templates, access entries, non-invoking product users, and all product-role assignments except the invoking admin's manager assignment. |
| Preserved | The product row, allowed origins, auth redirects, product roles, and product-role permission bundles. |
| Restored baseline | The invoking admin is an active `class_kit.users` manager and has exactly one active `product_user_roles` assignment: the built-in `manager` role. |
| Outside the target product | Unrelated products are not altered. |

The class-kit-admin UI presents this as **Product reset**. It enables confirmation only when the typed confirmation exactly equals the selected product's key, then sends that same key. This is a client safety control; authorization and target resolution remain server-side.

## Gate precedence and operational effect

1. The Edge Function handles CORS preflight, then parses the request body.
2. A bearer token must identify a user; that user must satisfy platform level 100.
3. The exact key resolves to one product. The service-only RPC then locks that product and verifies the product and admin identity.
4. The RPC establishes the admin manager baseline, then removes target-product operating rows and non-baseline assignments.
5. Product identity/configuration and unrelated products remain available after the reset.

This ordering means an unauthorized caller cannot use a known product key to perform a reset, and a platform admin is not merely retained as an ordinary user: the operation explicitly normalizes that caller to the sole active manager role assignment for the product.

## Evidence and known gaps

The current contract is implemented in `class-kit-api/supabase/functions/class-kit-admin-products/index.ts`, `class-kit-api/supabase/functions/_shared/admin_api.ts`, and `class-kit-api/supabase/migrations/20260702120000_truncate_product_admin_action.sql`; the SDK exposes the operation in `class-kit-sdk/src/client/class-kit-client.ts`, and the admin confirmation control is `apps/class-kit-admin/src/components/product-reset-panel.tsx`.

`class-kit-api/supabase/tests/truncate_product_admin_action.sql` regression-tests removal of the listed product-local rows, preservation of product/origin/redirect/role configuration, restoration of the admin baseline, and isolation from an unrelated product. It does not execute the Edge Function's bearer-token, platform-level authorization, exact-key input-validation, or UI confirmation branches end-to-end; those layers should not be treated as regression-covered by the SQL test alone.
