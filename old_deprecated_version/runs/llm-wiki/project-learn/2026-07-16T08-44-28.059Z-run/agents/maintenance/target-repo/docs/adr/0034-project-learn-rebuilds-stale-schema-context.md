# Make project learn rebuild stale schema context

`project learn <project>` verifies schema-context freshness before learning. If the compiled schema context is stale, it automatically runs the equivalent of `schema build <project>` before proceeding. If schema validation fails, `project learn` stops instead of learning against invalid or inconsistent instructions.
