# Experience Log Drain And Memory Candidate Queue Design Agenda

## Status

- Spec: `spec.md`
- State: Complete
- Completion gate:
  - Live agenda questions resolved: Yes
  - Pressure test complete: Yes
  - Spec finalized: Yes

## Documented Decisions

- Experience Log is raw captured evidence, not truth.
- Pulled raw Experience Log rows move into Experience Log Tombstones as the queue-drain audit trail, and tombstones are finalized when the ingest job completes.
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
- Context impact: Updated - `Ingest Command` now describes bounded agentic project evidence processing.
- ADR impact: Created - ADR 0056 records the detached target-repo ingest-agent boundary.
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
- ADR impact: Not needed - layer handoff shape is captured in the spec and glossary; future promotion slices can add ADRs if they harden higher-layer contracts.
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

- Status: Answered
- Branch type: Risk
- Why it matters: Raw Experience Log rows may include sensitive prompts or full assistant answers. Candidate records need enough evidence for review, but duplicating raw text undermines the tombstone/retention model.
- Scenario probe: After drain, the raw row is tombstoned and deleted. The candidate reviewer opens a Project candidate. Should they see the full captured assistant answer, a short excerpt, a generated summary, or only a tombstone/source reference?
- Options:
  - A. Full raw text in candidate - easiest to review, but duplicates sensitive raw capture and weakens raw deletion.
  - B. Short excerpt plus metadata/reference - reviewable enough for many cases, lower retention risk, but may require looking up preserved evidence for hard cases.
  - C. No raw text, only structured summary and tombstone reference - best retention boundary, but weak for candidate review unless summary quality is trusted.
- Recommendation: B. Keep a bounded excerpt and structured metadata for pending candidates; delete full raw row through tombstone after the candidate exists.
- Answer: B extended. Memory Candidates and Layer Handoff Instructions should keep bounded excerpts plus structured metadata/source references, but the first-contact Session Memory agent may also generate rich downstream input: prompt text, objectives, suggested reads/queries/fetches, and reasoning about what the next layer agent should investigate.
- Answer impact: Introduces branch
- Spec impact: Added a Retention Boundary For Derived Inputs section and expanded the Layer Handoff Model with the Supabase OAuth example: the Session Memory agent can create Project, Practice, and Personal handoff inputs based on raw evidence plus Myelin retrieval, without duplicating full raw transcripts.
- Context impact: Not needed - bounded evidence retention is a policy detail in this spec, not a glossary term yet.
- ADR impact: Not needed - retention is documented in the spec; it can receive a dedicated ADR if later slices broaden it beyond this ingest workflow.
- Follow-ups: Added Question 16 because the answer mentions separate layer inputs/tables, which may conflict with or refine the current single `layer_handoff_instructions` table with `target_scope`.

### Question 5: Relationship To Existing Session Tables

- Status: Skipped
- Branch type: Dependency
- Why it matters: The repo already has `sessions` and `session_events`, but the new hook-derived Session Memory candidate shape may not match those manual session event kinds. Connecting too early could distort both systems.
- Scenario probe: Drain sees a `session.start`, several `user.prompt`, and `assistant.response` rows from Codex. Should it create/update rows in `sessions/session_events`, or only create `memory_candidates(scope=session)` for a later Session Curator?
- Options:
  - A. Candidate-only now - do not write `sessions/session_events`; let a later Session Curator decide. Safest boundary, but status/session recall stays disconnected.
  - B. Write existing `sessions/session_events` directly - makes session recall useful faster, but the existing event kinds may not represent hook-derived continuity correctly.
  - C. Create session candidates and only link to existing sessions when an explicit Myelin session id exists. Balanced, but adds linking logic.
- Recommendation: A for the first slice. Treat existing session tables as a separate surface until the Session Event Contract is redesigned.
- Answer: Skipped as obsolete. Later decisions selected a dedicated `session_memories` table for trusted agent-written Session Memory, so hook-derived Session Memory does not write into existing `sessions/session_events` in this slice.
- Answer impact: Obsoletes branches
- Spec impact: No new change needed; the Direct Session Memory Storage section already separates `session_memories` from existing manual session tables.
- Context impact: Not needed; `session_memories` relationship is already recorded.
- ADR impact: Not needed unless a future design intentionally merges manual session events and agent-written Session Memory.
- Follow-ups:

