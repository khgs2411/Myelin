# Myelin Roadmap

This is the canonical progress tracker for Myelin.

Use this file to answer "what are we doing next?" regardless of what happened in the last session. `MYELIN.md` remains the canonical product design; this file is the implementation checklist against that design.

## How To Use This Roadmap

- Read the roadmap steps from top to bottom.
- The first unchecked `next` item is the next implementation task.
- `open` items are known work, but they are not active until promoted to `next`.
- Mark completed work here when code, docs, and verification land.
- When a `next` item is complete, mark it `done` and promote the next smallest item by changing its status to `next`.
- Add new work here when a real gap appears. Do not create a second TODO, DONE, task-list, or roadmap file.
- Do not leave `open` items in a roadmap step after moving past it. Move non-blocking follow-up work into a later step.
- Keep items scoped to product behavior, not one session's conversation.
- Do not treat the dogfood Experience Log queue as something to manually finish. Every user message and assistant response adds rows. Auto-maintenance owns that loop.

Status labels:

- `done`: built and verified.
- `partial`: usable scaffold exists, but the product behavior is incomplete.
- `next`: the single active implementation task.
- `open`: known future work.
- `deferred`: intentionally not part of the current phase.

## Roadmap Step 0: Runtime Foundation

Goal: make Myelin a stable Bun/TypeScript CLI with repo-safe runtime primitives.

- [x] `done` Bun/TypeScript CLI entrypoint and command registry.
- [x] `done` Runtime helpers for repo-safe paths, JSON state, project discovery, IDs, subprocesses, and provider execution.
- [x] `done` Provider abstraction for Codex and Claude through authenticated local CLIs.
- [x] `done` `myelin.config`, `.env`, and process-env precedence.
- [x] `done` SQLite runtime selection for local vector-extension use, including vendored runtime support and macOS fallback.

Evidence: `src/cli.ts`, `src/commands/registry.ts`, `src/runtime/*`, `src/memory/sqlite-runtime.ts`, `myelin.config`

## Roadmap Step 1: Project Shell And Capture

Goal: register software repos, capture agent work, and keep discovery scoped to current projects.

- [x] `done` `myelin bootstrap <key> --repo <path>` creates a project shell.
- [x] `done` Bootstrap repairs existing project shells without deleting preserved material.
- [x] `done` `myelin project list` shows active projects by default.
- [x] `done` Project discovery routes only current active project configs by default.
- [x] `done` Capture hooks persist provider-neutral Experience Log rows for bootstrapped projects.
- [x] `done` Capture records repo path, git branch, git commit, and worktree id when available.
- [x] `done` Capture is fail-open and records hook errors instead of breaking agent workflow.

Current active projects expected in normal routing:

- `class-kit`
- `llm-wiki`
- `senshi`
- `wizepal`

Evidence: `src/commands/bootstrap.ts`, `src/commands/project.ts`, `src/runtime/projects.ts`, `src/capture/facade.ts`, `src/capture/git-context.ts`, `src/memory/experience.ts`

## Roadmap Step 2: Session Memory Layer

Goal: accurate, relevant project-scoped continuity from recent work.

- [x] `done` Top-level `myelin ingest <key>` starts detached provider-backed Experience Log to Session Memory work.
- [x] `done` Ingest uses tombstone-backed leases so raw Experience Log rows are not deleted before terminal output.
- [x] `done` Ingest writes trusted Session Memories, Memory Candidates, layer handoff instructions, supersession links, retractions, noops, and terminal tombstone state.
- [x] `done` Ingest preserves branch context as metadata and does not fail just because a repo is not on `master`.
- [x] `done` Prompt-size packing budgets instructions, leased evidence, and reconciliation context together.
- [x] `done` Session Memory writes create pending embedding metadata.
- [x] `done` `myelin memory index session <key>` indexes pending Session Memories through the active embedding contract.
- [x] `done` Query embeddings are cached.
- [x] `done` `myelin memory query <key> "<question>"` retrieves indexed active Session Memories.
- [x] `done` `memory query --branch current|<name>` filters Session Memory by branch context.
- [x] `done` Query returns explicit degraded states when sqlite-vec, embeddings, or indexed rows are unavailable.
- [x] `done` Capture can schedule auto-maintenance after enough queued Experience Log rows exist.
- [x] `done` Auto-maintenance is detached, lock-guarded, cooldown-guarded, and prevents recursive self-capture.
- [x] `done` Auto-maintenance runs ingest, waits for ingest drain, and indexes pending Session Memory embeddings.

