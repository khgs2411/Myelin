# Make schema build write by default

`schema build <project>` writes the generated schema context by default. The compiled schema context is deterministic generated state needed by agents, so requiring `--write` would add unnecessary friction. `schema build <project> --dry-run` previews the compiled context without writing for debugging and review.