### Question 6: No-Op And Rejection Recording

- Status: Answered
- Branch type: Risk
- Why it matters: Most raw hook rows may not be useful. We need a terminal record for processed rows without flooding the candidate queue with rejected noise.
- Scenario probe: A captured prompt says "thanks" or an assistant answer is empty/low-signal. Does drain create a rejected candidate, only a tombstone with `terminal_decision=no-op`, or leave the raw row for future processing?
- Options:
  - A. Tombstone-only no-op - keeps the candidate queue clean; no-op evidence remains minimal.
  - B. Rejected candidate plus tombstone - maximally auditable, but floods review surfaces.
  - C. Leave low-signal rows raw until a better classifier exists - avoids premature decisions, but raw log never drains cleanly.
- Recommendation: A. Use tombstone-only no-op for low-signal rows; reserve rejected candidates for things a human explicitly rejects from the queue.
- Answer: A confirmed. Low-signal processed rows get a tombstone-only no-op decision.
- Answer impact: Resolves branch
- Spec impact: Clarify that `rejected` is a queue outcome, not the representation for low-signal no-op rows. Low-signal no-op rows are terminalized through `experience_event_tombstones`.
- Context impact: Not needed; this is a lifecycle detail of Experience Log processing.
- ADR impact: Not needed unless auditability requirements change.
- Follow-ups:

### Question 7: Default Trigger Mode

- Status: Answered
- Branch type: Initial
- Why it matters: The roadmap names `off`, `queue`, and `auto`, but this design now uses explicit `myelin ingest <project-key>` as the agentic processing command. We need decide whether the default command writes Session Memory, tombstones, and handoff inputs, or only previews work.
- Scenario probe: The operator runs `myelin ingest class-kit` with no flags after a productive Codex session. Should it write trusted low-risk Session Memory, tombstones, and layer handoff inputs by default; preview only; or require an explicit apply flag?
- Options:
  - A. Default write mode - `myelin ingest <key>` writes Session Memory, no-op tombstones, candidates, and handoff inputs by default; `--dry-run` previews. Useful by default, but the command is side-effectful.
  - B. Default dry-run/off mode - safest, but makes the product feel inert after capture and forces ceremony before Myelin becomes useful.
  - C. Require explicit `--apply` - no-surprise writes, but adds ceremony to the main local workflow.
- Recommendation: A. `myelin ingest <key>` should be explicitly side-effectful by default because the operator chose to run ingestion. Keep `--dry-run` for preview, and keep background/automatic ingest out of scope.
- Answer: Option A, with an important model change. The user does not want a dry-run-centered or foreground command. `myelin ingest <project-key>` should start a background/headless LLM provider session, return immediately, and provide a session id or handle for follow-ups if the operator needs them.
- Answer impact: Changes model
- Spec impact: Updated the trigger model and user-facing behavior so `myelin ingest` is an explicit detached/background agentic job, not a foreground preview/apply command. Removed `--dry-run` as a required first-version behavior and introduced an ingest job/session handle.
- Context impact: Updated - the `Ingest Command` glossary entry and relationships now distinguish explicit detached ingest jobs from `Auto Mode`.
- ADR impact: Created - ADR 0056 records explicit detached agentic ingest as the main write path.
- Follow-ups: Added Question 18 to define the lifecycle contract for detached ingest jobs and follow-up handles.

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
- Context impact: Updated - `Ingest Command` now describes bounded agentic evidence processing.
- ADR impact: Created - ADR 0056 records the public detached ingest model.
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
- Context impact: Updated - `Layer Handoff Instruction` is the canonical glossary term.
- ADR impact: Created - ADR 0056 records the one-hop detached ingest boundary for this slice.
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
- ADR impact: Not needed - direct Session Memory trust rules are policy in this spec and remain bounded by existing SQLite Session Memory ADRs.
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
- ADR impact: Not needed - covered by existing SQLite Session Memory direction and the spec's storage boundary.
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
- ADR impact: Not needed now - SQLite VEC retrieval is deferred to the MCP/query retrieval slice.
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
- ADR impact: Not needed now - long-term cross-layer contract decisions belong to future layer-promotion slices.
- Follow-ups: Added Question 15 to decide whether Layer Handoff Instructions are a subtype of Memory Candidate or a separate table/queue.

### Question 15: Layer Handoff Instruction Storage Boundary

