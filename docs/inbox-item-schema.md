# Inbox Item Schema

All inbox producers write JSON files to `projects/<key>/inbox/<filename>.json`.

Schema:

```json
{
  "id": "2026-04-19T19-22-14Z_a1b2c3",
  "schema_version": 1,
  "source": "mcp-auto",
  "emitted_at": "2026-04-19T19:22:14Z",
  "project_key": "rpg_game",
  "question": "exact question text, verbatim",
  "target_hint": "wiki/systems/combat-system.md",
  "confidence": 0.23,
  "pages_read": [
    "wiki/systems/combat-system.md",
    "wiki/systems/combat-effect-resolution.md"
  ],
  "pages_considered": 21,
  "router_model": "gpt-5.4-mini",
  "synthesizer_model": "gpt-5.4-mini",
  "enriched_notes": null,
  "question_index": null,
  "question_tag": null,
  "score_awarded": null,
  "score_max": null,
  "expected_page": null,
  "measurement_run_id": null,
  "operator_notes": null
}
```

Required fields:

- `id`
- `schema_version`
- `source`
- `emitted_at`
- `project_key`
- `question`
- `target_hint`

Allowed `source` values:

- `mcp-auto`
- `agent-enriched`
- `agent-flagged`
- `validate-auto`
- `measure-auto`
- `manual`

Source-specific rules:

- `mcp-auto` and `agent-enriched` populate `confidence`, `pages_read`, `pages_considered`, `router_model`, and `synthesizer_model`.
- `agent-enriched` additionally populates `enriched_notes`.
- `agent-flagged` populates `confidence` (the original wrong confidence score from the bad answer), `pages_read` (what the bad answer cited), `router_model`, `synthesizer_model`, and `enriched_notes` (the agent's correction, with `file_path:line_number` citations). Use when the wiki answered confidently but source verification showed the answer was wrong or stale.
- `validate-auto` populates `pages_read` (affected wiki pages), `enriched_notes` (validation evidence plus suggested action), and `operator_notes` (a dedupe signature for the still-pending maintenance item). Use when validate emits a curated non-blocking semantic warning that should be queued for a later manual `make update`. Update-run validate calls suppress `validate-auto` emission until the bounded self-correction pass has had one chance to resolve the warning.
- `measure-auto` populates `question_index`, `question_tag`, `score_awarded`, `score_max`, `expected_page`, and `measurement_run_id`.
- `manual` may populate `operator_notes`.
- Fields that do not apply must be present with `null` values rather than omitted.

`target_hint` guidance:

- `mcp-auto`: use the best available page hint, preferring the first citation and then the first page read.
- `agent-flagged`: use the first citation supplied by the flagging agent.
- `validate-auto`: use the first affected page when one exists.
- `measure-auto`: use `expected_page`.
- `manual`: use a best guess or `""` when no page hint exists yet.

Filename convention:

- `<iso-timestamp-z>_<6-char-random-hex>.json`
- Timestamp uses UTC and replaces `:` with `-` for filesystem safety.
- Example: `2026-04-19T19-22-14Z_a1b2c3.json`
- The `id` field must equal the filename stem.
