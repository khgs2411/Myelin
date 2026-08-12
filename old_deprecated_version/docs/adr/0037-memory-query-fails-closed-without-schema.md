# Make memory query fail closed without valid schema context

`memory query <project>` requires valid schema context. If schema context is missing or invalid, query returns a deterministic error or degraded response that names the schema problem and suggests `schema build <project>` or `schema check <project>`. It must not fall back to weak unschematized query behavior, because that would recreate V1 routing assumptions and undermine schema-driven memory.
