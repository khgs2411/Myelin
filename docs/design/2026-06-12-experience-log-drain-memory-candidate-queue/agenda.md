# Experience Log Drain And Memory Candidate Queue Design Agenda

## Status

- Spec: `spec.md`
- State: Working Draft
- Completion gate:
  - Live agenda questions resolved: No
  - Pressure test complete: No
  - Spec finalized: No

## Documented Decisions

- Experience Log is raw captured evidence, not truth.
- Processed raw Experience Log rows should be deleted only after an Experience Log Tombstone records the terminal decision/output reference.
- Memory Candidate targets exactly one memory scope: Project Memory, Session Memory, Practice Memory, or Personal Memory.
- Hooks must fail open and must not mutate curated memory or call models.
- Unbootstrapped repos are no-op drops before they become Experience Log rows.
- The first capture provider is Codex, but downstream drain/candidate logic should be provider-neutral.
- The approved previous slice uses root SQLite `state/memory.db`, provider-neutral `experience_events`, and `experience_event_tombstones`.

## Questions

### Question 1: Drain Command Ownership And Vocabulary

- Status: Answered
- Branch type: Initial
- Why it matters: The command name decides whether this is framed as part of `memory`, `project ingest`, or a standalone maintenance verb. That affects operator expectations, later automation, and planning chunk boundaries.
- Scenario probe: A Codex session in `class-kit` creates ten raw rows. The operator wants to process only captured rows into candidates without ingesting external source files or running broad Project Memory learning. Which command should they reach for?
- Options:
  - A. `myelin memory drain <project-key>` - makes the safety boundary explicit: drain raw memory evidence into candidates; avoids overloading `project ingest`, but adds a new memory-maintenance verb.
  - B. `myelin project ingest <project-key> --experience-log` - keeps all queued processing under existing ingest vocabulary; risks mixing raw hook-event draining with source/inbox ingest too early.
  - C. `myelin candidates generate <project-key>` - centers the output queue; clearer for candidate creation, but hides that raw Experience Log rows are consumed/tombstoned.
- Recommendation: A. Use `memory drain` for this slice. It is explicit, narrow, and avoids turning `project ingest` into a catch-all before source ingest and candidate queue contracts are stable.
- Answer: The user challenged the premise of a separate drain command. If the five memory layers are derived from raw memory/evidence inputs, one public `myelin ingest` command that starts the whole evidence-to-memory-candidate pipeline may be wiser than separate operator commands.
- Answer impact: Changes model
- Spec impact: Updated the provisional spec from `myelin memory drain` toward top-level `myelin ingest <project-key>` as the public orchestration surface, with Experience Log drain as an internal stage.
- Context impact: Candidate later - `Ingest Command` already exists in `CONTEXT.md`, but the term may need an update if we move from `project ingest <key>` to top-level `myelin ingest <key>` and broaden it from queued source processing to raw/local evidence processing.
- ADR impact: Candidate later - a top-level ingest orchestration command may deserve an ADR if it replaces or substantially redefines existing `project ingest`.
- Follow-ups: Added Question 8 to decide whether `myelin ingest` is one public orchestrator with stage flags or a single fixed pipeline.

### Question 2: One Raw Event To One Candidate Or Many

- Status: Answered
- Branch type: Initial
- Why it matters: A single user/assistant exchange can imply multiple things: session continuity, project fact, practice pattern, and personal preference. The cardinality choice affects schema, idempotency, review workload, and tombstone output references.
- Scenario probe: User asks in `class-kit`, "How do we create new users using Supabase?", and the assistant explains Supabase Auth after reading docs. This may imply session continuity, project uses Supabase, and a future practice if implementation follows. Should one raw row produce one best candidate, or several scoped candidates?
- Options:
  - A. One raw event produces at most one candidate - simple, deterministic, easier to review; risks losing legitimate multi-scope signals.
  - B. One raw event may produce multiple candidates, one per scope - captures richer meaning; requires stronger dedupe, review, and tombstone references.
  - C. One raw event produces one primary Session Memory output plus optional linked downstream layer handoff instructions - preserves simplicity while not losing signals; later layer agents receive concrete candidate/instruction/prompt/input records instead of vague hints.