Evidence: `src/commands/ingest.ts`, `src/ingest/*`, `src/memory/session-memories.ts`, `src/memory/candidates.ts`, `src/memory/handoffs.ts`, `src/memory/session-memory-query.ts`, `src/maintenance/auto-memory-maintenance.ts`, `src/maintenance/worker.ts`

## Roadmap Step 3: Project Memory Layer

Goal: maintain curated, human-readable project truth in `projects/<key>/wiki/` with machine-readable state and provenance.

Project Memory is the first durable curation layer. It should capture what the repo alone does not cheaply reveal: product behavior, feature intent, setup, runbooks, decisions, current state, contradictions, and provenance. It should not become a generic code summarizer, a Session Memory replacement, or a place for unverified free-form agent claims.

Step 3 is complete when `project learn <key>` can safely maintain Project Memory from bounded evidence, with validated curator output and provenance-backed markdown updates.

- [x] `done` `project learn <key>` and `project ingest <key>` exist as Phase-0 pipeline commands.
  - Why: Myelin needs stable operator verbs for broad Project Memory refresh and queued source intake before deeper curation behavior can be attached to them.
- [x] `done` Stage instructions live as data under `stages/`.
  - Why: model-facing instructions need to evolve without hard-coding every prompt into the runtime.
- [x] `done` The scaffold can run provider-backed stages and deterministic apply/validate code.
  - Why: agent judgment and deterministic safety checks need separate roles; models can propose, but code must control validation and durable writes.
- [x] `done` `project packet <key>` builds a read-only bounded Project Memory packet from project state, wiki markdown, pending project handoffs/candidates, recent Session Memory, and deterministic markdown lookup results.
  - Why: the curator needs a bounded project-specific evidence bundle instead of unbounded rediscovery or raw conversation history.
- [x] `done` Project Memory lookup reports degraded state because it is currently deterministic markdown text search, not a derived metadata/vector index.
  - Why: we need honest retrieval quality signals; weak lookup is acceptable as a temporary existence check only if it is clearly labeled.
- [ ] `partial` Evolve `project learn` from a Phase-0 pipeline scaffold into behavior-focused Project Memory maintenance.
  - Description: Treat the existing pipeline as a working shell that still needs to become the real Project Memory maintenance flow.
  - Why: the current command proves orchestration, but the product needs it to answer "what durable project knowledge changed?" and maintain the wiki accordingly.
- [ ] `next` Define the Project Memory Curator output schema and validation contract.
  - Description: Define the structured proposal format returned by the curator and the deterministic validation rules Myelin applies before any proposal can become canonical Project Memory.
  - Why: before an agent can affect durable memory, Myelin needs a strict contract for what the curator may claim, update, create, reject, or mark uncertain.
- [ ] `open` Make `project learn` use the Project Memory packet as its curator input.
  - Description: `project learn` should pass the bounded Project Memory packet to the curator as the authoritative input bundle for deciding what durable project knowledge changed.
  - Why: `project learn` should reason from the same bounded evidence contract that we can inspect, test, and reuse later for Practice and Personal Memory.
- [ ] `open` Reject invalid Project Memory Curator proposals before wiki writes.
  - Description: Curator proposals that are malformed, unsupported, out of scope, too broad, or missing provenance should stop before touching markdown.
  - Why: Project Memory is trusted by future agents, so malformed, unsupported, low-confidence, or provenance-free output must fail before it changes canonical files.
