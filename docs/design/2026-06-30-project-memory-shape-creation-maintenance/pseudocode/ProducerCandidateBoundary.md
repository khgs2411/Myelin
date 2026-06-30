# ProducerCandidateBoundary

Pseudocode artifact. Non-executable reference shape for planning.

## Intended Destination

Likely touches:

- `src/ingest/worker.ts`
- `src/memory/candidates.ts`
- `src/memory/handoffs.ts`
- `src/project/project-memory-candidate-intake-service.ts`
- `src/project/project-memory-packet.ts`
- future gap/stale producer paths

## Owns

- The boundary between producers and Project Memory curation.
- Normalized input shapes for Project Memory leads.
- Rules that prevent producer-specific semantics from bypassing `project learn`.

## Does Not Own

- Final durable markdown content.
- Page or section placement.
- Curated state updates.
- Documentation quality decisions.
- Query answer synthesis.

## Accepted Producer Inputs

Producer classes:

- Session Memory ingest agents.
- Runtime durable-memory inbox.
- Future stale-answer/gap/poor-coverage producers.
- Future Practice/Personal promotion producers when they target Project Memory evidence.

Normalized shapes:

- `MemoryCandidate` with `scope: "project"`.
- `LayerHandoffInstruction` with `target_scope: "project"`.

## Producer Rules

Producers may:

- say why something appears durable;
- attach source event refs, evidence hints, confidence, risk, rationale, and target hints;
- propose a candidate type or handoff objective;
- prioritize a lead as important.

Producers must not:

- write Project Memory markdown;
- choose final page/section placement as authoritative;
- mark Project Memory curated;
- bypass Project Memory Curator validation;
- treat conversation text as canonical project truth;
- create producer-specific durable lanes that `project learn` must special-case after normalization.

## Project Learn Intake Flow

1. Source producer emits candidate or handoff.
2. Runtime inbox intake, ingest worker, or future producer stores normalized row.
3. Source-consumption reconciler retires already-consumed inputs before packet construction.
4. Project packet includes pending project candidates and handoffs.
5. Curator treats them as leads:
   - inspect target repo evidence;
   - check existing Project Memory;
   - decide durable/layer ownership;
   - produce documentation update, explicit no-op, or missing-coverage diagnostic.
6. Apply or explicit no-op creates source-consumption evidence for project candidates/handoffs.

## Result Vocabulary

Candidate/handoff disposition inside Project Memory curation:

- `applied_to_project_memory`
- `already_trusted`
- `not_durable`
- `belongs_to_other_layer`
- `insufficient_evidence`
- `missing_coverage_no_grounded_write`
- `blocked_by_quality`

Only `applied_to_project_memory` and explicit supported no-op dispositions should make the source terminal.

## Idempotency

- Candidate IDs should remain stable enough to avoid duplicates for runtime inbox sources.
- Source-consumption reconciliation remains the owner of moving consumed candidates/handoffs out of pending packet input.
- Repeated producers may produce similar leads, but Project Memory maintenance must dedupe against canonical docs before writing.

## Failure Posture

- Malformed source records degrade intake and stay out of curator packet input.
- Blocking intake failures stop `project learn`.
- Unsupported future layers are skipped/degraded rather than force-fit into Project Memory.

## Review Points

- Planning should decide whether future stale/gap producers write runtime inbox files first or insert normalized candidates directly behind a shared service.
- Planning should preserve one downstream boundary even if producer-specific collection logic differs upstream.
- Candidate weighting in maintenance should affect prioritization, not direct write authority.
