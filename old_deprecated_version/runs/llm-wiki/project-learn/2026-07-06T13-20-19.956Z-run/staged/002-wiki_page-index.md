# llm-wiki Project Memory Draft Index

llm-wiki is the Myelin repository: a local-first project memory system for software repositories, implemented as a Bun/TypeScript CLI with curated markdown Project Memory, SQLite-backed serving state, provider-backed curation workflows, and query/indexing surfaces.

## Documentation Subjects

1. [Product and Memory Model](product-and-memory-model.md) - north star, memory layers, promotion flow, and source-of-truth boundaries.
2. [Command Surface and Operator Workflows](command-surface-and-operator-workflows.md) - `myelin` CLI commands, Makefile aliases, side effects, and operator entry points.
3. [Project Memory Creation and Curation](project-memory-creation-and-curation.md) - `project learn`, create/maintenance contracts, evidence maps, markdown apply, quality gates, and reset flow.
4. [Session Memory and Experience Ingest](session-memory-and-experience-ingest.md) - Experience Log capture, detached ingest jobs, Session Memory records, candidates, handoffs, and auto-maintenance.
5. [Storage, SQLite, and Retrieval Indexes](storage-sqlite-and-retrieval-indexes.md) - root SQLite state, session vectors, Project Memory retrieval rows, sqlite-vec runtime, and rebuild/freshness rules.
6. [Schema and Documentation Contracts](schema-and-documentation-contracts.md) - global schema inputs, generated schema context, typed rules, page taxonomy, and validation gates.
7. [Runtime, Providers, and Project Layout](runtime-providers-and-project-layout.md) - runtime helpers, config precedence, provider abstraction, project shell layout, run artifacts, and detached boundaries.
8. [Query, Status, and Agent Interfaces](query-status-and-agent-interfaces.md) - memory query facade, project-memory query services, status output, MCP compatibility contracts, and degradation behavior.
9. [Source Evidence, Inbox, and Candidate Boundaries](source-evidence-inbox-and-candidate-boundaries.md) - runtime inbox JSON, source classification, candidates as leads, provenance, and source-consumption reconciliation.
10. [Testing and Verification](testing-and-verification.md) - Bun test coverage, typecheck, contract tests, fixture strategy, and high-risk verification areas.
11. [Roadmap, ADRs, and Design History](roadmap-adrs-and-design-history.md) - canonical reading path, current roadmap, append-only ADRs, and archived design material.

## Primary Evidence

- `README.md`, `MYELIN.md`, `CONTEXT.md`, `docs/README.md`, `docs/CLI.md`, `docs/IMPLEMENTATION_ALIGNMENT.md`, and `docs/ROADMAP.md` define the product, command vocabulary, current alignment, and implementation plan.
- `src/cli.ts` and `src/commands/*` define the CLI surface.
- `src/project/*`, `src/memory/*`, `src/ingest/*`, `src/query/*`, `src/schema/*`, and `src/runtime/*` define the implementation boundaries.
- `schema/*`, `docs/adr/*`, `docs/design/*`, and `tests/*` provide contracts, decisions, planned work, and verification evidence.

## Known Draft Gaps

- This pass creates the documentation shape and placeholder pages only; it does not synthesize full subject content.
- The repository has many historical design files under `docs/archive/` and `docs/design/`; final docs should treat active canonical docs and current code as higher authority.
- Some roadmap content is more current than older alignment text; final subject pages should resolve those conflicts explicitly.
