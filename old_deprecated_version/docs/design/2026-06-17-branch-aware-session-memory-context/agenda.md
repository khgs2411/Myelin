# Branch-Aware Session Memory Context Design Agenda

## Status

- Spec: `spec.md`
- State: Complete
- Completion gate:
  - Live agenda questions resolved: Yes
  - Pressure test complete: Yes
  - Spec finalized: Yes

## Documented Decisions

- Session Memory stays project-scoped by default.
- Branch metadata is captured per Experience Log row and preserved through tombstones and Session Memory context rows.
- Ingest no longer uses `master` as a launch gate.
- Query supports exact branch filtering, including `--branch current`.
- Historical branchless rows are left honest, not backfilled to `master`.

## Questions

### Question 1: Should non-master ingest fail or warn?

- Status: Answered
- Branch type: Initial
- Why it matters: The previous ingest design treated `master` as a safety gate. That would make active branch work impossible to ingest and would force the user to stop normal branch workflows to preserve Session Memory.
- Scenario probe: The target repo is on `feature/sqlite-vec` and the operator runs `myelin ingest wizepal`. Should Myelin block the run, or start it and record branch context?
- Options:
  - A. Fail on non-master.
  - B. Warn and continue.
- Recommendation: B. Branch should be metadata, not a launch gate, for Session Memory ingest.
- Answer: Warn and continue.
- Answer impact: Changes model
- Spec impact: Updated ingest user-facing behavior and error handling. The `master` gate is removed and replaced with launch-time branch metadata plus a warning.
- Context impact: Update `CONTEXT.md` to remove the stale "on master" ingest assumption and add branch-aware Session Memory context terminology.
- ADR impact: Not needed. This is an operational boundary decision, not a hard-to-reverse architectural choice.

### Question 2: Where should branch context live?

- Status: Answered
- Branch type: Initial
- Why it matters: If branch context only lives on the ingest job, branch-aware retrieval will be lossy. If it only lives on the canonical memory row, a single memory that spans multiple captured events becomes awkward to represent.
- Scenario probe: One Session Memory row is built from two Experience Log rows captured on different branches during a transition. Should the model force a single branch, or preserve both observations?
- Options:
  - A. Store branch only on the ingest job.
  - B. Store branch only on `session_memories`.
  - C. Store branch on capture rows and replicate it into Session Memory context rows.
- Recommendation: C. Capture-time provenance is authoritative, and a separate context table keeps retrieval flexible.
- Answer: Capture-time provenance on Experience Log rows, plus `session_memory_contexts` rows for retrieval.
- Answer impact: Confirms branch
- Spec impact: Added the technical design for capture-time metadata and Session Memory context rows.
- Context impact: Update `CONTEXT.md` with `Session Memory Context` as a glossary term.
- ADR impact: Not needed.

### Question 3: How should legacy rows behave?

- Status: Answered
- Branch type: Follow-up
- Why it matters: Some existing rows predate branch capture. The design has to choose between honest null metadata and a fabricated default branch.
- Scenario probe: A row was captured before branch metadata existed. Should `memory query --branch feature/sqlite-vec` treat it as matching `master`, matching every branch, or matching nothing?
- Options:
  - A. Backfill all old rows to `master`.
  - B. Leave branch metadata null and exclude those rows from branch-specific filters.
  - C. Treat null metadata as wildcard matches for every branch.
- Recommendation: B. Honest nulls are better than invented provenance.
- Answer: Leave branch metadata null and exclude those rows from branch-specific filters.
- Answer impact: Confirms branch
- Spec impact: Added the Legacy Rows section and branch-specific retrieval behavior.
- Context impact: Not needed beyond the `Session Memory Context` glossary update.
- ADR impact: Not needed.

## Pressure-Test Result

- Status: Complete
- Checked categories: lifecycle and interruption, state persistence, retrieval boundaries, legacy data handling, query failure modes, and operator intent.
- Result: No additional live questions were required. The design is already pinned by the current codebase and by the user's stated preference that branch metadata should preserve context without partitioning memory.
- Remaining non-blocking risks:
  - Old branchless rows will not answer branch-specific questions.
  - `--branch current` depends on git branch resolution for the target repo.
  - The earlier master-only ingest design is now stale and should not be reused for new planning.
