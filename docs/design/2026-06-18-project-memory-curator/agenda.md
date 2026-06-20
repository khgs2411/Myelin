# Project Memory Curator Design Agenda

## Status

- Spec: `spec.md`
- State: Working Draft
- Completion gate:
  - Live agenda questions resolved: No
  - Pressure test complete: No
  - Spec finalized: No

## Documented Decisions

- Project Memory canonical truth lives in project markdown plus project state, not SQLite.
- Project Memory should be agent-facing first; markdown is for canonical auditability and occasional human confirmation, not routine operator approval.
- Bootstrap currently creates a Project Memory shell, not curated Project Memory.
- Session Memory ingest may create Project/Practice/Personal handoff instructions, but it must not mutate curated wiki pages.
- Memory Candidates target exactly one scope.
- Layer Handoff Instructions are downstream agent inputs, not trusted higher-layer memory.
- Practice Memory and Personal Memory use the same broad promotion pattern but their canonical homes and promotion rules remain deferred.
- Hooks and capture do not call LLMs and do not mutate curated memory.
- Research intake reframed Project Memory as governed evidence-backed wiki compilation over a local evidence ledger, with canonical subject pages that contain addressable entries for validation and lifecycle.
- Karpathy's LLM Wiki pattern is the product origin: immutable sources, a compounding LLM-maintained markdown wiki, and schema/instructions for agent maintenance. Myelin should preserve that essence while hardening it for autonomous coding agents.

## Questions

### Question 1: Bootstrap creation trigger

- Status: Answered
- Branch type: Initial
- Why it matters: This decides whether Project Memory creation is part of the bootstrap command contract or a separate curator workflow launched after bootstrap.
- Scenario probe: A user bootstraps ten repos on a machine with no model credentials configured. Should bootstrap still succeed quickly and leave shell state, or should it start ten degraded curator jobs?
- Options:
  - A. Shell-only bootstrap, explicit creation command later - safest contract, but creation is easy to forget.
  - B. Bootstrap always starts background Project Memory creation - matches the desired "creation phase during bootstrap", but changes bootstrap from deterministic shell creation into agentic work.
  - C. Bootstrap remains shell creation and can enqueue background creation only behind an explicit flag or project setting - preserves the shell contract while supporting one-command onboarding.
- Recommendation: C. Keep bootstrap deterministic by default, then add an explicit non-blocking creation trigger so the agentic phase is visible, inspectable, and recoverable.
- Answer: Reject A/B/C as incomplete. Use option D: keep `bootstrap` as the shell primitive, add a separate command that creates the project brain for an already bootstrapped project, and add a higher-level command that runs bootstrap plus brain creation sequentially for full onboarding.
- Answer impact: Changes model
- Spec impact: Updated Creation Mode and Integrations to distinguish shell bootstrap, brain creation, and full onboarding.
- Context impact: Candidate later - likely needs glossary terms for brain creation command and full onboarding command once names are chosen.
- ADR impact: Candidate later - command vocabulary may be ADR-worthy if it replaces or clarifies `project learn`/`project onboard`.
- Follow-ups: Add command naming question.

### Question 1A: Brain creation command names

- Status: Answered
- Branch type: Follow-up
- Why it matters: The command vocabulary has to make the three user intents obvious: register a repo shell, create initial Project Memory, and do both for a new or retroactive project.
- Scenario probe: The operator has eight existing repos. Four are not bootstrapped, four have shells but no Project Memory brain. What commands should they naturally reach for without reading the whole docs set?
- Discussion note: The user suggested keeping `bootstrap` for shell setup, using a new "create brain" command for Project Memory creation, and using `onboard` for the sequential wrapper that runs bootstrap first and then brain creation. This is under discussion, not yet a resolved decision.
- Options:
  - A. Product-memory names: keep `bootstrap` for shell, use `project learn <key>` for brain creation/maintenance, and add `project onboard <key> --repo <path>` for shell plus initial learn.
  - B. Brain vocabulary: keep `bootstrap` for shell, add `brain create <key>` for initial Project Memory, and add `brain onboard <key> --repo <path>` for shell plus brain.
  - C. Project lifecycle names: keep `bootstrap` for shell, add `project create-memory <key>` for initial Project Memory, and add `project onboard <key> --repo <path>` for shell plus memory.
