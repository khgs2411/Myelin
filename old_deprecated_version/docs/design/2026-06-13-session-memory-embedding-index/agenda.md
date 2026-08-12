# Session Memory Embedding Index Design Agenda

## Status

- Spec: `spec.md`
- State: Complete
- Completion gate:
  - Live agenda questions resolved: Yes
  - Pressure test complete: Yes
  - Spec finalized: Yes

## Documented Decisions

- Session Memory is the first actual memory layer above raw Experience Log evidence.
- The existing agentic ingest write path should remain intact.
- `session_memories` remains canonical trusted Session Memory; embeddings are a derived retrieval aid.
- SQLite VEC and embedding-backed retrieval were intentionally deferred from the Experience Log ingest implementation.
- Gemini is the preferred first embedding provider for this slice.
- Agents and future MCP tools should use a facade, not direct raw SQLite table queries.
- Current Briefing v0 should read Session Memory through the retrieval facade once it exists.

## Questions

### Question 1: Embedding Failure Semantics

- Status: Answered
- Branch type: Initial
- Why it matters: This sets the transaction boundary between trusted memory creation and derived retrieval freshness. If the wrong boundary is chosen, a transient Gemini quota failure or sqlite-vec setup problem could either lose valid memory or hide retrieval corruption.
- Scenario probe: The ingest agent creates three high-confidence Session Memory rows, but Gemini quota is exhausted after the first embedding. Should all three Session Memory rows exist immediately, or should the second and third writes fail because they are not searchable yet?
- Options:
  - A. Commit Session Memory first, mark embeddings pending/failed, and retry later — preserves trusted memory and makes retrieval freshness explicit, but query may be degraded until indexing catches up.
  - B. Require embedding success in the same transaction as Session Memory creation — guarantees every memory is searchable at creation time, but makes trusted memory durability depend on provider quota and sqlite-vec availability.
  - C. Store embeddings opportunistically with no durable pending/failed status — simplest to implement, but creates silent retrieval gaps and poor recovery.
- Recommendation: A. Session Memory correctness and vector freshness are different concerns; losing trusted memory because Gemini or sqlite-vec is temporarily unavailable would be the wrong failure mode.
- Answer: Option A. Commit Session Memory first, mark embeddings pending/failed, and retry later.
- Answer impact: Confirms branch
- Spec impact: Updated Error Handling from provisional recommendation to resolved decision. Session Memory durability is independent from derived vector freshness.
- Context impact: Not needed. Existing glossary already defines Session Memory and related terms; failure semantics belong in the spec.
- ADR impact: Not needed. This is an expected source-of-truth versus derived-index boundary for this slice, not a surprising architectural tradeoff.
- Follow-ups: Question 2 now decides whether the pending/failed embedding lifecycle is inline, queued, or hybrid.

### Question 2: Indexing Timing

- Status: Answered
- Branch type: Initial
- Why it matters: The implementation can either embed synchronously during ingest or enqueue indexing work for a separate worker/command. This affects latency, quota control, backfill, and detached job completion semantics.
- Scenario probe: A full class-kit queue drain creates hundreds of Session Memory rows. Should the ingest job stay running until every vector is indexed, or should it finish after memory writes and leave embedding work to a separate retryable indexer?
- Options:
  - A. Inline best-effort indexing during Session Memory writes — simplest operator flow and immediate retrieval when it works, but ingest duration and provider quota become coupled.
  - B. Durable embedding queue/indexer, with ingest only marking rows pending — cleaner lifecycle and easier quota/backfill control, but adds one more worker/command surface.
  - C. Hybrid: inline for small batches and queue for backfill/failures — practical, but needs a precise threshold and more status semantics.
- Recommendation: B. Avoid hybrid thresholds for v0; keep ingest completion independent from embedding quota and make indexing explicitly retryable.
- Answer: Option B. Use a durable embedding queue/indexer, with ingest only marking rows pending.
- Answer impact: Changes model
- Spec impact: Updated User-Facing Behavior, Technical Design, Error Handling, and Planning Boundary Guidance so ingest never calls the embedding provider directly. A separate indexer/backfill command owns Gemini calls, sqlite-vec writes, retries, and backfill.
- Context impact: Not needed yet.
- ADR impact: Not needed. This is a v0 lifecycle boundary for Session Memory indexing, not a global background-work architecture yet.
- Follow-ups: Question 5 backfill semantics become simpler because the same indexer/backfill path handles existing and newly pending rows.

