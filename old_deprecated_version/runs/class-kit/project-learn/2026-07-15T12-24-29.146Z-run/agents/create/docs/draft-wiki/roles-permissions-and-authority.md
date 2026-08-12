# Roles, permissions, and operational authority

ClassKit has separate platform and product authority. Built-in documented roles are `platform_admin` (platform, level 100), `manager` (product, level 75), and `user` (product, level 10). Product roles carry explicit permission-key bundles; level and key checks are intentionally different contracts.

A product-scoped level guard accepts a qualifying product role or a qualifying platform role. A product-scoped permission-key guard requires an explicit product-role grant; high platform or product level does not imply that key. Platform-scoped checks require platform authority. Product membership, role activity, then the applicable level/key guard constrain operations; frontend capabilities only guide navigation and never replace backend authorization.

The documented dashboard flags derive from keys: `can_enter` is any of `classes.create`, `product_roles.manage`, `product_user_roles.manage`, or `product.auth_mode.update`; the other flags are narrower key checks. A platform admin without product membership may therefore have no product-user capability flags while passing deliberately platform-backed level guards.

Evidence: `target-repo/docs/product-shape.md`, `target-repo/docs/adr/0001-scoped-product-permission-layer.md`, `target-repo/docs/api/backend-api.md`, `target-repo/docs/sdk/client-sdk.md`. Missing: executable role/permission defaults and regression coverage for guard inheritance and last-manager protection.

