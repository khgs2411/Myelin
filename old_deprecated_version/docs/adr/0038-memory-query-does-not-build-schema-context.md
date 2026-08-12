# Keep memory query from building schema context

`memory query <project>` does not auto-run `schema build`. Query should remain cheap, predictable, and side-effect-light. If schema context is missing or invalid, query fails closed and suggests schema commands. Schema rebuilding belongs to explicit schema commands or write workflows such as `project learn`.