- Recommendation: C, with a possible alias from `project learn <key> --initial` later. It is clearer than overloading `learn` immediately, and it avoids making `brain` a new top-level product namespace before the layer boundaries are stable.
- Answer: Use `myelin bootstrap <key> --repo <path>` for shell setup, `myelin project learn <key>` for initial Project Memory brain creation and later Project Memory maintenance, and `myelin project onboard <key> --repo <path>` for shell setup followed by `project learn`.
- Answer impact: Resolves branch
- Spec impact: Updated Creation Mode, Curator Job Model, and Integrations with the selected command vocabulary.
- Context impact: Candidate later - `project onboard` and the dual initial/maintenance role of `project learn` likely need glossary clarification when the spec is finalized.
- ADR impact: Candidate later - command vocabulary may be worth recording once the full Project Memory Curator design is complete.
- Follow-ups: None.

### Question 2: Session-to-Project duplicate check boundary

- Status: Answered
- Branch type: Initial
- Why it matters: This decides whether Session Memory ingest can reduce duplicate Project Memory work without becoming a Project Memory curator.
- Scenario probe: Session ingest sees "added Supabase OAuth setup docs" and Project Memory already has a page about auth setup. Should Session ingest suppress the handoff, create a handoff pointing at the existing page, or ask a model to decide whether the page is stale?
- Options:
  - A. No Project Memory lookup from Session ingest - cleanest layer boundary, but creates more duplicate handoffs.
  - B. Deterministic Project Memory existence lookup only - reduces obvious noise while leaving curation decisions to the Project Memory Curator.
  - C. Full Project Memory semantic/model query during Session ingest - may catch more duplicates, but mixes layer responsibilities and increases ingest cost.
- Recommendation: B. Let Session ingest ask "is this probably already represented?" but keep "is it current and how should it change?" inside Project Memory curation.
- Answer: B. Start with deterministic Project Memory existence lookup only.
- Answer impact: Confirms branch
- Spec impact: Updated Session-To-Project Boundary from possible shape to resolved shape.
- Context impact: Not needed
- ADR impact: Not needed
- Follow-ups: None.

### Question 3: Curator input scope

- Status: Answered
- Branch type: Initial
- Why it matters: This controls prompt size, auditability, and whether the curator can accidentally reinterpret unrelated SQLite state.
- Scenario probe: A project has 500 Session Memory rows, 80 pending candidates, and three pending project handoffs. What should the curator see on a routine maintenance run?
- Options:
  - A. All SQLite data for the project - maximum access, but noisy and hard to audit.
  - B. A bounded curator packet assembled from project handoffs/candidates, selected Session Memory, existing wiki context, and source refs - auditable and budgetable.
  - C. Live unrestricted DB/tool access from the curator agent - flexible, but difficult to keep deterministic or bounded.
- Recommendation: B. Build a packet first; later tools can add narrow reads if a concrete curator need appears.
- Answer: B. Use a bounded curator packet assembled from project handoffs/candidates, selected Session Memory, existing wiki context, and source refs.
- Answer impact: Confirms branch
- Spec impact: Updated Curator Input Packet to state that routine runs should not receive all SQLite data or unrestricted DB access.
- Context impact: Not needed
- ADR impact: Not needed
- Follow-ups: None.

### Question 4: Curator write authority

- Status: Skipped
- Branch type: Initial
- Why it matters: This decides whether the Project Memory Curator can directly mutate canonical markdown or only produce review proposals.
- Scenario probe: A handoff says "the new query command is Session Memory only", and repo evidence confirms it. Another handoff says "rewrite the architecture overview around the four-layer model". Should both apply automatically?
- Options:
  - A. Direct writes for every curator run - fastest, but risky for broad or conflicting updates.
  - B. Proposal/review for every curator run - safest, but undermines automatic maintenance.
  - C. Direct writes for routine well-sourced updates; review for broad, conflicting, destructive, or low-confidence changes - more complex, but fits Myelin's existing risk-gated direction.
- Recommendation: C. Project Memory needs to self-maintain, but the gate must force review when trust is low or blast radius is high.
- Answer: Skipped as misframed. The user clarified that Project Memory is primarily for agents, not a human approval queue. Markdown exists for audit and occasional human confirmation, not routine operation.
- Answer impact: Changes model
- Spec impact: Replaced Write And Review Policy with Autonomous Write Assurance Policy.
- Context impact: Candidate later - glossary may need to clarify that reviewable artifacts are not mandatory operator review.
- ADR impact: Candidate later - ADR 0019/0020 language may need a clarifying follow-up so "review gate" does not imply routine human approval.
- Follow-ups: See Question 4A.

### Question 4A: Autonomous write assurance model

