# ProjectLearnRetrievalLifecycle

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Shape

`project learn` uses retrieval twice:

- pre-write lookup to decide what to do with candidates;
- post-write indexing to make newly written markdown queryable for future lookups.

## Creation Mode

1. Reconcile prior source consumption.
2. Intake runtime inbox items into Project Memory candidates.
3. Build packet.
4. Use fallback markdown lookup if no derived index exists.
5. Curator returns creation draft.
6. Validator validates creation output.
7. Apply writes canonical markdown/state.
8. Extract structural retrieval metadata.
9. Run mandatory hint generation for new pages/entries.
10. Index sections/hints into SQLite/vector rows.
11. Report completed, completed-with-pending-index, or needs-review.

Creation may return `completed_with_pending_index` when canonical markdown/state writes succeeded but mandatory hint generation, embedding, or index refresh is queued, partially failed, or awaiting retry. It may not report `completed` until required retrieval indexing for newly created pages/entries is finished.

## Maintenance Mode

1. Reconcile prior source consumption.
2. Intake runtime inbox items.
3. Refresh or read structural retrieval status.
4. Prefer indexed section lookup.
5. Fall back to markdown lookup when index is unavailable/stale.
6. Curator returns maintenance proposal and explicit evidence dependencies.
7. Validator applies scoped gating:
   - fresh indexed dependencies can auto-apply if otherwise eligible;
   - fallback dependencies require review in maintenance mode;
   - stale/orphaned dependencies quarantine or reject affected items.
8. Apply eligible items.
9. Extract structural metadata for changed pages.
10. Run mandatory hint generation for new entries/pages.
11. Reuse valid hints for unchanged existing sections.
12. Index changed/new sections.

## No-Op Completion

For any non-empty packet that used fallback lookup, zero write proposals can complete only when:

- curator emits explicit no-op decision;
- no-op cites candidate/source refs;
- no-op cites canonical markdown refs checked, when claiming existing memory covers it;
- reason is not `insufficient_evidence`.

Otherwise the run remains `needs_review`.

This applies in both creation and maintenance modes. Empty-input runs can complete without an explicit no-op because there is no candidate/source claim to adjudicate.

## Terminal Run Result Vocabulary

- `completed`: markdown/state and required retrieval indexing finished.
- `completed_with_pending_index`: canonical markdown/state applied; required retrieval index work queued or partially failed.
- `needs_review`: validation, scoped gating, fallback no-op, or review option requires human/agent review.
- `failed`: infrastructure or recovery failure prevents safe continuation.

## Failure Posture

- Prompt transport failures remain out of scope; artifact-reference transport is resolved.
- Post-write indexing failure must not roll back successfully applied canonical markdown unless the product explicitly requires fully indexed creation before completion.
- Missing mandatory hints for new pages means not fully indexed and should be visible in run result.
- Stale retrieval rows must not authorize maintenance writes.