- [ ] `open` Apply bounded page updates with provenance.
  - Description: Accepted proposals should update specific wiki pages or clearly justified new pages, with traceable evidence for meaningful claims.
  - Why: accepted curation must become durable markdown, and future agents need to know where each meaningful claim came from or whether it is explicitly inferred.
- [ ] `open` Route gaps and inbox items into Project Memory candidates.
  - Description: Missing, stale, or flagged knowledge should become structured Project Memory candidate input for the curator.
  - Why: missing or stale knowledge should become structured curator input instead of accumulating in a disconnected side channel.
- [ ] `open` Build a derived Project Memory retrieval index that points back to canonical wiki files.
  - Description: Build lookup state that helps agents find relevant Project Memory pages or sections without making SQLite the source of truth.
  - Why: agents will need better Project Memory retrieval, but indexes should derive from canonical markdown rather than becoming another source of truth.
  - Shape: Project Memory remains canonical in `.md` files. SQLite/vector rows are disposable serving state that store embeddings, page or section pointers, and freshness hashes. Query uses vector hits to select relevant wiki files or sections, then answers from the markdown source.
  - Boundary: Session Memory rows are trusted memory records in SQLite; Project Memory vector rows are not trusted memory records. They are rebuildable pointers into trusted markdown.
  - Rebuild rule: if the SQLite index is missing, stale, or disagrees with markdown, markdown wins and the index should be rebuilt from wiki files.
- [ ] `open` Decide whether Current Briefing is needed after Project Memory curation and retrieval are stable.
  - Description: Revisit session-start briefing only after Project Memory and Session Memory can prove whether a separate current-state view is still useful.
  - Why: Myelin should not create another current-state surface unless Project Memory and Session Memory still leave a real session-start gap.
- [ ] `deferred` Resume Current Briefing only if Project Memory curation and retrieval prove it is still needed.
  - Description: Keep Current Briefing out of active work unless the core memory layers still need a derived session-start summary.
  - Why: Current Briefing should be a derived session-start view only if the core memory layers do not already cover that need.

Acceptance criteria for the curator-write slice:

- `project learn <key>` builds or receives the Project Memory packet.
- Curator output is JSON with a validated schema.
- Proposed markdown changes are bounded to known pages or explicit new-page requests.
- Every proposed durable memory update carries provenance or an explicit inference label.
- Tests prove invalid curator output is rejected before file writes.

Evidence: `src/commands/project.ts`, `src/project/project-memory-packet.ts`, `src/project/project-memory-lookup.ts`, `src/pipeline/runner.ts`, `stages/*`

## Roadmap Step 4: Practice Memory Layer

Goal: canonical utility, library, third-party provider, workflow, and tooling guidance derived from repeated or explicitly selected project evidence.

Practice Memory should reuse the Project Memory curation pattern after Step 3 is stable: bounded evidence, structured curator proposals, deterministic validation, canonical markdown, and derived retrieval state. The subject changes from "what is true about this project?" to "how do we use this tool, library, provider, workflow, or platform across projects?"

Example: Supabase Practice Memory should describe how we use Supabase Auth, Edge Functions, local development, migrations, storage, or vector search in general. Project-specific Supabase choices remain Project Memory and can cite or override the canonical practice.

Step 4 is complete when Myelin can maintain reusable practice guidance as canonical markdown, promote practice candidates from project evidence, retrieve the right practice for agent work, and keep project-specific exceptions separate from canonical guidance.

- [ ] `open` Design the canonical Practice Memory storage shape.
  - Description: Decide where reusable utility/library/provider/workflow guidance lives and what canonical Practice Memory files should contain.
- [ ] `open` Define the Practice Memory subject taxonomy.
  - Description: Name the supported subjects, such as third-party providers, libraries, tools, frameworks, deployment targets, local workflows, testing workflows, and platform patterns.
