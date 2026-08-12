# Query, Status, and Agent Interfaces

Query, status, and agent interfaces are Myelin's read-side contracts for serving project memory to operators, CLI users, and future detached MCP consumers.

## Current Interface Shape

Myelin exposes the implemented read facades through the Bun/TypeScript CLI, with Makefile aliases treated as convenience wrappers. The active command vocabulary is `myelin status [project-key]` and `myelin memory query <project-key> "<question>"`; older `ask` language maps to `memory query` and should not be reintroduced as primary product vocabulary. `README.md`, `docs/CLI.md`, and `AGENTS.md` all describe the CLI as the authoritative local contract, with detached MCP consumers expected to wrap the CLI/JSON behavior rather than import root source.

The JSON envelope shared by query-like responses is intentionally facade-shaped:

- `answer`
- `confidence`
- `memory_scope`
- `citations`
- `candidate_ids`
- `degraded`
- `degraded_reason`
- `source_tools`

`src/query/memory-query-service.ts` extends that envelope for `memory query` with `matches`, `project_memory_matches`, and optional `layers` diagnostics when `--debug` is passed. `src/status/status-service.ts` returns the same top-level status envelope for `myelin status --json`, but it is backed by project-state files rather than vector retrieval.

## Memory Query Facade

`src/commands/memory.ts` registers `memory query` and delegates to `src/query/engine.ts`. The implemented flags are:

- `--limit N` for match count, default `5`.
- `--branch current|<name>` for Session Memory branch filtering.
- `--layer session|project|auto`; current service behavior treats missing or `auto` like Session Memory and uses Project Memory only for `--layer project`.
- `--max-inline-chars N` for Project Memory markdown hydration, default `4000`.
- `--json` for the structured envelope.
- `--debug` for route/layer diagnostics.

The default query path is Session Memory retrieval. `src/query/engine.ts` loads `myelin.config`, selects the active `retrieval_document` embedding contract, creates an embedding provider, resolves `--branch current` through the registered target repo, opens the root memory database, and calls `MemoryQueryService`. The query path may create or update cached query embeddings; it does not synthesize final answers with an LLM.

`src/memory/session-memory-query.ts` is the Session Memory query service. It requires an available sqlite-vec vector table, indexed active Session Memory embeddings, and an embedding for the normalized question. It searches vectors, hydrates rows from `session_memories`, filters out non-active rows by default, filters by branch context when requested, and returns source tools `query-embedding-cache` and `session-memory-vector-index`. Tests in `tests/memory/session-memory-query.test.ts` verify explicit degradation when sqlite-vec is unavailable, cache reuse for normalized questions, active-only lifecycle filtering, and branch-context filtering.

`src/query/project-memory-query-service.ts` is the Project Memory retrieval service used by `--layer project`. It searches derived Project Memory retrieval vectors, then resolves hits back to canonical markdown sections under `projects/<key>/wiki/`. It returns inline section content only when the current markdown section hash matches the indexed row and the section body is under the inline-size threshold. If the section is too large, stale, or missing, the result is a canonical reference with `reference_reason` rather than stale inline content. Tests in `tests/query/project-memory-query-service.test.ts` cover markdown hydration, section ids, size-threshold fallback, stale-hash fallback, and missing-markdown fallback.

The Project Memory query CLI contract is still being stabilized. `docs/ROADMAP.md` Step 8 says the current slice should search derived SQLite/vector state, resolve hits back to canonical markdown, and return inline content or refs without synthesizing answers. It also marks formal stabilization, size/degradation rules, and product-query fixtures as open work. Future agents should treat the code and tests as the current behavior, and the roadmap as the warning that the product contract is not final.

## Degradation And Citation Rules

The query services fail closed instead of silently falling back to weak answers. Session Memory degrades when sqlite-vec is unavailable, no active rows are indexed, rows are pending, or the embedding provider fails on a cache miss. Project Memory degrades when sqlite-vec is unavailable, no Project Memory retrieval rows are indexed, pending rows need indexing, markdown is missing, or hashes prove that derived rows are stale. `src/query/engine.ts` also wraps top-level configuration or database failures into a degraded response.