### Question 3: Embedding Text Contract

- Status: Answered
- Branch type: Initial
- Why it matters: The vector index searches whatever text Myelin embeds. If the embedded text is too thin, recall is weak. If it includes noisy raw payloads, recall becomes misleading and may leak raw evidence into a derived serving layer.
- Scenario probe: A Session Memory row has a concise summary and a structured payload containing branch names, Trello links, and command outputs. Which parts should affect semantic search?
- Options:
  - A. Embed only `title` and `summary` — safest and simple, but may miss useful structured context.
  - B. Embed deterministic selected fields from `payload_json` plus `title` and `summary` — better recall, but needs a stable sanitizer/normalizer.
  - C. Let the ingest agent provide separate `embedding_text` — flexible, but adds another field agents can misuse or drift.
- Recommendation: B for v0 with conservative field selection, falling back to A when payload shape is not clearly safe.
- Answer: Option B with fallback to A. Build embedding text from `title`, `summary`, `memory_kind`, and deterministic selected safe `payload_json` fields; fall back to the title/summary/kind contract when payload shape is unclear.
- Answer impact: Confirms branch
- Spec impact: Updated Canonical Record And Derived Index and Testing Strategy with the conservative normalizer boundary. The design now explicitly excludes raw Experience Log text, bulky command output, complete transcripts, and arbitrary nested payload blobs from embedding text.
- Context impact: Not needed yet.
- ADR impact: Not needed.
- Follow-ups: Implementation planning should define the initial safe payload scalar allowlist and tests around unsafe fallback.

### Question 4: Query Facade Shape

- Status: Answered
- Branch type: Initial
- Why it matters: Current Briefing, MCP tools, and future agents need a stable contract before implementation planning. If the facade is too broad, this slice becomes a general memory query redesign; if too narrow, it will be replaced immediately.
- Scenario probe: A new reviewer agent asks "what happened last time in class-kit around Symphony review?" Should the facade return raw rows, ranked matches, or a synthesized answer?
- Options:
  - A. Return ranked Session Memory matches only — focused and easy to verify, but Current Briefing may still need separate synthesis.
  - B. Return ranked matches plus a thin optional synthesized summary — more directly useful, but introduces LLM query execution into this slice.
  - C. Implement the broader `memory query` facade across all memory layers now — closest to the long-term product, but too broad for this Session Memory completion slice.
- Recommendation: A. Finish trustworthy retrieval first; synthesis can sit above the facade once retrieval is proven.
- Answer: Option A. Return ranked Session Memory matches only.
- Answer impact: Confirms branch
- Spec impact: Updated Query Facade, Error Handling, and Planning Boundary Guidance to state that `query_session_memory` is retrieval-only. Current Briefing may synthesize above this facade, but the facade itself does not perform answer synthesis or silently table-dump around unavailable vector retrieval.
- Context impact: Not needed. Query Facade already exists in `CONTEXT.md`.
- ADR impact: Not needed.
- Follow-ups: Planning should keep any Current Briefing synthesis integration in a later or separate chunk after retrieval behavior is verified.

### Question 5: Existing Row Backfill

- Status: Answered
- Branch type: Initial
- Why it matters: Dogfood has already created Session Memory rows without embeddings. The design needs a clean path for existing rows or early retrieval will be incomplete.
- Scenario probe: `state/memory.db` contains two dogfood Session Memory rows before this slice lands. Should migration immediately index them, leave them pending, or require an explicit command?
- Options:
  - A. Migration marks existing rows pending but does not call providers — deterministic and safe for migrations.
  - B. First query opportunistically embeds missing rows — convenient, but query latency and quota behavior become surprising.
  - C. A dedicated backfill/reindex command handles existing rows — explicit and controllable, but requires the operator to run it.
