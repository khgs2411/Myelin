# MCP Contract Alignment

## Outcome

The detached MCP server exposes semantic facades while preserving the core/MCP boundary.

## Why it matters

MCP is the agent interface, but core owns product logic.

## Scope

- MCP calls core CLI/JSON contracts.
- No root `src/` imports from `/mcp`.
- No `/mcp` source imports from root core.
- Legacy tools remain supporting tools.

## Done means

- MCP facade behavior matches core command contracts.
- Project selection remains explicit.

## Notes

- Related: ADR 0011 and ADR 0048.
