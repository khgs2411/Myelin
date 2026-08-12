# Myelin Project Memory

Myelin is a local-first project memory system for software repositories, implemented as a Bun/TypeScript CLI that keeps curated markdown Project Memory separate from generated SQLite serving state.

## How To Use This Wiki

Start with the product model, then follow the command and data-flow pages for implementation work. These pages are placeholders for subject writers; each page names the boundary it should document and the repo areas to inspect.

## Documentation Subjects

- [Product And Memory Model](product-and-memory-model.md) - product purpose, memory layers, truth hierarchy, and non-goals.
- [Command Workflows](command-workflows.md) - operator CLI, Make aliases, command side effects, and vocabulary.
- [Project Memory Lifecycle](project-memory-lifecycle.md) - `project learn`, create/maintenance modes, draft wiki promotion, source consumption, and candidate handling.
- [Session Memory And Ingest](session-memory-and-ingest.md) - Experience Log capture, detached ingest workers, Session Memory rows, candidates, handoffs, and auto-maintenance.
- [Storage And Retrieval](storage-and-retrieval.md) - project layout, root SQLite, schema context, markdown sections, retrieval indexes, embeddings, and query behavior.
- [Runtime And Provider Boundary](runtime-and-provider-boundary.md) - Bun runtime helpers, repo safety, provider abstraction, file-authoring agents, and sandbox expectations.
- [Schema And Configuration](schema-and-configuration.md) - global schema inputs, typed rules, generated schema context, config/env precedence, and compatibility contracts.
- [Testing Roadmap And Current Gaps](testing-roadmap-and-current-gaps.md) - tests, verification habits, active roadmap state, known product gaps, and dogfood evidence.

## Planner Notes

The subject split follows the repo's current shape rather than a fixed page taxonomy. The key evidence is in `README.md`, `MYELIN.md`, `CONTEXT.md`, `docs/README.md`, `docs/CLI.md`, `docs/IMPLEMENTATION_ALIGNMENT.md`, `docs/ROADMAP.md`, `docs/design/2026-07-06-project-memory-agent-authored-documentation/spec.md`, and the `src/` modules under `commands`, `project`, `memory`, `ingest`, `query`, `runtime`, `schema`, and `capture`.