- Status: Answered
- Branch type: Follow-up
- Why it matters: We now know a Layer Handoff Instruction is structured plus prompt text. The remaining schema boundary is whether it is stored as a `memory_candidates` subtype or in a dedicated handoff table/queue. This affects dedupe, review UI/CLI, downstream agent routing, and whether "candidate" means "proposed memory update" or "work input for another layer agent."
- Scenario probe: `myelin ingest class-kit` writes a Session Memory row and creates two downstream records: one for Project Memory to investigate whether ClassKit uses Supabase, and one for Practice Memory to later inspect an implemented Supabase Auth pattern. Should those records appear in `myelin memory candidates` as candidates, or should they live in a separate `layer_handoff_instructions` queue for layer agents?
- Options:
  - A. Store handoff instructions as `memory_candidates` rows - one queue and one review surface; simpler, but overloads "candidate" with both proposed memory and downstream work instructions.
  - B. Store handoff instructions in a dedicated table/queue - cleaner semantic boundary and better layer-agent routing; adds another table and CLI/API surface.
  - C. Store them in a shared work-items table with typed item kinds - flexible for future workflows, but risks designing a generic task system too early.
- Recommendation: B. Use a dedicated `layer_handoff_instructions` table/queue. Memory Candidates should stay proposed memory outputs; Layer Handoff Instructions should be inputs for later layer agents.
- Answer: B confirmed. Layer Handoff Instructions live in a dedicated table/queue, separate from `memory_candidates`.
- Answer impact: Resolves branch
- Spec impact: Add a provisional `layer_handoff_instructions` table and clarify that `memory_candidates` stores proposed memory outputs, while handoff instructions store downstream layer-agent inputs.
- Context impact: Updated - Memory Candidate and Layer Handoff Instruction relationships now distinguish proposed memory outputs from downstream agent inputs.
- ADR impact: Not needed - separation is captured in the spec/context and can be revisited if a future review UI or agent queue changes it.
- Follow-ups: Next highest-leverage question is candidate/raw retention after raw Experience Log tombstoning.

### Question 16: Layer Handoff Queue Partitioning

- Status: Answered
- Branch type: Follow-up
- Why it matters: Question 15 separated Layer Handoff Instructions from Memory Candidates, but the current draft uses one `layer_handoff_instructions` table with `target_scope`. The latest Supabase OAuth example describes "3 different tables for 3 different layers." We need decide whether that is literal physical storage or a conceptual separation by target layer.
- Scenario probe: The Session Memory agent creates three downstream inputs from one ClassKit Supabase OAuth implementation: Project input, Practice input, and Personal input. Should these be rows in one table with `target_scope`, or separate queues/tables such as `project_handoff_instructions`, `practice_handoff_instructions`, and `personal_handoff_instructions`?
- Options:
  - A. One `layer_handoff_instructions` table with `target_scope` - simplest schema and shared lifecycle, while still routing by target layer. Risk: layer-specific requirements may make the table too generic later.
  - B. Separate handoff tables per target layer - clearer ownership and layer-specific schemas from the start. Requires more schema creation/evolution work and a shared facade so table details do not leak to callers.
  - C. One base table plus layer-specific payload tables - shared lifecycle with layer-specific detail rows. Most precise, but likely too much schema for the first ingest slice.
- Recommendation: Revised to B. The earlier A recommendation over-weighted storage simplicity. If the interaction layer is functions/facades, separate tables do not imply duplicated lifecycle code or harder cross-layer queries; callers should not care which table backs a layer input.
- Answer: B confirmed. Use separate physical handoff tables/queues for Project, Practice, and Personal layer inputs.
- Answer impact: Changes model
- Spec impact: Replace the single `layer_handoff_instructions` table with separate `project_handoff_instructions`, `practice_handoff_instructions`, and `personal_handoff_instructions` tables. Add a facade/function boundary so callers and agents do not depend on physical table names.
- Context impact: Update the Layer Handoff Instruction relationship to clarify separate layer queues behind function/facade access.
- ADR impact: Not needed - separate queues are implementation-facing persistence detail behind functions/facades for this slice.
- Follow-ups: Added Question 17 to decide whether handoff creation functions should be generic or layer-specific.

### Question 17: Layer Handoff Function Boundary