Citation formats are layer-specific:

- Session Memory citations are `session_memory:<memory-id>`.
- Project Memory citations are `project_memory:<wiki_path>#<section_id>`.
- Status citations name the project state files used: `projects/<key>/state/project.json`, `freshness.json`, and `update-state.json`.

`confidence` is deterministic. Session Memory and Project Memory query confidence is derived from the top match distance, bounded by degradation state. Empty or degraded results return `0`. The answer text is a deterministic rendering of matches or degradation reason, not a generated synthesis.

## Status Facade

`myelin status [project-key] [--json]` is read-only and implemented in `src/commands/status.ts` plus `src/status/status-service.ts`. With a project key, it loads that project. Without one, it resolves from the current working directory through registered repo paths and falls back to the first discovered project.

The status summary includes:

- project key, display name, and project directory from `projects/<key>/state/project.json`;
- latest session pointer from `projects/<key>/wiki/sessions/*.md` by file mtime;
- stale status, changed paths, impacted pages, and update time from `projects/<key>/state/freshness.json`;
- latest run and completed stage from `update-state.json`, falling back to `bootstrap-state.json` or the newest run directory.

Human output is a compact project summary. JSON output is a facade response with `memory_scope: "project"`, `confidence: 1`, `source_tools: ["project-state"]`, and `degraded: false` when summary construction succeeds. `tests/status/status-service.test.ts` verifies that the service builds both a structured summary and facade response from project state.

This status surface is a good skeleton for the future `status` facade, but it is not yet the full current-state briefing described in product design. `docs/IMPLEMENTATION_ALIGNMENT.md` explicitly calls it useful but incomplete because latest-session lookup still uses `wiki/sessions/*.md` mtime rather than a broader continuity/current-state model.

## Agent And MCP Boundary

The product design in `MYELIN.md` defines three agent-facing semantic facades:

- `query` for explanatory knowledge answers;
- `how` for operating guidance;
- `status` for structured current state and inventory.

ADR 0005 records that choice. ADR 0011 keeps MCP detached from the core repo. ADR 0048 says query logic lives once in `src/query/`, while detached MCP consumes stable command/JSON contracts such as `myelin memory query --json`. ADR 0050 keeps `LLM_WIKI_*` environment variables and the `mcp__llm-wiki__*` namespace as compatibility contracts even though the product and CLI are named Myelin.

The important boundary is one-way: core owns product behavior; MCP is a wrapper after CLI behavior is stable. `README.md` and `AGENTS.md` warn not to import root `src/` from a local MCP checkout and not to import MCP source into the core runtime. `docs/ROADMAP.md` Step 10 keeps MCP wrapper work open until Project Memory query behavior is proven through CLI/script contracts.

## Known Gaps And Cautions

- `memory query` is not yet a complete multi-layer semantic router. In current code, `auto` does not combine Session Memory and Project Memory; it follows the Session Memory path.
- `how` is a designed facade, not an implemented core CLI surface in this snapshot.
- Project Memory query behavior exists in services and CLI flags, but its formal product contract is still open in `docs/ROADMAP.md` Step 8.
- ADR 0037 says `memory query` should fail closed without valid schema context, but the active `src/query/engine.ts` and `src/commands/memory.ts` path read in this snapshot does not perform an explicit schema-context check; schema-aware code remains in `src/query/planner.ts`, an older query-planning path.
- `docs/IMPLEMENTATION_ALIGNMENT.md` contains older descriptions of query as mostly project-wiki/page-metadata routing. Prefer current code, tests, README, CLI docs, and roadmap for present behavior.
- MCP compatibility names remain intentionally old (`LLM_WIKI_*`, `mcp__llm-wiki__*`) even though docs and commands should use Myelin vocabulary.
