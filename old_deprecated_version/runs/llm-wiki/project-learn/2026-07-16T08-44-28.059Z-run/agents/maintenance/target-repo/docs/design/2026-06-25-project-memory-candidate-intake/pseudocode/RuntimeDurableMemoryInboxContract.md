# RuntimeDurableMemoryInboxContract

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Shape

The runtime inbox is the explicit proposal boundary for durable memory before normalization.

Intended destination: `src/inbox/*`, `src/commands/*`, or future tool surfaces.

### Contract Shape

- `schema_version`: stable source contract version.
- `id`: stable source item id.
- `project_key`: project ownership for the proposal.
- `created_at` / `emitted_at`: audit timestamp for when the source material was created.
- `creator`: operator, runtime agent, or future tool identity.
- `target_layer`: `project | practice | personal`.
- `target_scope`: layer-specific scope hint, usually project key for the first slice.
- `title`: short operator-facing summary.
- `body`: source/proposal text that explains the intended memory.
- `rationale`: why this should become durable memory.
- `evidence_refs`: citations, links, or source refs that justify the proposal.
- `confidence`: required bounded enum, `low | medium | high`.
- `risk`: required bounded enum, `low | medium | high`.
- `target_hint`: optional routing hint for curator/intake.
- `tags` or `labels`: optional bounded classification only if it helps intake routing.

### Ownership

Owns:

- the raw proposal record
- source provenance
- explicit durable-memory intent
- layer declaration

Does not own:

- candidate dedupe
- candidate status transitions
- Project Memory curation
- markdown apply
- Session Memory ingest
- source-consumption reconciliation

### First-Slice Expectations

- First slice validates and persists `target_layer: "project"` only.
- First slice validates `confidence` and `risk` as `low | medium | high`.
- `memory inbox create` does not expose lifecycle status on the source record.
- Source records are preserved as evidence, not rewritten to reflect lifecycle.
- The source record should stay distinct from normalized `memory_candidates`.
- The contract must leave room for Practice and Personal without making them feel bolted on later.
- Source records live under `projects/<key>/sources/inbox/<id>.json` and are paired with lazily created `sources/index.md` and `sources/inbox/index.md`.

### Result Vocabulary

- `created`
- `validated`
- `invalid`
- `unsupported_layer`
- `rejected`

### Failure Posture

- Unsafe path or unsafe write target should block.
- Missing project context should fail closed.
- Invalid source records should not reach curator input.
- Unsupported layers should reject before write in the first slice.

### Open Risks Or Allowed Divergence

- `evidence_refs` may start as opaque strings and become structured refs later if implementation evidence shows the curator needs stronger typed citations.
- Source records do not carry lifecycle metadata in this slice. A future derived index can be considered if operator inspection becomes painful.