- Status: Answered
- Branch type: Follow-up
- Why it matters: We chose separate physical queues per target layer, and the user emphasized that the interaction layer is functions. The next boundary is whether callers use one generic function with a target layer argument, or explicit layer-specific functions that map to the separate queues.
- Scenario probe: The Session Memory agent decides to create Project, Practice, and Personal handoff inputs from a Supabase OAuth implementation. Should it call one function like `createLayerHandoff({ target: "practice", ... })`, or separate functions like `createProjectHandoff(...)`, `createPracticeHandoff(...)`, and `createPersonalHandoff(...)`?
- Options:
  - A. One generic create/list function with target layer - least API surface and easiest shared implementation, but keeps the caller responsible for target-specific payload correctness.
  - B. Layer-specific functions backed by shared helpers - clear domain intent for agents and future MCP tools, while shared helpers avoid duplicated lifecycle code.
  - C. Both generic and layer-specific functions now - flexible, but risks two ways to do the same thing before downstream agents exist.
- Recommendation: B. Expose layer-specific functions/facades backed by shared lifecycle helpers. This matches separate tables while keeping implementation reuse and clean agent-facing contracts.
- Answer: B with corrections. The external MCP/API layer should expose one scoped tool/interface with arguments such as `scope` and input payload. Internally, that tool calls Myelin functions. The DB layer can use separate Project/Practice/Personal handoff tables, and the functions/logic/processor layer can expose layer-specific functions backed by shared helpers.
- Answer impact: Changes model
- Spec impact: Added an Architecture Layers section distinguishing DB, functions/logic/processor, query, and MCP/CLI/API layers. Added the rule that external interfaces can be one scoped tool while internal handoff functions remain layer-specific and shared-helper backed.
- Context impact: Not needed - exact function and MCP tool names are deferred to the interface slice.
- ADR impact: Not needed now because this is a layering clarification inside the current design; exact MCP tool naming is deferred.
- Follow-ups: The next highest-leverage question is no-op/terminal decision persistence for processed Experience Log rows that create no Session Memory or handoff output.

### Question 18: Detached Ingest Job Lifecycle

- Status: Answered
- Branch type: Follow-up
- Why it matters: Question 7 changed `myelin ingest` from a foreground command into a detached background/headless provider session. The design now needs a lifecycle contract so operators can tell whether ingest is running, finished, failed, retryable, or needs follow-up without waiting on the agent.
- Scenario probe: The operator runs `myelin ingest class-kit`, gets an id back, closes the terminal, and returns later. The provider session may have written Session Memory, created handoff instructions, failed halfway through, or asked for operator clarification. What durable state should Myelin expose for that run?
- Options:
  - A. Minimal provider-session handle only - return the provider session id and rely mostly on provider logs/follow-up. Fastest to ship, but Myelin cannot reliably report ingest status or recover from partial failures.
  - B. Myelin-owned ingest job plus provider session id - create an `ingest_jobs` record with status, project key, provider/session id, timestamps, counts, terminal summary, and error/follow-up state. More schema, but gives Myelin reliable status, retry, and audit behavior.
  - C. Full local job runner with queue/scheduler semantics - durable jobs, retries, cancellation, concurrency limits, and worker management now. Robust, but likely too much infrastructure for the first slice.
- Recommendation: B. Store a Myelin-owned ingest job record and attach the headless provider session id to it. The CLI can return the job id/session id immediately, while later status/follow-up commands read Myelin state instead of scraping provider logs.
- Answer: B confirmed. Use a Myelin-owned ingest job plus provider session id for now, with a deliberate path to grow into a fuller local job runner/queue later if needed.
- Answer impact: Confirms branch
- Spec impact: Added `ingest_jobs` as the durable lifecycle state for detached/background ingest runs, with provider session id, status, counts, terminal summary, error/follow-up state, and retry/audit support.
- Context impact: Updated - `Detached Ingest Job` is now the canonical glossary term for this lifecycle record.
- ADR impact: Created - ADR 0056 records detached ingest with Myelin-owned lifecycle state.
- Follow-ups: Live agenda branches are resolved. Run the pressure-test pass next.

### Question 19: Session Memory Write Granularity