- [ ] `open` Define the Practice Curator output schema and validation contract.
  - Description: Reuse the Project Memory proposal model for practice guidance so accepted updates are structured, bounded, evidence-backed, and validated before markdown changes.
- [ ] `open` Define the Practice Candidate promotion path from Project/Session evidence.
  - Description: Define how repeated or explicitly selected project evidence becomes candidate material for reusable practice guidance.
- [ ] `open` Define Practice Memory evidence thresholds.
  - Description: Decide when evidence is strong enough for canonical practice guidance, when it should remain a candidate, and when it should stay project-specific.
- [ ] `open` Decide how project-specific runbooks override or cite canonical practices.
  - Description: Clarify when a project follows a shared practice, when it has a local exception, and how both are represented.
- [ ] `open` Apply approved Practice Memory updates as canonical markdown with provenance.
  - Description: Accepted practice proposals should update practice markdown and preserve the project/session evidence that justified the guidance.
- [ ] `open` Build a derived Practice Memory retrieval index that points back to canonical practice files.
  - Description: Practice retrieval should use derived SQLite/vector rows as lookup state while canonical practice guidance remains in markdown.
- [ ] `open` Integrate Practice Memory into `how` answers.
  - Description: Prescriptive questions such as "how do we use Supabase auth?" should prefer canonical Practice Memory, then project-specific runbooks or exceptions.
- [ ] `deferred` Keep automatic Practice promotion out of scope until evidence shape and manual promotion are proven.
  - Description: Avoid letting agents automatically create cross-project practices before the evidence and review boundaries are reliable.

## Roadmap Step 5: Personal Memory Layer

Goal: durable guidance about Liad's preferences and agent behavior expectations.

Personal Memory should reuse the same curation pattern as Project and Practice Memory, but with stricter evidence rules. The subject is not a project or a tool; it is durable guidance about how agents should collaborate with Liad and how Liad prefers engineering work to be approached.

Step 5 is complete when Myelin can preserve durable personal guidance as canonical markdown, distinguish explicit preferences from inferred patterns, retrieve that guidance for agent behavior, and update or retract stale preferences safely.

- [ ] `open` Design the canonical Personal Memory storage shape.
  - Description: Decide where durable personal guidance lives and what kind of preference or agent-behavior knowledge belongs there.
- [ ] `open` Define the Personal Memory subject taxonomy.
  - Description: Name the supported subjects, such as collaboration style, planning expectations, review expectations, coding preferences, communication preferences, autonomy boundaries, and agent behavior rules.
- [ ] `open` Define the Personal Curator output schema and validation contract.
  - Description: Reuse the structured proposal model while adding stricter checks for evidence quality, explicitness, applicability, and risk.
- [ ] `open` Define Personal Candidate creation from repeated corrections, explicit guidance, and observed project behavior.
  - Description: Define which signals are strong enough to become candidate personal guidance instead of one-off session notes.
- [ ] `open` Define evidence thresholds for durable Personal Memory.
  - Description: Decide which explicit user statements can become durable guidance directly, which inferred patterns require repetition, and which signals should stay temporary.
- [ ] `open` Define applicability, conflict, supersession, and retraction behavior.
  - Description: Personal preferences can change, conflict, or be context-specific, so Myelin needs a clear way to mark scope and retire stale guidance.
- [ ] `open` Avoid turning one-off session instructions into durable preferences without corroboration or explicit user intent.
  - Description: Protect Personal Memory from overfitting to a single correction, mood, task, or temporary constraint.
- [ ] `open` Apply approved Personal Memory updates as canonical markdown with provenance.
  - Description: Accepted personal guidance should update personal markdown and preserve the evidence or explicit instruction that justified it.
- [ ] `open` Build a derived Personal Memory retrieval index that points back to canonical personal files.
  - Description: Personal retrieval should use derived SQLite/vector rows as lookup state while canonical personal guidance remains in markdown.
