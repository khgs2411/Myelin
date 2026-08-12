# Myelin Project Memory

Myelin is a local-first project memory system for software repositories, implemented as a Bun/TypeScript CLI plus project-owned markdown, state, source evidence, run artifacts, and SQLite serving state.

Use this draft wiki as a subject map for authoring durable Project Memory documentation. Each linked page is currently a planner placeholder: a subject writer should replace it with detailed, repo-grounded markdown after inspecting the suggested repository areas.

## Documentation Subjects

- [Product Model And Memory Layers](product-model-and-memory-layers.md) - explain the product thesis, memory scopes, source-of-truth boundaries, and current vision.
- [Operator CLI And Workflows](operator-cli-and-workflows.md) - document the active Myelin command surface, side effects, and operator workflows.
- [Runtime Foundation And Providers](runtime-foundation-and-providers.md) - document config loading, runtime helpers, process execution, provider invocation, and file-authoring runner direction.
- [Project Shell, Layout, And Capture](project-shell-layout-and-capture.md) - document project discovery, bootstrap shell creation, layout repair/migration, Codex capture, and Experience Log writes.
- [Experience Log, Ingest, And Session Memory](experience-log-ingest-session-memory.md) - document how raw captured activity becomes Session Memory, candidates, handoffs, tombstones, and embeddings.
- [Project Memory Create And Maintenance](project-memory-create-maintenance.md) - document `project learn`, agent-authored create mode, maintenance mode, candidate handling, apply/promotion, and retrieval refresh.
- [Storage, SQLite, And Retrieval Indexes](storage-sqlite-retrieval-indexes.md) - document root SQLite state, migrations, sqlite-vec, embeddings, Session Memory retrieval, and derived Project Memory retrieval.
- [Schema Layer And Documentation Rules](schema-layer-documentation-rules.md) - document global schema inputs, generated schema context, validation, candidate deferrals, and wiki writing rules.
- [Query And MCP Boundary](query-and-mcp-boundary.md) - document the CLI query facade, future MCP contract, detached boundary, query response envelope, and degradation behavior.
- [Roadmap, Decisions, And Verification](roadmap-decisions-verification.md) - document current roadmap state, ADR decision map, design archive usage, tests, and verification commands.

## Writer Guidance

Write living project documentation, not generic code summaries. Prefer durable behavior, workflows, boundaries, gotchas, and evidence paths that would save a future agent from rediscovering the repository. Ground concrete claims in repository files, tests, docs, or ADRs, and preserve uncertainty where the implementation and product direction differ.
