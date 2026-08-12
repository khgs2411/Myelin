# Schema And Configuration

Placeholder for the subject writer.

Document the schema and configuration layer. Cover global authored schema, typed JSON rules, Zod validation, generated per-project schema context, freshness/input hashes, schema CLI behavior, `myelin.config` and `.env` precedence, model and embedding environment variables, SQLite dylib overrides, and compatibility contracts that retain `LLM_WIKI_*` naming.

Suggested repo paths to inspect:

- `schema/global.md`
- `schema/schema-context.md`
- `schema/rules/page-taxonomy.json`
- `schema/rules/memory-scopes.json`
- `schema/rules/source-classification.json`
- `src/schema/compiler.ts`
- `src/schema/schema-service.ts`
- `src/schema/validators.ts`
- `src/schema/types.ts`
- `src/commands/schema.ts`
- `src/runtime/config.ts`
- `myelin.config`
- `docs/adr/0049-phase-0-ships-thin-global-only-schema.md`
- `docs/adr/0050-adopt-myelin-product-name.md`
- `tests/schema/`
