# ReconciliationOwnershipBoundary

Pseudocode artifact. Non-executable reference shape for planning.

## Boundary Summary

Project Memory Source Consumption reconciliation is a deterministic lifecycle bridge. It reads canonical project-level source-consumption evidence and mutates root SQLite queue statuses so already-applied candidates/handoffs are not fed back into the Project Memory curator.

## Apply Owns

`src/project/project-memory-markdown-applier.ts` owns:

- rendering validated Project Memory Apply Payloads;
- staging canonical markdown/state writes;
- apply journal promotion and recovery;
- `project-memory-apply-result.json`;
- `project-memory-changeset.json`;
- `projects/<key>/state/project-memory-source-consumptions.json`.

Apply does not own:

- SQLite `memory_candidates` status mutation;
- SQLite `project_handoff_instructions` status mutation;
- deciding whether a pending queue row should be processed after the run has completed.

## Reconciler Owns

`src/project/project-memory-source-consumption-reconciler.ts` owns:

- reading `project-memory-source-consumptions.json`;
- validating the narrow state shape;
- classifying consumed refs by source kind;
- updating matching project-scoped queue rows to `processed`;
- idempotent handling of already processed/rejected/missing refs;
- returning a compact reconciliation result.

Reconciler does not own:

- markdown mutation;
- run artifact mutation;
- provider invocation;
- curator validation;
- source creation or gap routing;
- Practice or Personal Memory promotion.

## Packet Owns

`src/project/project-memory-packet.ts` owns:

- read-only packet assembly;
- reading current pending candidates and handoffs from SQLite;
- compacting queue rows for curator input;
- deterministic markdown lookup;
- degradation reporting when serving state is unavailable.

Packet does not own:

- mutating queue lifecycle statuses;
- creating source-consumption state;
- hiding lifecycle bugs by silently dropping rows without reconciliation.

If standalone `project packet` must avoid showing consumed refs, it may add a read-only defensive filter from source-consumption state. That filter should be treated as presentation/packet hygiene, not as the lifecycle owner.

## Memory Queue Helpers Own

`src/memory/candidates.ts` and `src/memory/handoffs.ts` own narrow table-specific transition helpers:

- pending or needs_review -> processed;
- already processed/rejected -> idempotent terminal result;
- missing row -> missing result.

They do not know about Project Memory Source Consumption as a product concept.

## Why This Split Exists

This preserves the product rule that Project Memory canonical truth is markdown plus project state, while SQLite remains queue/session/serving state.

It also preserves the prior apply-slice decision: successful apply writes source-consumption evidence, but candidate/handoff lifecycle mutation belongs to a later deterministic reconciler.

## Not In This Slice

- route gaps, stale findings, or inbox items into Project Memory candidates;
- create new Memory Candidates;
- reject pending candidates;
- surface candidates in query/status;
- build Project Memory vector retrieval indexes;
- add Practice Memory or Personal Memory promotion.
