# Use mode-scoped Project Learn curator contracts

`project learn` is an authoritative command whose permissions depend on trusted Project Memory state. When no trusted curated Project Memory exists, `project learn` runs in Project Memory Creation Mode and emits a Project Memory Creation Draft for the first brain; after trusted Project Memory exists, it runs in Project Memory Maintenance Mode and emits bounded Project Memory Maintenance Proposals validated before writes. This keeps first-brain creation powerful while keeping self-maintenance constrained.

`project learn` also supersedes separate Project Memory source/inbox ingest in the target V2 model. The product should not preserve `project ingest` or `src/pipeline/runner.ts` as old command boundaries; any useful runner behavior may be extracted as mechanical runtime helpers, while Project Memory semantics move under the Project Memory Curator service.