- Status: Answered
- Branch type: Pressure-test
- Why it matters: The design says Experience Log becomes Session Memory first, but the spec still leaves write granularity ambiguous. A detached ingest run may process many raw events: one rollup can hide useful structure, while one record per raw event can flood recall and make tombstones noisy.
- Scenario probe: A ClassKit session includes a Supabase OAuth decision, a failed callback attempt, a verified fix, and a next action. Should `myelin ingest class-kit` write one Session Memory row for the whole run, one row per captured Experience Log event, or several semantic Session Memory rows linked to the source events?
- Options:
  - A. One Session Memory row per ingest job - simplest status/readback, but too coarse for retrieval, handoff references, and future correction.
  - B. One Session Memory row per raw event - maximum traceability, but likely noisy and duplicates the raw Experience Log shape at a higher trust level.
  - C. Semantic Session Memory rows per distinct memory item - write separate rows for decisions, blockers, verification results, next actions, or continuity notes, each with source event/tombstone references. More classification work, but best matches the `session_memories.memory_kind` model.
- Recommendation: C. Treat the ingest job as a transaction/output set, not a single memory. The Session Memory agent should write bounded semantic memory items and link each item back to its source evidence.
- Answer: C extended. Myelin should not prescribe write granularity beyond giving the ingest agent the right repo context, prompt, queue tools, and memory-write/handoff tools. The agent decides what Session Memory and higher-layer handoff inputs to create from the whole pulled batch. `myelin ingest` must run the agent with cwd set to the target repo, on `master` for this version, and the agent should pull Experience Log rows in batches until the queue is empty. Myelin can later deploy multiple agents in parallel based on queue size, with each agent aware of the parallel run count and able to observe memory created by other agents through Myelin tools.
- Answer impact: Changes model
- Spec impact: Updated the ingest model so Myelin optimizes agent context and tools instead of managing memory granularity. Added target-repo cwd/master requirement, agent-driven batch pulls, MCP/tool-first queue access, and deferred parallel-agent optimization.
- Context impact: Updated - `Detached Ingest Job` now records target-repo cwd and `master` execution for v1.
- ADR impact: Created - ADR 0056 records agent-owned memory creation from target repo context.
- Follow-ups: Added Question 20 for pull/tombstone lifecycle semantics, and Question 21 for parallel ingest partitioning.

### Question 20: Pull-To-Tombstone Lifecycle

- Status: Answered
- Branch type: Pressure-test
- Why it matters: The user wants Myelin to remove raw rows from the active queue automatically when an ingest agent pulls them, using tombstones as the audit trail. If that tombstone is recorded as a terminal no-op too early, a crashed or stalled agent can silently make unprocessed evidence look intentionally ignored.
- Scenario probe: An ingest agent pulls 500 ClassKit Experience Log rows, Myelin removes them from `experience_events`, creates tombstone records, and then the provider session crashes before creating any Session Memory or handoff input. Should those tombstones say `no-op`, `claimed/pulled`, or something else?
- Options:
  - A. Immediate terminal no-op tombstone on pull - simplest queue drain and matches the idea that the agent may do nothing, but it conflates "agent pulled this" with "agent intentionally found no memory value."
  - B. Claimed/pulled tombstone on pull, terminalized automatically at job completion - raw rows leave the active queue immediately, while Myelin can still distinguish pulled-but-unprocessed, output-linked, no-output, and failed job outcomes.
  - C. Keep raw rows until the agent explicitly finalizes them - safest audit semantics, but forces the agent to manage bookkeeping that Myelin can automate.
- Recommendation: B. On pull, Myelin should atomically move rows out of the active queue into tombstones with a non-terminal `claimed` or `pulled` state tied to the ingest job/agent. At job completion, Myelin can automatically mark remaining claimed rows as `no_output` or equivalent, and mark failed jobs as retryable/recoverable without losing audit clarity.
- Answer: B confirmed with simplicity constraint. Pulling rows should move them into tombstones with as much audit/source data as Myelin needs, and job completion should finalize the tombstone data. This should stay simple queue bookkeeping, not a prominent or heavyweight recovery subsystem.
- Answer impact: Confirms branch
- Spec impact: Updated pull-to-tombstone lifecycle so pull atomically moves rows out of the active Experience Log queue into tombstones, and job completion finalizes their terminal state/output references.
- Context impact: Updated - `Experience Log Tombstone` now covers pulled/claimed audit records that are finalized later.
- ADR impact: Created - ADR 0056 includes Myelin-owned pull/tombstone bookkeeping as part of detached ingest.
- Follow-ups: Continue to Question 21 on parallel ingest partitioning.