- Recommendation: C. Start with one primary Session Memory output plus optional downstream layer handoff instructions. It keeps the first ingest bounded while preserving enough signal for later Project/Practice/Personal layer agents.
- Answer: C confirmed with a terminology correction. Ingestion should create a Session Memory item as the primary output. Downstream outputs should not be small hints; they should be durable prompts/instructions/input records that tell the higher-layer agent what to read, query, fetch, compare, or verify.
- Answer impact: Changes model
- Spec impact: Updated the Layer Handoff Model to describe one primary Session Memory output plus optional downstream layer handoff instructions. Removed hint language.
- Context impact: Updated - add Layer Handoff Instruction as the name for downstream candidate/instruction/prompt/input records.
- ADR impact: Candidate later - cardinality and handoff instruction shape may be ADR-worthy if they become the durable cross-layer contract.
- Follow-ups: Added Question 14 to define the shape of a layer handoff instruction.

### Question 3: First Candidate Scope Bias

- Status: Answered
- Branch type: Initial
- Why it matters: The first drain version cannot safely infer every memory layer with equal confidence. We need decide which scope is allowed by default and which scopes require stronger evidence.
- Scenario probe: A captured assistant answer says "Use Supabase Auth with server-side session checks." Is that enough for Project Memory, Session Memory, Practice Memory, or only a session candidate until code changes prove it?
- Options:
  - A. Session-first - default most valid captured Q/A into Session Memory candidates; only explicit durable facts become Project candidates. Lowest risk, slower Project Memory compounding.
  - B. Project-first - prioritize durable project facts and setup/runbook candidates. More immediately useful for Myelin's Project Memory goal, but higher risk of promoting discussion as fact.
  - C. Balanced but gated - create Session candidates broadly; create Project/Practice/Personal candidates only when evidence matches strict deterministic gates. More complete, but needs carefully defined gates.
- Recommendation: C, with strict gates. It matches the five-memory-layer ambition without letting casual chat become truth.
- Answer: Session Memory is the first actual memory layer. Experience Log is raw evidence; ingest turns it into Session Memory first, and Project/Practice/Personal layer work is derived from session-level interpretation.
- Answer impact: Changes model
- Spec impact: Updated the spec so `myelin ingest` produces Session Memory-layer output first, with downstream Project/Practice/Personal candidates derived from that interpretation rather than directly from raw capture.
- Context impact: Updated - added the relationship that Experience Log feeds Session Memory first, and higher layers are derived from Session Memory interpretation.
- ADR impact: Not needed unless the answer changes the product model.
- Follow-ups:

### Question 4: Candidate Raw Text Retention

- Status: Open
- Branch type: Risk
- Why it matters: Raw Experience Log rows may include sensitive prompts or full assistant answers. Candidate records need enough evidence for review, but duplicating raw text undermines the tombstone/retention model.
- Scenario probe: After drain, the raw row is tombstoned and deleted. The candidate reviewer opens a Project candidate. Should they see the full captured assistant answer, a short excerpt, a generated summary, or only a tombstone/source reference?
- Options:
  - A. Full raw text in candidate - easiest to review, but duplicates sensitive raw capture and weakens raw deletion.
  - B. Short excerpt plus metadata/reference - reviewable enough for many cases, lower retention risk, but may require looking up preserved evidence for hard cases.
  - C. No raw text, only structured summary and tombstone reference - best retention boundary, but weak for candidate review unless summary quality is trusted.
- Recommendation: B. Keep a bounded excerpt and structured metadata for pending candidates; delete full raw row through tombstone after the candidate exists.
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Candidate later if we name the retention policy.
- ADR impact: Candidate later because raw-retention tradeoffs are security-relevant.
- Follow-ups:

### Question 5: Relationship To Existing Session Tables