- [ ] `open` Integrate Personal Memory into agent startup, `query`, and `how`.
  - Description: Agents should be able to retrieve relevant personal guidance when deciding how to collaborate, answer, plan, review, or choose implementation style.
- [ ] `deferred` Keep automatic Personal promotion out of scope until manual review boundaries are proven.
  - Description: Do not let agents automatically write personal preferences until the candidate and review model is trusted.

## Roadmap Step 6: Query, How, And Status Facades

Goal: small semantic interfaces over the memory layers.

Step 6 is complete when agents can use stable semantic interfaces instead of knowing the storage layout. `query` answers explanatory questions, `how` answers prescriptive workflow questions, and `status` answers structured current-state questions.

- [ ] `partial` `memory query` currently retrieves Session Memory vectors; it is not yet the full multi-layer query facade.
  - Description: Treat the current query command as a working Session Memory surface, not the final all-layer agent interface.
- [ ] `open` Define the semantic contract for `query`, `how`, and `status`.
  - Description: Specify what kind of question each facade owns, what it returns, and when it should degrade instead of guessing.
- [ ] `open` Route `query` across Project, Session, Practice, Personal, and state-backed sources.
  - Description: Make explanatory questions retrieve from the correct memory layer or layers instead of assuming one source.
- [ ] `open` Define source priority and conflict behavior.
  - Description: Decide which source wins when Project, Session, Practice, Personal, or state-backed sources disagree, and how uncertainty is reported.
- [ ] `open` Make Project, Practice, and Personal retrieval resolve back to markdown sources.
  - Description: Facade answers should use derived retrieval indexes to find canonical markdown, then answer from the source files rather than treating index rows as truth.
- [ ] `open` Implement `how` as a first-class facade for prescriptive operating guidance.
  - Description: Provide a dedicated interface for "how should I do this?" answers that prefers practices, runbooks, and preferences.
- [ ] `open` Evolve `status` into the structured current-state facade.
  - Description: Make status answer "where are we right now?" with structured project, memory, and maintenance state.
- [ ] `open` Make retrieval quality interpretable without letting scoring become the product driver.
  - Description: Expose confidence, degradation, source coverage, and uncertainty in a way agents can reason about without reducing trust to one score.
- [ ] `open` Surface candidates explicitly and label them as non-trusted.
  - Description: Let agents see relevant candidate material when useful, while making clear it is not canonical memory yet.
- [ ] `open` Keep detached MCP consuming core contracts; core logic must stay out of MCP implementation.
  - Description: Preserve the boundary where root core owns behavior and MCP remains a detached consumer of CLI/JSON contracts.
- [ ] `open` Add end-to-end fixture questions for common agent workflows.
  - Description: Maintain executable examples for questions like "what did we last work on?", "how do we use Supabase?", and "what should I know before editing this project?"

## Roadmap Step 7: Schema Layer

Goal: rules and conventions that teach agents how to maintain Myelin.

Step 7 is complete when schema rules can evolve from real memory evidence without becoming a hidden source of product truth. Schema teaches agents how to maintain memory; it does not replace Project, Practice, or Personal Memory.

- [x] `done` Global schema inputs and typed rules exist.
- [x] `done` `schema check` validates authored/global schema context.
- [x] `done` `schema build` writes generated per-project schema context.
- [ ] `open` Define what belongs in schema versus Project, Practice, and Personal Memory.
  - Description: Clarify the boundary between maintenance rules, durable knowledge, reusable practices, and personal preferences.
- [ ] `open` Define schema evidence requirements.
  - Description: Decide what kind of project or cross-project evidence is strong enough to justify changing agent-maintenance rules.
- [ ] `deferred` Project-local schema.
  - Description: Add project-specific maintenance rules only after real project divergence proves global schema is insufficient.