- Status: Open
- Branch type: Follow-up
- Why it matters: The curator must be able to update canonical markdown without making the operator the bottleneck, while still preventing silent corruption of durable memory.
- Scenario probe: A curator has one routine sourced setup update, one broad architecture rewrite, and one conflict between Session Memory and repo reality. What happens without asking the operator to approve each item?
- Options:
  - A. Curator writes directly, then deterministic validation runs after - fast and simple, but weak for broad or conflicting changes.
  - B. Curator always produces an internal patch/proposal, then deterministic validators apply only if checks pass - safer, but may reject changes that need semantic judgment.
  - C. Curator produces a changeset, then an autonomous assurance pipeline applies routine changes and routes risky/conflicting changes through independent agent validation, reconciliation, or degraded/quarantine state - strongest self-maintaining model, but more complex.
- Recommendation: C. It matches the product goal: self-maintaining memory for agents, with auditable artifacts and fail-loud safety instead of human review as the normal path.
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Candidate later
- ADR impact: Candidate later
- Follow-ups:

### Question 4B: Canonical Project Memory markdown shape

- Status: Answered
- Branch type: Follow-up
- Why it matters: The origin LLM Wiki pattern makes markdown central, while the research intake argues that autonomous Project Memory needs stable evidence, applicability, lifecycle, and validation units. The design needs to avoid creating a second detached memory system beside the wiki.
- Scenario probe: A page says a test wrapper must be used. Later the wrapper is removed on one branch but still required on a release branch. Git can merge both text edits cleanly, but the agent still needs to know which statement applies. What exact artifact carries the stable ID, source identity, branch applicability, evidence, supersession, and retrieval text?
- Options:
  - A. Separate detached memory files - strong lifecycle identity, but creates a second memory surface beside the wiki and confuses where knowledge lives.
  - B. Canonical subject pages with addressable entries - preserves the wiki as the brain while making important statements machine-checkable.
  - C. Free-form subject pages only - simplest and closest to the original gist, but too weak for autonomous maintenance.
- Recommendation: B. Do not create a detached memory-fact folder for Phase 1. Split Project Memory into subject pages, and make important page sections addressable entries with evidence, applicability, and lifecycle metadata.
- Answer: B. The design should be subject-page first. Detached memory facts are not the right Phase 1 shape; material should live under architecture, setup, testing, decisions, workflows, or another subject where an agent would naturally look for it.
- Answer impact: Changes model and obsoletes branches
- Spec impact: Updated Product Boundary, Creation Mode, Maintenance Mode, and Governed Page Entry Model to make subject pages canonical and page entries the machine-checkable unit.
- Context impact: Candidate later - likely needs glossary terms for Project Memory Page and Project Memory Entry when finalizing the design.
- ADR impact: Candidate later - the subject-page-first decision may deserve an ADR because it rejects a separate detached memory-file architecture after discussion.
- Follow-ups: Add Question 4C to choose the Phase 1 subject page taxonomy.

### Question 4C: Phase 1 subject page taxonomy

- Status: Answered
- Branch type: Follow-up
- Why it matters: The first `project learn <key>` run needs a concrete default folder/page shape that is compatible with bootstrap and does not mirror the repo tree.
- Scenario probe: A newly learned project has setup commands, test commands, a runtime architecture, storage conventions, and two decisions. Which pages should exist after the first brain creation run, and which subjects should only be created when evidence exists?
- Options:
  - A. Minimal fixed roots - always create root `readme.md`, root `index.md`, `wiki/index.md`, and root folders for `architecture/`, `setup/`, `testing/`, and `decisions/`; create subject pages only when evidence exists.
  - B. Fully evidence-driven pages - create only the pages the curator needs, with no fixed subject folders except `index.md`.
  - C. Broad fixed wiki scaffold - create many standard folders up front, even if some are initially empty.
- Recommendation: A. It gives agents stable places to look without creating empty documentation theater.
- Answer: A, with naming correction. Use root `readme.md` instead of `overview.md`, root and folder `index.md` files for Obsidian/agent navigation, minimal wiki roots for `architecture/`, `setup/`, `testing/`, and `decisions/`, and command-scoped run folders such as `runs/project-learn/<run-id>/`.
- Answer impact: Confirms branch and changes naming
- Spec impact: Updated Creation Mode with bootstrap shell shape, first learned brain shape, lazy `schema/` and `sources/`, root `readme.md`, folder indexes, and command-scoped run artifacts.
- Context impact: Candidate later - V2 Project Layout should mention lazy project-local schema/source folders and mandatory folder indexes.
- ADR impact: Candidate later - likely not a standalone ADR unless layout churn continues; can be covered by Project Memory Curator design.
- Follow-ups: None.