- Status: Open
- Branch type: Dependency
- Why it matters: The repo already has `sessions` and `session_events`, but the new hook-derived Session Memory candidate shape may not match those manual session event kinds. Connecting too early could distort both systems.
- Scenario probe: Drain sees a `session.start`, several `user.prompt`, and `assistant.response` rows from Codex. Should it create/update rows in `sessions/session_events`, or only create `memory_candidates(scope=session)` for a later Session Curator?
- Options:
  - A. Candidate-only now - do not write `sessions/session_events`; let a later Session Curator decide. Safest boundary, but status/session recall stays disconnected.
  - B. Write existing `sessions/session_events` directly - makes session recall useful faster, but the existing event kinds may not represent hook-derived continuity correctly.
  - C. Create session candidates and only link to existing sessions when an explicit Myelin session id exists. Balanced, but adds linking logic.
- Recommendation: A for the first slice. Treat existing session tables as a separate surface until the Session Event Contract is redesigned.
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Not needed unless a new session-candidate term is introduced.
- ADR impact: Not needed unless direct session writes are chosen.
- Follow-ups:

### Question 6: No-Op And Rejection Recording

- Status: Open
- Branch type: Risk
- Why it matters: Most raw hook rows may not be useful. We need a terminal record for processed rows without flooding the candidate queue with rejected noise.
- Scenario probe: A captured prompt says "thanks" or an assistant answer is empty/low-signal. Does drain create a rejected candidate, only a tombstone with `terminal_decision=no-op`, or leave the raw row for future processing?
- Options:
  - A. Tombstone-only no-op - keeps the candidate queue clean; no-op evidence remains minimal.
  - B. Rejected candidate plus tombstone - maximally auditable, but floods review surfaces.
  - C. Leave low-signal rows raw until a better classifier exists - avoids premature decisions, but raw log never drains cleanly.
- Recommendation: A. Use tombstone-only no-op for low-signal rows; reserve rejected candidates for things a human explicitly rejects from the queue.
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Not needed.
- ADR impact: Not needed unless auditability requirements change.
- Follow-ups:

### Question 7: Default Trigger Mode

- Status: Open
- Branch type: Initial
- Why it matters: The roadmap names `off`, `queue`, and `auto`. This slice must decide whether drain defaults to creating candidates or only previews work.
- Scenario probe: The operator runs `myelin memory drain class-kit` with no flags after a productive Codex session. Should it write pending candidates, preview only, or require `--mode queue`?
- Options:
  - A. Default `queue` - useful by default and still safe because candidates are not trusted memory.
  - B. Default `off`/dry-run - safest, but makes the product feel inert after capture.
  - C. Require explicit `--mode queue` or `--apply` - no-surprise writes, but more ceremony for a local-only queue.
- Recommendation: A. Default to `queue`, with `--dry-run` for preview and `auto` explicitly non-promotional in this slice.
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Not needed; Auto Mode already exists.
- ADR impact: Candidate later only if default write behavior is controversial.
- Follow-ups:

### Question 8: Public Ingest Orchestrator Shape

- Status: Answered
- Branch type: Follow-up
- Why it matters: The user clarified that one public command may be the right product shape. We still need decide whether that command is a single fixed pipeline or a stage-addressable orchestrator. This affects CLI design, implementation chunking, retry behavior, and future source ingest.
- Scenario probe: `class-kit` has three kinds of evidence ready: raw Codex Experience Log rows, a newly bootstrapped repo snapshot, and later a saved source/inbox item. The operator runs `myelin ingest class-kit`. Should Myelin run every eligible ingest stage, or should the operator explicitly choose `--source experience-log` for this slice?
- Options:
  - A. Single public orchestrator with stage/source flags - `myelin ingest <key>` can run the default eligible pipeline, while `--source experience-log` or similar scopes work for tests/retries. More flexible and still one product command.
  - B. Single fixed pipeline only - `myelin ingest <key>` always runs all enabled stages in order. Simpler UX, but harder to retry one stage and risky before source ingest is designed.
  - C. Keep subcommands hidden behind aliases - expose `myelin ingest <key>` for normal use, but also expose low-level commands like `memory drain` for operators. Powerful, but risks fragmenting the product vocabulary.
