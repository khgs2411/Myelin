# Store schema candidates in generated state JSON

Schema candidates are stored as generated project state JSON during the TypeScript migration slice, for example `projects/<key>/state/schema-candidates.json`. SQLite is intentionally deferred to the memory layer, so schema candidate workflows must not depend on SQLite yet. This lets schema commands work before the structured memory database exists.
