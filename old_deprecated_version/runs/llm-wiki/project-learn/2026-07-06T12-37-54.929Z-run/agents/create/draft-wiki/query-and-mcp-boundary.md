# Query And MCP Boundary

Placeholder for the subject writer.

Document how agents are meant to retrieve Myelin knowledge. Cover the current `memory query` implementation, query planning, Session Memory vector query, Project Memory query service and markdown hydration, response envelope, degraded states, schema gating, branch filters, future `query/how/status` MCP facades, explicit project selection, compatibility names (`LLM_WIKI_*`, `mcp__llm-wiki__*`), and the detached MCP boundary where core owns query behavior and MCP consumes CLI/JSON contracts.

Suggested repo paths to inspect: `src/query/`, `src/commands/memory.ts`, `src/status/status-service.ts`, `src/commands/status.ts`, `src/memory/session-memory-query.ts`, `src/memory/project-memory-retrieval-text.ts`, `src/memory/project-memory-retrieval-storage.ts`, `docs/CLI.md`, `MYELIN.md`, `CONTEXT.md`, `docs/adr/0005-use-query-how-status-mcp-facades.md`, `docs/adr/0007-mcp-project-selection-is-explicit.md`, `docs/adr/0011-keep-mcp-detached-as-agent-interface.md`, `docs/adr/0048-core-owns-query-mcp-consumes-via-contract.md`, `tests/query/`, `tests/status/`.