- Recommendation: A. Use one public `myelin ingest <key>` orchestration command with explicit stage/source flags for bounded retries and implementation safety. Internals can stay modular without becoming separate product vocabulary.
- Answer: Option B. `myelin ingest <project-key>` should be a single fixed public pipeline, not a stage/source-selectable command. The user intent is not "run a source-specific drain"; it is "start the agentic ingest workflow for this project." The workflow itself can inspect raw captured data, existing Session/Project/Practice/Personal memory, and invoke downstream layer agents as needed.
- Answer impact: Changes model
- Spec impact: Updated the spec to remove source-selection flags and describe `myelin ingest` as a fixed bounded agentic pipeline. Internal stages remain modular but are not user-selectable product vocabulary.
- Context impact: Candidate later - `Ingest Command` should be updated after the command vocabulary is fully settled, because this changes it from queued-source processing to the project evidence-to-Session-Memory pipeline.
- ADR impact: Candidate later - likely ADR-worthy because it redefines ingest as the public agentic self-growth command.
- Follow-ups: The next highest-risk branch is the cascade safety envelope: stopping rules, bounded agent invocation, and durable handoff records.

### Question 9: Agentic Cascade Safety Envelope

- Status: Answered
- Branch type: Follow-up
- Why it matters: `myelin ingest` is now a fixed agentic self-growth pipeline. Without explicit stopping rules, a session-memory agent could keep invoking project/practice/personal agents recursively, making the run expensive, hard to review, and hard to retry safely.
- Scenario probe: The Session Memory ingest agent reads a Supabase-auth conversation in `class-kit`. It decides there is a session continuity update, a possible Project Memory update, and maybe a Practice Memory candidate. Should it directly invoke downstream layer agents in the same run, or write handoff candidates for later runs/review?
- Options:
  - A. One-hop cascade per ingest run - Session Memory agent may create Session Memory output and enqueue downstream Project/Practice/Personal candidates, but does not execute downstream agents in the same run. Safest and easiest to audit; slower self-growth.
  - B. Bounded multi-agent cascade in one run - Session Memory agent may invoke downstream layer agents immediately, with fixed max depth, max agents, max tokens/time, and required terminal records. More autonomous; harder to test and review.
  - C. Review-gated cascade - Session Memory agent creates downstream candidates, and only low-risk Project Memory work can auto-run; Practice/Personal always wait for review. Balanced, but more policy complexity.
- Recommendation: A for the first version. Let `myelin ingest` create Session Memory output and downstream candidates, but do not execute downstream layer agents in the same run yet. This preserves the self-growing architecture while keeping the first implementation auditable.
- Answer: Option A confirmed for now. The user noted that "cascade" may be the wrong framing: the shape is more like a reverse tree/layer handoff graph. Session Memory is first; Session can create handoffs for other layers, and those layers may later create handoffs for other layers. For the first version, keep it one-hop until Myelin proves it creates viable outputs.
- Answer impact: Changes model
- Spec impact: Replaced cascade language with a one-hop layer handoff model. One `myelin ingest` run creates Session Memory output and downstream handoff candidates only; it does not execute downstream layer agents in the same run.
- Context impact: Candidate later - "Layer Handoff" may become a glossary term, but the exact language is still being tested.
- ADR impact: Candidate later - likely ADR-worthy once final because the first-version one-hop limit is a durable safety decision.
- Follow-ups: Next question should resolve whether Session Memory output is trusted/written directly or represented as Session Memory candidates first.

### Question 10: Session Memory Output Trust Boundary

- Status: Answered
- Branch type: Follow-up
- Why it matters: We have agreed that `myelin ingest` turns Experience Log into Session Memory first. The remaining design choice is whether Session Memory is a trusted output of the ingest agent or whether it still lands as a candidate requiring later review. This affects schema, UX, status recall, and tombstone output references.
- Scenario probe: A ClassKit Codex session contains ten captured turns. The Session Memory ingest agent summarizes them as "Discussed Supabase Auth; next action is implement auth callback; no code changed yet." Should that summary be written as Session Memory immediately, or queued as a `scope=session` candidate?
- Options:
  - A. Write Session Memory directly - Session Memory is the first interpreted memory layer and becomes useful immediately for status/current briefing; risk is that an agent summary becomes trusted without review.
  - B. Queue Session Memory candidates first - safest and consistent with higher-layer candidates; but the product still has no useful memory until another review/apply step runs.
  - C. Write low-risk Session Memory directly, queue ambiguous/risky summaries - useful by default while keeping a review gate for uncertainty; requires risk classification and clear rules.
