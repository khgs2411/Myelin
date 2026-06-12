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

- Status: Open
- Branch type: Initial
- Why it matters: A single user/assistant exchange can imply multiple things: session continuity, project fact, practice pattern, and personal preference. The cardinality choice affects schema, idempotency, review workload, and tombstone output references.
- Scenario probe: User asks in `class-kit`, "How do we create new users using Supabase?", and the assistant explains Supabase Auth after reading docs. This may imply session continuity, project uses Supabase, and a future practice if implementation follows. Should one raw row produce one best candidate, or several scoped candidates?
- Options:
  - A. One raw event produces at most one candidate - simple, deterministic, easier to review; risks losing legitimate multi-scope signals.
  - B. One raw event may produce multiple candidates, one per scope - captures richer meaning; requires stronger dedupe, review, and tombstone references.
  - C. One raw event produces one primary candidate plus optional linked follow-up hints - preserves simplicity while not losing signals; later processing can split hints into separate candidates.
- Recommendation: C. Start with one primary candidate plus optional follow-up hints. It keeps the first drain bounded while preserving enough signal for later Practice/Personal promotion.
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Not needed unless this introduces a named candidate relationship.
- ADR impact: Candidate later - cardinality may be durable if it shapes all future queue processing.
- Follow-ups:

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

- Status: Open
- Branch type: Follow-up
- Why it matters: `myelin ingest` is now a fixed agentic self-growth pipeline. Without explicit stopping rules, a session-memory agent could keep invoking project/practice/personal agents recursively, making the run expensive, hard to review, and hard to retry safely.
- Scenario probe: The Session Memory ingest agent reads a Supabase-auth conversation in `class-kit`. It decides there is a session continuity update, a possible Project Memory update, and maybe a Practice Memory candidate. Should it directly invoke downstream layer agents in the same run, or write handoff candidates for later runs/review?
- Options:
  - A. One-hop cascade per ingest run - Session Memory agent may create Session Memory output and enqueue downstream Project/Practice/Personal candidates, but does not execute downstream agents in the same run. Safest and easiest to audit; slower self-growth.
  - B. Bounded multi-agent cascade in one run - Session Memory agent may invoke downstream layer agents immediately, with fixed max depth, max agents, max tokens/time, and required terminal records. More autonomous; harder to test and review.
  - C. Review-gated cascade - Session Memory agent creates downstream candidates, and only low-risk Project Memory work can auto-run; Practice/Personal always wait for review. Balanced, but more policy complexity.
- Recommendation: A for the first version. Let `myelin ingest` create Session Memory output and downstream candidates, but do not execute downstream layer agents in the same run yet. This preserves the self-growing architecture while keeping the first implementation auditable.
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Candidate later - may introduce a named cascade/handoff concept if confirmed.
- ADR impact: Candidate later - cascade depth is a durable safety decision and may deserve an ADR.
- Follow-ups:
