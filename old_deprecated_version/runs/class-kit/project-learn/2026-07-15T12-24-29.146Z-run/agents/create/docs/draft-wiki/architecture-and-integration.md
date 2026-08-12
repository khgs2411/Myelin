# Architecture and integration boundary

ClassKit separates website presentation, the typed React SDK/client facade, and the Supabase backend. Product websites own UI; the SDK owns client behavior and hides Edge Function actions; the backend owns logic, validation, RLS, product access, and permissions.

The supported browser path is `frontend app -> @class-kit/react -> class-kit-* Edge Functions -> class_kit schema`. Websites must not directly query ClassKit tables or RPCs. The packaged UI-component-library direction is deprecated.

Evidence: `target-repo/README.md`, `target-repo/docs/product-shape.md`, `target-repo/docs/shared/context.md`. Runtime implementation and regression-test coverage are absent from this snapshot.

