# RuntimeInboxItemJsonFormat

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Shape

The runtime inbox source file is the preserved operator/tool proposal record.

Intended destination: `projects/<key>/sources/inbox/<id>.json`

### File Shape

- `schema_version`: `1`
- `id`: stable source item id
- `project_key`: owning project key
- `created_at`: source creation timestamp
- `creator`: operator or tool identity
- `target_layer`: `project | practice | personal`
- `target_scope`: layer-specific scope hint
- `title`: short summary
- `body`: multiline proposal text
- `rationale`: why the proposal should become durable memory
- `evidence_refs`: source references, URLs, or local citations
- `target_hint`: optional routing hint
- `confidence`: explicit confidence string or bounded rating
- `risk`: explicit risk string or bounded rating
- `tags`: optional small classification list

### Validation Rules

- `schema_version` must be 1.
- `id` must match the filename stem.
- `project_key` must be non-empty and project-owned.
- `target_layer` must be present and must be `project` in this slice.
- `body`, `rationale`, `confidence`, and `risk` must be present.
- `evidence_refs` may be empty only if the command allows an explicit no-evidence rationale.
- The file must be valid JSON and preserved as authored source material.

### Write-Time Invariants

- Write the file atomically.
- Do not rewrite the file to add lifecycle state.
- Create `sources/index.md` and `sources/inbox/index.md` when this is the first preserved inbox source item.
- Keep the file name stable so intake can derive a deterministic candidate id.

### Ownership Boundary

This file format owns:

- preserved source content
- proposal metadata
- author identity
- write-time provenance

This file format does not own:

- candidate status
- intake dedupe
- packet construction
- curation
- markdown apply

### Result Vocabulary

- `validated`
- `created`
- `invalid`
- `unsupported_layer`
- `blocked_path`

### Failure Posture

- Invalid JSON must fail before intake.
- Unsafe repository escapes must block.
- Unsupported layers must not become source records in this slice.
- Source files are preserved evidence, not lifecycle records.

### Open Risks Or Allowed Divergence

- `body` should support multiline text. `rationale` may also be multiline if it uses the same JSON string validation path.
- `evidence_refs` may start as opaque strings and become structured refs later if implementation evidence requires it.
- Paired Markdown/JSON files are intentionally out of scope for this slice; accepted durable memory becomes markdown only after curator review and apply.
