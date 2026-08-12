# Core owns query; detached MCP consumes it via contract

Query logic lives once, in the core runtime (`src/query/`). The detached MCP server does not duplicate query logic and does not import core source; it consumes query through the documented contract — the core CLI (`myelin memory query --json`) and stable JSON outputs.

This resolves the duplication that would otherwise arise from porting query into core while `mcp/src/query-engine.ts` already implements its own `planQuery`/`queryWiki`. Keeping a single core query implementation avoids two diverging engines while preserving the contract-based MCP boundary (0011). The MCP-side change — calling the core CLI instead of its own engine — is separate work in the detached `/mcp` repository and is not part of the Phase 0 core slice.