- Recommendation: C. Treat Session Memory as the first memory layer that can be written by ingest, but require the agent to mark ambiguous/high-risk outputs as candidates instead of trusted Session Memory.
- Answer: C.
- Answer impact: Confirms branch
- Spec impact: Added a Session Memory trust boundary. `myelin ingest` may write low-risk Session Memory directly, but ambiguous, broad, conflicting, privacy-sensitive, or high-risk summaries must become `scope=session` candidates.
- Context impact: Not needed unless this creates a new named Session Memory state.
- ADR impact: Candidate later - this may be ADR-worthy because it defines the first trusted agent-written memory boundary.
- Follow-ups: Next question should define the durable shape of direct Session Memory output: whether it uses existing `sessions/session_events`, a new session summary table, or project-local files.

### Question 11: Direct Session Memory Storage Shape

- Status: Answered
- Branch type: Follow-up
- Why it matters: We decided low-risk Session Memory can be written directly. Now the design needs a concrete storage target. The repo already has `sessions` and `session_events`, but those tables currently represent manual sessions and event logs, not agent-written session summaries from raw capture.
- Scenario probe: `myelin ingest class-kit` processes a captured ClassKit discussion and produces: "Discussed Supabase Auth; no code changed; next action is implement auth callback." Where should that trusted Session Memory live so `status`, current briefing, and future agents can use it?
- Options:
  - A. Reuse existing `sessions` / `session_events` - fastest path and aligns with existing SQLite session commands; may require adapting event kinds and distinguishing manual vs ingested sessions.
  - B. Add a new `session_memories` table - cleaner semantic boundary for agent-written summaries; adds schema and requires later integration with existing session commands/status.
  - C. Write project-local markdown session summaries under `projects/<key>/wiki/sessions/` - human-readable and status already has some file lookup behavior; risks making generated session continuity look like curated wiki content too early.
- Recommendation: B. Add a dedicated `session_memories` table for agent-written Session Memory, then later bridge status/current briefing to it. Keep `sessions/session_events` as the manual session surface until we intentionally merge them.
- Answer: B confirmed. Session Memory is written directly to SQLite in its own `session_memories` table.
- Answer impact: Low-risk agent-written Session Memory does not reuse raw Experience Log rows, existing manual session/event tables, or project wiki markdown. Future MCP/query surfaces can retrieve Session Memory from SQLite, with embeddings/indexing added as retrieval support rather than as the canonical memory record.
- Spec impact: Add a Direct Session Memory Storage section and update the data-home mapping.
- Context impact: Update relationships to name `session_memories` as the canonical SQLite home for trusted Session Memory.
- ADR impact: Candidate later - may be ADR-worthy because this separates raw capture, manual session events, and trusted agent-written Session Memory.
- Follow-ups: Decide whether embeddings live in a companion SQLite table/vector index in this slice or are deferred until the MCP/query retrieval design.

### Question 12: Myelin Data Layout And Memory-Layer Homes

- Status: Answered
- Branch type: Follow-up
- Why it matters: We are about to design Session Memory ingest on top of a repo that already has `projects/<key>/{sources,wiki,schema,state,log,runs}`, root `state/memory.db`, root `raw/`, root `concepts/`, and stage/runtime folders. If we do not clarify which folders represent storage layers versus memory types, future agents may scatter Session, Practice, and Personal Memory into inconsistent places.
- Scenario probe: `myelin ingest class-kit` creates low-risk Session Memory, a Project Memory handoff, a possible Practice Memory handoff about Supabase Auth, and a possible Personal Memory handoff about Liad preferring Supabase. Which data homes should receive those outputs?
- Options:
  - A. Keep current storage-layer layout and map memory types onto stores - Session/Experience/candidates stay in root SQLite; Project Memory stays in `projects/<key>/wiki`; project sources stay in `projects/<key>/sources`; generated project state stays in `projects/<key>/state`; Practice/Personal canonical homes are added only when promotion is designed. Lowest churn, but leaves Practice/Personal homes unresolved for a bit longer.
  - B. Add first-class root memory-type folders now - for example `practice/` or `practices/` and `personal/`, while keeping Session/Experience in SQLite and Project Memory under `projects/<key>/wiki`. Makes the five-layer model visible in the filesystem, but risks premature taxonomy before real promoted examples exist.
  - C. Reorganize projects around memory-type folders - for example `projects/<key>/memory/{project,session,experience,candidates}` plus root `practice/` and `personal/`. Most explicit, but conflicts with current V2 project layout, ADRs, and implemented bootstrap.
