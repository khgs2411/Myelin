# Adopt "Myelin" as the product name

The product is named Myelin. It is built on the LLM Wiki Pattern — the originating Karpathy technique, which keeps its name as a defined concept (the product is built *on* the pattern; the two coexist).

Phase 0 applies the rename to the product name, the CLI binary (`myelin`), the config file (`myelin.config`), and documentation/design/ADRs. Contract-level identifiers — the `LLM_WIKI_*` environment variables and the `mcp__llm-wiki__*` tool namespace — are intentionally left unchanged in Phase 0 because they are MCP integration contracts; renaming them rides with the later MCP slice. This emphasizes the product identity without reaching into the detached MCP repository or breaking agent/client configuration mid-migration.
