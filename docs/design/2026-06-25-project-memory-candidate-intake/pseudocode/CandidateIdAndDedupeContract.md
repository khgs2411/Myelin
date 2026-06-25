# CandidateIdAndDedupeContract

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Shape

Deterministic candidate identity is the core idempotency boundary for runtime inbox intake.

### Identity Rules

- The runtime inbox source item is the canonical identity source for the first slice.
- Candidate ids should be derived deterministically from the source item id plus the project ownership context.
- Re-intake of the same source item must reuse the same candidate id.
- The source ref convention is `inbox:<item-id>`, matching the filesystem path `projects/<key>/sources/inbox/<id>.json`.
- Candidate type is `project.inbox`.

### Duplicate Detection Order

1. Look up candidate by deterministic id.
2. If found and status is `pending` or `needs_review`, return the existing row.
3. If found and status is `processed` or `rejected`, return a terminal duplicate result.
4. If not found, create exactly one normalized candidate row.

### Result Vocabulary

- `created`
- `existing`
- `terminal_duplicate`
- `invalid_source`
- `unsupported_layer`
- `skipped`
- `blocked`

### Ownership

Owns:

- candidate id derivation
- duplicate detection rules
- source ref naming convention for runtime inbox proposals
- idempotency expectations for repeated intake

Does not own:

- inbox file persistence
- candidate status transitions after intake
- project learn orchestration
- curator validation
- markdown apply

### Open Risks Or Allowed Divergence

- A hash-based candidate id can be introduced later if item-id-only derivation proves too weak.
- A project-local source index can be added later if the queue needs richer duplicate lookup.
- Existing `memory_candidates` status names stay authoritative; this contract should not invent a new lifecycle vocabulary.
- Runtime inbox intake creates `needs_review` candidates only; the creator cannot mark an inbox proposal as pre-approved.
- If future Practice or Personal intake needs different duplicate semantics, this contract should stay project-only until those flows exist.