- Recommendation: A with a deliberate near-term note for B. Keep the implemented V2 storage-layer layout for this slice; do not reorganize `projects/<key>`. Design Session Memory in SQLite now, Project Memory under `wiki/`, and defer canonical Practice/Personal folders until their promotion designs need them.
- Answer: A confirmed. Keep the current storage-layer layout as the stable substrate and map memory types onto stores instead of reorganizing folders around memory types.
- Answer impact: Resolves the architecture-layout branch for this slice. Experience Log, Session Memory, and candidate/handoff state stay in root SQLite. Project Memory stays under `projects/<key>/wiki/` with supporting project state, sources, logs, and runs. Practice and Personal canonical homes are deferred until promotion designs.
- Spec impact: Add an Architecture / Data Homes section that documents the memory-type-to-storage mapping.
- Context impact: Update relationships to clarify that memory types and storage layers are separate axes.
- ADR impact: Not needed now because this preserves the implemented bootstrap layout and existing ADR direction. A later ADR may be needed when Practice or Personal canonical homes are introduced.
- Follow-ups: Return to Question 11 to decide the concrete trusted Session Memory storage table.

### Question 13: Session Memory Retrieval Index Scope

- Status: Answered
- Branch type: Follow-up
- Why it matters: Session Memory will live in SQLite, and the intended future MCP/query surface should retrieve relevant session memories by meaning, not only exact text. The user provided `sqlite-vec` and Gemini embeddings documentation, and wants SQLite VEC as the vector backend. The remaining scope decision is whether vectorization is part of this ingest slice or the next retrieval/MCP slice.
- Scenario probe: `myelin ingest class-kit` writes a trusted Session Memory row: "Discussed Supabase Auth; next action is implement auth callback." Later an agent asks: "What did we decide about auth in ClassKit?" Should this first implementation already create a vector row so a future query can semantically retrieve it, or should it only write `session_memories` and leave vector generation for the retrieval tool implementation?
- Options:
  - A. Build SQLite VEC indexing in this slice - create `session_memory_embeddings` or `vec0` storage now, generate Gemini embeddings during ingest, and keep retrieval ready for MCP. Most complete, but adds network/provider/API-key and vector-extension failure modes to the first ingest workflow.
  - B. Choose SQLite VEC now, but defer embedding generation to the MCP/query retrieval slice - document `sqlite-vec` as the selected backend and design `session_memories` to be indexable later. Keeps ingest focused and avoids making successful memory writes depend on embeddings.
  - C. Add an internal retrieval adapter now with a non-vector fallback - create the facade and adapter boundary now, use plain SQLite/FTS fallback first, and add SQLite VEC behind it later. Strong boundary, but may add abstraction before there is a live retrieval command.
- Recommendation: B. Record SQLite VEC as the selected retrieval backend behind a stable Session Memory query facade, but do not make `myelin ingest` depend on embedding generation yet. Ingest should write canonical `session_memories`; a later MCP/query slice can add Gemini embedding generation, vector tables, backfill, and semantic retrieval.
- Answer: B confirmed. SQLite VEC is the selected retrieval direction from the start, but embedding generation and vector-index maintenance are deferred to the later MCP/query retrieval slice.
- Answer impact: Resolves the retrieval scope branch. `myelin ingest` writes canonical `session_memories` that are designed to be embedded later, but ingest success does not depend on Gemini embeddings, SQLite extension loading, vector table writes, or network/API-key availability.
- Spec impact: Update the Session Memory Retrieval Facade section to name SQLite VEC as selected while deferring vector generation, backfill, exact table shape, and query behavior.
- Context impact: Already updated with the Session Memory Query Facade relationship. No additional glossary term needed until the retrieval slice names the exact facade/tool contract.
- ADR impact: Candidate later - likely ADR-worthy in the retrieval/MCP slice because SQLite VEC is pre-v1 and should remain behind a stable facade.
- Follow-ups: The next design branch should resolve ingest batching/cardinality: how raw Experience Log rows are grouped into one or more Session Memory records and downstream candidates.

