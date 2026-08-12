# llm-wiki Project Memory

llm-wiki is the Myelin repository: a local-first project memory system for software repositories, implemented as a Bun/TypeScript CLI with curated markdown Project Memory, SQLite serving state, Experience Log ingestion, retrieval indexes, and provider-backed curation workflows.

## Documentation Subjects

- [Product And Memory Model](product-and-memory-model.md) - product purpose, memory layers, vocabulary, and non-goals.
- [Command Workflows](command-workflows.md) - operator-facing `myelin` and Makefile workflows.
- [Project Memory Lifecycle](project-memory-lifecycle.md) - `project learn`, create/maintenance mode, documentation agents, markdown apply, source consumption, and retrieval lifecycle.
- [Session Memory And Experience Ingest](session-memory-and-experience-ingest.md) - capture hooks, Experience Log rows, detached ingest workers, Session Memory records, candidates, handoffs, and auto-maintenance.
- [Storage, Retrieval, And Query](storage-retrieval-and-query.md) - repo-root SQLite, Project Memory markdown, Session Memory storage, embedding indexes, and `memory query`.
- [Schema, Config, And Runtime](schema-config-and-runtime.md) - schema context generation, configuration precedence, provider/model selection, and runtime primitives.
- [External Boundaries And Integrations](external-boundaries-and-integrations.md) - detached MCP boundary, capture providers, install/bootstrap flows, compatibility names, and root package constraints.
- [Roadmap, Decisions, And Documentation Sources](roadmap-decisions-and-docs.md) - canonical docs, ADRs, roadmap state, and historical archive boundaries.
- [Verification And Quality Gates](verification-and-quality-gates.md) - tests, typecheck, rendered Project Memory quality checks, fail-closed behavior, and validation contracts.

## Known Draft Gaps

These pages are placeholders for subject writers. They should be filled from `target-repo/` evidence and should preserve concrete repo path references where they explain behavior future agents need to answer.