- [ ] `deferred` Schema overrides.
  - Description: Allow explicit, justified exceptions to global rules only after local schema needs are proven.
- [ ] `deferred` Schema candidate list/apply flows.
  - Description: Add candidate workflows for schema changes after Project, Practice, and Personal evidence paths are clearer.
- [ ] `deferred` Schema validation integration with curator workflows.
  - Description: Ensure Project, Practice, and Personal curators consume the relevant schema context and fail closed when required rules are missing or stale.
- [ ] `deferred` Global schema candidate promotion after cross-project Practice/Personal promotion exists.
  - Description: Promote global schema changes only after cross-project evidence and promotion rules exist.

Reason for deferral: ADR 0049 keeps Phase 0 thin and global-only until real divergence proves the need.

## Roadmap Step 8: Session Memory Hardening

Goal: improve Session Memory quality and operations after Project Memory has a stable curation path.

Step 8 is complete when Session Memory remains accurate across branches, retires stale continuity safely, reports maintenance failures clearly, and feeds higher memory layers without duplicating what those layers already know.

- [ ] `open` Refresh `tests/query/fixtures/llm-wiki-session-memory-quality.json` to match current live Session Memory.
  - Description: Update the quality fixture so it evaluates the current behavior rather than an older pre-auto-maintenance snapshot.
- [ ] `open` Make reconciliation lifecycle branch-scoped.
  - Description: Preserve memories from inactive branches while preventing current-branch maintenance from casually retracting or superseding them.
- [ ] `open` Define actual recent memory versus branch recent memory behavior.
  - Description: Clarify when Myelin should prioritize globally recent Session Memory and when branch-scoped continuity should win.
- [ ] `open` Keep `next_action` memories short-lived through evidence-backed lifecycle updates.
  - Description: Retire stale next actions through ingest/reconciliation evidence instead of manual queue chasing.
- [ ] `open` Avoid duplicate Project Memory candidates by checking existing Project Memory first.
  - Description: Session Memory should create Project Memory candidates only when the durable Project Memory layer does not already cover the information.
- [ ] `open` Surface `needs_review` Memory Candidates when active Session Memory is weak.
  - Description: Let query/status contexts show relevant non-trusted candidates when trusted memory is insufficient, clearly labeled as candidate material.
- [ ] `open` Define Session Memory retention and lifecycle behavior by memory kind.
  - Description: Decide how long continuity, decisions, blockers, next actions, and warnings should remain active before supersession, retraction, or archival.
- [ ] `open` Improve auto-maintenance reporting around failed ingest jobs.
  - Description: Decide whether maintenance should complete as partially degraded or fail when ingest jobs fail before indexing.
- [ ] `open` Improve status reporting for ingest, indexing, and auto-maintenance health.
  - Description: Make it easy to tell whether Session Memory is fresh, stale, partially indexed, blocked, or degraded.
- [ ] `open` Fix auto-maintenance documentation drift in `myelin.config`.
  - Description: Align the config comment with the actual default behavior in this checkout.
- [ ] `deferred` Add manual review/admin commands only as escape hatches after automated lifecycle is coherent.
  - Description: Keep manual controls out of the main path until the automated Session Memory lifecycle is reliable enough to define useful overrides.

## Always-On Guardrails

- Keep hooks fast and fail-open.
- Keep provider-backed work detached and bounded.
- Do not let auto-maintenance recursively capture its own provider sessions.
- Keep SQLite as serving/recall state, not curated truth.
- Keep markdown Project/Practice/Personal memory human-reviewable.
- Do not import root `src/` from detached MCP or MCP source from root core.
- Do not manually drain the live dogfood queue as proof of progress.

## Last Verified

- `rtk bun test` passed with 261 tests.
- `rtk bun run typecheck` passed.
- `rtk git diff --check` passed.
- `rtk bun src/cli.ts project packet llm-wiki` returned a bounded Project Memory packet for `llm-wiki`.