### Question 14: Layer Handoff Instruction Shape

- Status: Answered
- Branch type: Follow-up
- Why it matters: We renamed downstream outputs from hints to layer handoff instructions. That makes them stronger than informal notes: future Project, Practice, and Personal layer agents will use them as prompts/input. The design needs to decide whether these instructions are free-form prompts, structured records, or both.
- Scenario probe: A Session Memory agent reads a ClassKit conversation about Supabase Auth and writes a Session Memory item. It also thinks Project Memory may need to know that ClassKit uses Supabase, and Practice Memory may later learn an approved Supabase Auth implementation pattern. What should the downstream record contain so those later agents know what to read/query/fetch without treating the handoff as truth?
- Options:
  - A. Free-form prompt text only - easiest for downstream agents to use immediately, but harder to validate, dedupe, query, and audit.
  - B. Structured instruction only - best for validation and dedupe, with fields like target scope, objective, source refs, suggested reads/queries, and reason; may be less natural for agent prompts.
  - C. Structured instruction plus prompt text - stores machine-readable fields and a generated agent prompt/input. Most useful and auditable, but more schema and validation work.
- Recommendation: C. Use a structured layer handoff instruction with an optional/required prompt text field. The structured fields protect traceability and dedupe; the prompt text gives the downstream layer agent a clean starting input.
- Answer: C confirmed. A Layer Handoff Instruction stores structured machine-readable fields plus prompt text for the downstream layer agent.
- Answer impact: Confirms branch
- Spec impact: Added the Layer Handoff Instruction payload shape: target layer/scope, objective, source Session Memory ids, source event/tombstone references, suggested reads/queries/fetches/comparisons/verifications, reason, confidence/risk, status, and prompt text.
- Context impact: Updated - the Layer Handoff Instruction relationship now says it includes structured fields plus prompt text.
- ADR impact: Candidate later - may be ADR-worthy if this becomes the long-term cross-layer contract.
- Follow-ups: Added Question 15 to decide whether Layer Handoff Instructions are a subtype of Memory Candidate or a separate table/queue.

### Question 15: Layer Handoff Instruction Storage Boundary

- Status: Open
- Branch type: Follow-up
- Why it matters: We now know a Layer Handoff Instruction is structured plus prompt text. The remaining schema boundary is whether it is stored as a `memory_candidates` subtype or in a dedicated handoff table/queue. This affects dedupe, review UI/CLI, downstream agent routing, and whether "candidate" means "proposed memory update" or "work input for another layer agent."
- Scenario probe: `myelin ingest class-kit` writes a Session Memory row and creates two downstream records: one for Project Memory to investigate whether ClassKit uses Supabase, and one for Practice Memory to later inspect an implemented Supabase Auth pattern. Should those records appear in `myelin memory candidates` as candidates, or should they live in a separate `layer_handoff_instructions` queue for layer agents?
- Options:
  - A. Store handoff instructions as `memory_candidates` rows - one queue and one review surface; simpler, but overloads "candidate" with both proposed memory and downstream work instructions.
  - B. Store handoff instructions in a dedicated table/queue - cleaner semantic boundary and better layer-agent routing; adds another table and CLI/API surface.
  - C. Store them in a shared work-items table with typed item kinds - flexible for future workflows, but risks designing a generic task system too early.
- Recommendation: B. Use a dedicated `layer_handoff_instructions` table/queue. Memory Candidates should stay proposed memory outputs; Layer Handoff Instructions should be inputs for later layer agents.
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Candidate later - may update Memory Candidate and Layer Handoff Instruction relationships after the boundary is decided.
- ADR impact: Candidate later - may be ADR-worthy if it separates candidate review from layer-agent work queues.
- Follow-ups:
