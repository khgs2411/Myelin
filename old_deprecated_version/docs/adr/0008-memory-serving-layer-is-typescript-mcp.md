# Superseded: first-slice memory serving in the TypeScript MCP package

This decision was superseded by ADR 0009. The direction is broader than keeping memory serving inside `/mcp`: the whole repo should migrate toward a Bun/TypeScript-first runtime. `/mcp` remains important because it already proves the target runtime, but first-slice work should establish shared repo-level TypeScript infrastructure before adding SQLite memory.
