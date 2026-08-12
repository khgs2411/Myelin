# Product documents

Product documents provide product-scoped terms, policies, waivers, agreements, and similar markdown content. Public reads return published document summaries or the latest published version for a type and locale, with locale fallback. Acceptance requires an active product user and snapshots document identity, type, locale, version, title, markdown, and optional context.

Document lifecycle values recorded in the SDK are `published` and `archived`. Management `upsert` always creates an immutable new version; publishing archives the prior published version for the same product/type/locale. Archive targets one version. Older non-published versions beyond the latest five are pruned. Reads are public/anonymous-safe only for published content, while management writes require `product_documents.manage`; writes clear the SDK document cache.

Precedence is product resolution first, then publication/type/locale selection for public reads; active product membership before acceptance; management permission before version mutation. Later edits do not rewrite prior acceptance snapshots.

Evidence: `target-repo/docs/sdk/client-sdk.md`, `target-repo/docs/api/class-api-map.md`, `target-repo/docs/changelog.md`. Missing: implementation and tests for locale fallback, publishing/archive atomicity, cache invalidation, pruning, and acceptance immutability.

