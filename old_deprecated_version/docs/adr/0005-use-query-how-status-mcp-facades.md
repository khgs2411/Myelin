# Use query, how, and status as the high-level MCP facades

The V2 MCP surface uses `query` for knowledge answers, `how` for operating guidance, and `status` for structured current state and inventory. The earlier candidate `what` was rejected because it overlaps with ordinary knowledge questions and does not signal state inspection clearly enough. This gives agents a stable intent-oriented interface while allowing the first slice to share implementation helpers and return degraded metadata for memory sources that are not implemented yet.
