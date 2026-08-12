# CandidateIntakeReliabilityBoundary

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Shape

This boundary prevents the runtime inbox from becoming a hidden curator, a canonical store, or a second Session Memory path.

### Owns

- Runtime inbox writer:
  - writes preserved source records
  - validates source schema and provenance
  - records the proposal intent
  - accepts `memory inbox create` input only for the project layer in this slice
  - maintains the lazily created `sources/index.md` and `sources/inbox/index.md` files

- Candidate intake service:
  - validates inbox items
  - normalizes project-owned items
  - dedupes normalized candidates
  - writes candidate rows
  - emits `needs_review` candidates only in this slice

- `project learn` orchestration:
  - runs reconciliation
  - runs intake
  - builds the packet
  - invokes validation and apply

- Packet builder:
  - reads normalized pending/needs-review candidates
  - does not mutate queue state

### Does Not Own

- Runtime inbox does not own candidate lifecycle mutation.
- Intake does not own wiki markdown writes.
- Intake does not own Project Memory source-consumption records.
- Intake does not own Session Memory ingest or embedding.
- Intake does not own candidate queue cleanup after apply.
- Packet building does not own row creation or deletion.
- Runtime inbox does not expose a lifecycle status field to creators.

### Boundary Guarantees

- Runtime inbox source material can exist without becoming canonical memory.
- Normalized candidates can exist without being immediately applied.
- Repeated intake over the same source item is idempotent.
- Project Memory truth still lives in markdown plus project state, not SQLite.
- Session Memory remains a separate producer path and should not be conflated with runtime inbox proposals.
- `project learn` still owns the order: recovery, reconciliation, intake, packet, curator, apply.
- The source path is `projects/<key>/sources/inbox/<id>.json`, the source ref is `inbox:<id>`, and the candidate type is `project.inbox`.
- Runtime inbox review means curator/agent evidence review, not operator/manual approval.

### Failure Posture

- Unsafe source paths block.
- Malformed items are isolated and should not contaminate valid intake results.
- Unsupported layers are rejected or skipped without inventing a new queue.
- Intake should fail closed on ambiguous ownership.
- Missing inbox directories are degraded noops, not fatal by themselves.

### Later Extensions That Must Stay Out Of This Slice

- explicit Practice/Personal intake producers
- inbox item lifecycle mutation fields
- derived inbox-state indexes
- new retrieval/indexing behavior
- curator-side direct source ingestion
