# Rebuild schema context after schema apply

`schema apply <candidate-id>` rebuilds generated schema context immediately after applying authored schema changes. If rebuild or validation fails, the apply operation must fail or roll back so authored schema and compiled `schema-context.json` do not drift. This keeps schema candidate application atomic from the agent contract perspective.
