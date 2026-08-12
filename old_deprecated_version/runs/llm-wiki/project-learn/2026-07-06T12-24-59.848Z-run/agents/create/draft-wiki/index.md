# llm-wiki Project Memory

This draft wiki documents Myelin, the local-first project memory system implemented in this repository.

Use the pages below as the initial Project Memory documentation set. Each subject page is currently a placeholder for a subject writer.

## Documentation Subjects

- [Product Memory Model](product-memory-model.md) - explain the Myelin product shape, memory layers, canonical terminology, and non-goals.
- [Operator CLI Workflows](operator-cli-workflows.md) - document the commands operators and agents use for status, bootstrap, schema, project learn, ingest, query, inbox, indexing, reset, and inspection.
- [Runtime And Project Layout](runtime-and-project-layout.md) - document the Bun/TypeScript runtime foundation, repository layout, project shell layout, run artifacts, and file-authoring boundaries.
- [Capture Session Ingest And Maintenance](capture-session-ingest-and-maintenance.md) - document capture hooks, Experience Log persistence, detached ingest jobs, Session Memory, auto-maintenance, candidates, handoffs, and lifecycle links.
- [Project Memory Authoring Lifecycle](project-memory-authoring-lifecycle.md) - document first-create and maintenance mode, planner/subject writer agents, draft wiki promotion, source consumption, candidate dispositions, and canonical markdown ownership.
- [Storage Retrieval And Query](storage-retrieval-and-query.md) - document SQLite state, Session Memory embeddings, Project Memory retrieval rows, query behavior, degradation, and markdown resolution.
- [Schema Config And Provider Boundary](schema-config-and-provider-boundary.md) - document schema context, typed schema rules, config/env precedence, LLM provider selection, embeddings, and vendored SQLite.
- [Decisions Roadmap And Verification](decisions-roadmap-and-verification.md) - document active docs, ADR authority, roadmap state, design history, tests, and current implementation gaps.

## Reading Priority

Start with `README.md`, `MYELIN.md`, `CONTEXT.md`, `docs/CLI.md`, `docs/IMPLEMENTATION_ALIGNMENT.md`, and `docs/ROADMAP.md`. Use `docs/adr/` and `docs/design/` to explain why newer implementation boundaries supersede older project-memory contracts.

## Known Initial Gaps

- Subject pages still need full documentation; they are placeholders created by the planning pass.
- Archive material under `docs/archive/` is historical unless canonical docs explicitly cite it.
- Some implementation surfaces are in active transition: Project Memory creation has moved from structured JSON curation toward agent-authored markdown, while older validator/quality code still exists in the tree.