### Question 21: Parallel Ingest Partitioning

- Status: Answered
- Branch type: Pressure-test
- Why it matters: The user introduced future parallel ingest agents for large queues. The spec needs to avoid blocking that path, but first-version implementation may not need the full scheduler.
- Scenario probe: A session creates 5,000 Experience Log rows. Myelin may start 10 ingest agents with 500 rows each, and each agent can query Myelin while other agents are writing new Session Memory. How should first-version ingest partition work avoid duplicate pulls, missed rows, and conflicting outputs?
- Options:
  - A. Defer parallelism entirely - one ingest agent drains the queue now; simplest, but poor fit for very large queues.
  - B. Design first-version pull API with claim partitions but run one worker by default - enables future parallelism through atomic batch claims without building multi-worker orchestration yet.
  - C. Implement multi-agent parallelism in this slice - best for large queues immediately, but adds scheduling, concurrency, conflict, and observability complexity.
- Recommendation: B. Build the pull/claim semantics so multiple agents can safely partition work later, but default to one detached ingest agent until the basic end-to-end path is proven.
- Answer: B confirmed.
- Answer impact: Confirms branch
- Spec impact: Updated the pull/claim design so v1 runs one detached ingest agent by default, while the row-pull API atomically claims bounded batches in a way that can support future multi-agent partitioning.
- Context impact: Not needed; no new canonical term was introduced.
- ADR impact: Not needed now because parallel execution is deferred. Revisit if/when Myelin implements multi-agent ingest scheduling.
- Follow-ups: No open pressure-test questions remain.

## Pressure-Test Result

- Status: Complete
- Checked categories: lifecycle and interruption; state persistence; handoff boundaries; verification evidence; scope control; recovery paths; parallelism and sequencing; user review gates.
- Result: The pressure test added and resolved the detached ingest job lifecycle, Session Memory write-granularity boundary, pull-to-tombstone lifecycle, and first-version parallelism boundary. The spec now describes Myelin-owned detached job state, target-repo agent context, agent-owned memory creation, simple tombstone bookkeeping, and a partition-safe pull API with one worker by default.
- Remaining non-blocking risks:
  - SQLite VEC embedding/index details remain deferred to the MCP/query retrieval slice.
  - Practice and Personal canonical homes remain deferred to their promotion designs.
  - Full scheduler, retry daemon, cancellation, and multi-agent worker orchestration remain deferred until detached ingest proves it needs them.
  - External re-audit is still required before implementation planning.

## External Audit Iteration 1

- Status: Ready for Development; approved for `$pmp-writing-plans`.
- Auditor: Sub-agent `019ebf8f-3d90-78d0-b8e5-b2c1d02fc737`.
- Verdict: Needs Refinement before `$pmp-writing-plans`.
- Critical issues addressed:
  - Reconciled `MYELIN.md` so trusted agent-written Session Memory lives in `session_memories`, while `sessions` / `session_events` remain the manual session surface.
  - Reconciled command vocabulary so `project ingest <key>` remains queued source/inbox processing and top-level `ingest <key>` starts the detached Experience Log to Session Memory workflow.
  - Resolved candidate status spelling by defining stored enum values such as `needs_review`, with optional hyphenated CLI aliases normalized before query.
- Recommendations addressed:
  - Fixed command names for this design slice and named `myelin ingest status <ingest-job-id>` as the first status surface.
  - Added `--limit N` semantics: maximum claimed Experience Log rows, not output count or batch count.
  - Added non-`master` target repo behavior: create or update a failed ingest job with branch-mismatch metadata and do not pull rows.
  - Added a concrete `session_memories` table sketch.

## External Re-Audit Iteration 2

- Status: Complete.
- Auditor: Sub-agent `019ebf8f-3d90-78d0-b8e5-b2c1d02fc737`.
- Verdict: Ready for Development, interpreted as ready to proceed to `$pmp-writing-plans`.
- Remaining non-blocking note: ADR 0056 is part of the design artifact set and must be included when planning/staging the work.
- Planning guidance from audit:
  - Put schema, table contracts, and tombstone claim/finalize semantics first.
  - Keep detached provider/job orchestration separate from ingest agent prompt/tool behavior.
  - Keep top-level `ingest` separate from `project ingest`.
  - Do not create chunk plan files before roadmap approval.
