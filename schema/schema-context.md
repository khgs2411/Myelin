# Compiled Schema Context Shape

`schema build <key>` compiles the authored global schema (`schema/`) into `projects/<key>/state/schema-context.json` — the deterministic, agent-facing contract that `memory query`, `project learn`, and `status` consume. It is generated state, never hand-edited. `memory query` fails closed if it is missing or invalid (ADR 0037).

## Phase-0 shape (thin, global-only)

```json
{
  "schema_version": "0",
  "built_at": "<iso-8601, stamped at build time>",
  "inputs": { "<schema-relative-path>": "<sha256>" },
  "source_classification": {
    "required_fields": ["..."],
    "source_kind": ["..."],
    "ownership": ["..."],
    "action": ["..."]
  },
  "memory_scopes": { "scopes": ["..."], "phase_0_active": ["..."], "phase_0_deferred": ["..."] },
  "page_taxonomy": { "categories": ["..."] },
  "provenance": { "required": ["file_path_line | commit_pointer | source_snippet | inference_label"] },
  "cli_vocabulary": {
    "commands": ["bootstrap", "project learn", "project ingest", "memory query", "status", "schema check", "schema build", "session close"]
  }
}
```

## Rules

- `inputs` records a sha256 per authored schema file so freshness is checkable without rebuilding (ADR 0025); unchanged inputs do not trigger a rewrite.
- The Zod validator and the compiler are implemented in Task 3 against this shape; this document is the authority for that shape.
- Project-local sections, overrides, and candidate references are NOT part of the Phase-0 context (ADR 0049); add them when that machinery lands.

## Bootstrap (new project, no project-local schema)

`schema build` always succeeds for a project with no project-local schema — it compiles the global rules into a valid context. No project-local input is required in Phase 0, so `memory query` / `project learn` never dead-end on a missing project schema. This resolves the schema-bootstrap gap.
