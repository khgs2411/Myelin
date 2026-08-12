# Superseded: root Bun workspace with MCP package membership

This decision was superseded by ADR 0011. `/mcp` is not a workspace member and should remain detached from the main repo by design. The core repo can still move to Bun/TypeScript, but MCP integration happens through stable interface contracts rather than shared workspace packages or source imports.
