# Close remaining V2 grill decisions autonomously

The remaining V2 design questions are resolved with the recommended path unless later implementation evidence contradicts them:

- Defer global schema candidate generation commands until cross-project Practice/Personal promotion exists.
- Store project-local schema candidates in `projects/<key>/state/schema-candidates.json`.
- Store global schema candidates in root `state/schema-candidates.json`.
- Use globally unique schema candidate ids with `project_key` ownership.
- Use schema candidate states `pending`, `applied`, `rejected`, `superseded`, and `failed`.
- Project-local `schema apply` rebuilds that project's schema context.
- Global `schema apply --global` rebuilds schema context for all registered projects or fails/rolls back.
- Use V2 project layout: `sources/`, `wiki/`, `schema/`, `state/`, `log/`, and `runs/` under each project.
- Treat old global artifacts as migration reference material, not the target layout.
- Make the V2 CLI operator-facing with human-readable output by default and `--json` for machine-readable output.
- Keep the detached MCP server as the primary agent API.