- Recommendation: A plus C. Migrations should never call Gemini; they should create pending state, and a command/indexer should backfill explicitly.
- Answer: Options A and C. Migration marks existing rows pending without provider calls, and the dedicated indexer/backfill command indexes them later.
- Answer impact: Resolves branch
- Spec impact: Updated User-Facing Behavior, Data / State, Planning Boundary Guidance, and Acceptance Criteria to require pending-only migration plus explicit backfill/reindex. Provider calls during migration or query are excluded.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: None from this branch.

### Question 6: Slice Boundary For MCP Exposure

- Status: Answered
- Branch type: Pressure-test
- Why it matters: The spec currently includes the retrieval facade because Current Briefing needs a stable way to read Session Memory, but the user's wording also separates embedding/indexing from the later MCP query layer. Planning needs to know whether this design should produce an internal facade only or an agent-facing MCP tool in the same slice.
- Scenario probe: After this implementation lands, a Codex agent in another repo wants to ask Myelin for relevant Session Memory. Should it already have an MCP tool it can call, or should this slice only prove indexing plus an internal query function that a later MCP slice exposes?
- Options:
  - A. Internal facade only in this slice — keeps the implementation focused on embedding/index correctness, but Current Briefing/MCP remains blocked until the next slice.
  - B. Internal facade plus minimal MCP tool exposure in this slice — completes the usable agent-facing Session Memory layer sooner, but expands scope into MCP contracts.
  - C. Split into two child specs/plans now: embedding/index first, MCP query exposure second — preserves sequencing clarity, but adds planning overhead.
- Recommendation: B if the goal is to complete "Session Memory Query + Embedding Index v0" as one product slice; A if you want a strict embedding-only slice before touching MCP. I would not choose C unless we expect multiple rounds of design uncertainty.
- Answer: Option A. This slice exposes an internal retrieval facade only; MCP tool exposure and Current Briefing consumption are later work.
- Answer impact: Changes model
- Spec impact: Updated Goal, Current Context, User-Facing Behavior, Query Facade, Integrations, Planning Boundary Guidance, and Acceptance Criteria to make MCP exposure out of scope. The slice now proves embedding/index correctness plus internal retrieval, not agent-facing MCP usage.
- Context impact: Not needed. Query Facade and Status Facade terms already exist.
- ADR impact: Not needed.
- Follow-ups: Later MCP/query design should expose `query_session_memory` to agents and wire Current Briefing to consume it.

## Pressure-Test Result

- Status: Complete
- Checked categories: lifecycle/interruption, state persistence, handoff boundaries, verification evidence, scope control, recovery paths, sequencing, and user review points.
- Result: One material scope boundary was found and resolved in Question 6. External audit then found config/versioning ambiguity, which was resolved in the spec through an explicit embedding config contract, active-contract rule, and sqlite-vec metadata-first degraded behavior.
- Remaining non-blocking risks: sqlite-vec Bun/macOS extension loading may require implementation-specific fallback handling; Gemini model/dimension defaults must be verified during implementation against the current API docs and available configured credentials.

## External Audit Reconciliation

- Audit: Design/spec audit by sub-agent `019ec0f0-8d1b-7a21-b503-d276a262b375`.
- Result: Needs Changes.
- Critical issue 1: Codebase verification incomplete due interrupted audit.
  - Reconciliation: Keep same auditor for re-audit with focused verification over supporting artifacts and referenced code paths.
- Critical issue 2: Configuration contract too loose for planning.
  - Reconciliation: Updated `spec.md` with `Embedding Config Contract`, `Embedding Contract Versioning`, sqlite-vec metadata-first behavior, out-of-scope boundaries, and acceptance criteria for active-contract selection.
- Recommendation: Add out-of-scope section.
  - Reconciliation: Added `Out Of Scope` to `spec.md`.
- Recommendation: State multiple embedding contract behavior.
  - Reconciliation: Added one active configured contract for v0; historical contracts may exist but are not queried unless explicitly selected by future migration/reindex work.
- Re-audit: Same sub-agent `019ec0f0-8d1b-7a21-b503-d276a262b375`.
- Re-audit result: Ready for Development.
  - Interpretation: Design artifacts are ready to proceed to `$pmp-writing-plans`.
  - Remaining planning note: Roadmap should assign the create-vs-update Session Memory write-path detail to the pending-state integration chunk.