### Question 5: Maintenance trigger policy

- Status: Open
- Branch type: Initial
- Why it matters: This decides when the curator wakes up and how Myelin avoids chasing its own queue forever.
- Scenario probe: Every Codex turn creates more Experience Log rows, Session Memory maintenance periodically creates handoffs, and Project Memory curation itself creates new evidence. What prevents recursive maintenance churn?
- Options:
  - A. Explicit command only - predictable and cheap, but not self-maintaining.
  - B. Automatic threshold/cooldown only - self-maintaining, but can be surprising and expensive.
  - C. Hybrid: explicit command plus automatic bounded maintenance behind threshold, cooldown, budget, and per-project lock - useful dogfood without unbounded churn.
- Recommendation: C. Match the auto-maintenance lesson from Session Memory, but keep the trigger slower and more conservative for canonical wiki writes.
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Not needed
- ADR impact: Candidate later
- Follow-ups:

### Question 6: Project Memory lookup and indexing

- Status: Open
- Branch type: Initial
- Why it matters: This decides how agents ask whether Project Memory already knows something and how later query can route over markdown.
- Scenario probe: The wiki page exists but page metadata is stale, or the vector index is pending. Should lookup report "not found"?
- Options:
  - A. Markdown and metadata text lookup only - simple and canonical, but weaker semantic recall.
  - B. Vector index as the primary source - strong recall, but risks treating derived state as truth.
  - C. Markdown canonical read with derived metadata/text/vector indexes that can degrade independently - best aligns with "markdown is curated truth".
- Recommendation: C. Start with markdown plus metadata/text lookup, then add vectors as derived acceleration, never as canonical truth.
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Not needed
- ADR impact: Not needed
- Follow-ups:

### Question 7: Project candidates versus project handoffs

- Status: Open
- Branch type: Initial
- Why it matters: The repo already has both `memory_candidates(scope = project)` and `project_handoff_instructions`; the curator needs a clear reason to consume both.
- Scenario probe: Session ingest finds a possible new project fact with a proposed payload and also knows the downstream curator should inspect two files. Is that one candidate, one handoff, or both?
- Options:
  - A. Use only Project Memory candidates - simpler queue, but loses the richer agent-ready instruction shape.
  - B. Use only Project handoffs - simpler downstream agent input, but weakens candidate lifecycle semantics.
  - C. Keep both: candidates are proposed memory outputs, handoffs are agent task instructions, and the curator can consume either or both.
- Recommendation: C. This matches existing glossary and keeps "proposed fact" separate from "what the next agent should do".
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Not needed
- ADR impact: Not needed
- Follow-ups:

### Question 8: Practice and Personal reuse boundary

- Status: Open
- Branch type: Initial
- Why it matters: The Project Memory layer should establish a reusable pattern without prematurely designing all canonical homes.
- Scenario probe: Project curation sees repeated Supabase auth decisions across two repos. Should the Project Memory implementation create Practice Memory pages now?
- Options:
  - A. Implement a generic multi-scope curator now - efficient abstraction, but too broad and risky.
  - B. Design Project Memory with a shared curator/promoter interface shape, then defer Practice and Personal canonical homes - proves the pattern with the root layer first.
  - C. Treat Practice and Personal as unrelated future systems - avoids overgeneralization, but risks rework.
- Recommendation: B. Reuse the lifecycle shape, not the full implementation, until Practice and Personal have real promotion examples.
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Not needed
- ADR impact: Not needed
- Follow-ups:

### Question 9: Current Briefing relationship

- Status: Open
- Branch type: Dependency
- Why it matters: Project Memory creation and maintenance may overlap with the paused Current Briefing work, but they should not collapse into the same artifact accidentally.
- Scenario probe: An agent asks "what should I know before working here today?" Should the answer be a markdown Project Memory page, a generated status/query response, or a separate current-state artifact?
- Options:
  - A. Current Briefing is a Project Memory wiki page - durable, but may become stale operational state.
  - B. Current Briefing is a status/query facade output assembled from Project Memory, Session Memory, and state - fresher and avoids turning transient state into wiki truth.
  - C. Current Briefing is a separate canonical state artifact - explicit, but adds another layer before Project Memory is solid.
- Recommendation: B. Keep Project Memory durable; let briefing compose durable facts with current Session Memory and state.
- Answer:
- Answer impact:
- Spec impact:
- Context impact: Candidate later
- ADR impact: Candidate later
- Follow-ups:
