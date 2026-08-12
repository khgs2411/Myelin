# Project Memory Agent-Authored Documentation Design Agenda

## Status

- Spec: `spec.md`
- State: Ready for development
- Completion gate:
  - Live agenda questions resolved: Yes
  - Pressure test complete: Yes
  - Spec finalized: Yes
  - External audit ready for development: Yes

## Documented Decisions

- Create mode should be documentation authoring, not schema-shaped memory curation.
- Create mode should ignore memory candidates and document the whole repository from repo inspection.
- First run should compose create mode followed by maintenance mode.
- Later runs should use maintenance mode only.
- Maintenance mode owns candidates and runtime inbox intake.
- Myelin should remove content-shape validation such as role/domain/page-count/body-length/citation-count gates.
- Myelin should keep safety, promotion, artifact, lifecycle, and retrieval-indexing responsibilities.
- Canonical Project Memory remains markdown under `projects/<key>/wiki/` plus state metadata; SQLite/vector rows remain derived serving state.
- ADR 0067 supersedes conflicting structured create/apply/validation decisions from ADR 0059, ADR 0063, ADR 0064, and ADR 0065, and partially supersedes ADR 0058.

## Questions

### Question 1: Create agent write authority

- Status: Answered
- Branch type: Initial
- Why it matters: The whole design depends on whether the create agent can write markdown directly. The write boundary determines sandboxing, recovery, validation, and how close the product is to a normal Codex documentation session.
- Scenario probe: The create agent wants to write `projects/llm-wiki/wiki/storage.md` directly, edit `README.md`, and create `draft-wiki/storage.md`. Which writes should be possible during the agent run, and which should only happen during Myelin promotion?
- Options:
  - A. Agent writes only to run-local `draft-wiki/` and report files; Myelin promotes to canonical wiki — strongest boundary, slightly less like a normal Codex session.
  - B. Agent writes directly to canonical `projects/<key>/wiki/`; Myelin records after-the-fact artifacts — simplest agent prompt, but weakest recovery and easiest to leave partial docs.
  - C. Agent writes to a temporary worktree copy of the whole wiki and Myelin diffs/promotes it — flexible but more moving parts.
- Recommendation: A. Keep the agent's authoring freedom inside `draft-wiki/`, and keep canonical writes owned by Myelin promotion.
- Answer: A. The create agent may write only to run-local `draft-wiki/` and report files; Myelin promotes accepted draft documentation to canonical `projects/<key>/wiki/`.
- Answer impact: Confirms branch.
- Spec impact: Confirms the draft-wiki promotion boundary already described in `Technical Design`, `Data / State`, and `Permissions / Security`.
- Context impact: Not needed; this uses existing Project Memory and draft-wiki language from the design.
- ADR impact: Resolved by ADR 0067.
- Follow-ups: None.

### Question 2: First-run maintenance failure behavior

- Status: Answered
- Branch type: Initial
- Why it matters: First run is now create followed by maintenance. If create succeeds and maintenance fails, the system needs a clear trust and promotion boundary.
- Scenario probe: Create produces excellent full docs, then maintenance fails because one candidate is malformed or the maintenance agent exits before writing dispositions. Should users still get the new docs?
- Options:
  - A. Promote create docs even if maintenance fails; leave candidates pending and report maintenance failure — prioritizes useful first docs.
  - B. Treat first run as all-or-nothing; no canonical docs unless create and maintenance both succeed — stronger lifecycle consistency, but one bad candidate blocks documentation.
  - C. Promote create docs only when maintenance failure is candidate-specific and non-destructive; block on infrastructure/write-boundary failures — nuanced but more states.
- Recommendation: A or C. The product value is the first documentation set; candidate processing should not usually block it.
- Answer: C. Promote successful create docs when maintenance failure is candidate-specific or otherwise non-destructive; block promotion when maintenance fails because of infrastructure, unsafe writes, corrupted draft state, or unclear wiki safety.
- Answer impact: Confirms branch.
- Spec impact: Update first-run lifecycle and error handling to distinguish candidate-specific maintenance failure from infrastructure/write-boundary failure.
- Context impact: Not needed.
- ADR impact: Resolved by ADR 0067 and the state/disposition contract in `spec.md`.
- Follow-ups: State model should preserve that create completed while maintenance remained incomplete or degraded.

### Question 3: Documentation structure strictness

- Status: Answered
- Branch type: Initial
- Why it matters: The user wants a specific structure, but the prior failure came from over-constraining structure in validation. The prompt must guide the agent without recreating schema-shaped output.
- Scenario probe: A small library repo needs five pages, while Myelin needs fifteen. Should both be forced into the same file list?
- Options:
  - A. Required high-level skeleton plus agent-added pages allowed — predictable index, flexible depth.
  - B. Fully freeform markdown tree with only an `index.md` requirement — maximum agent freedom, less consistency for retrieval/query.
  - C. Repo-type templates selected by prompt or config — more tailored, more implementation work.
- Recommendation: A. Require `index.md` and broad sections/pages, but explicitly allow the agent to add, split, or rename pages when the repo demands it.
- Answer: Modified B. Do not enforce specific documentation files such as `architecture.md` or a fixed skeleton. The planner/index agent decides the documentation subjects and file shape from the repo. Myelin should require a navigable `index.md`, a subject manifest for orchestration, and evidence/report artifacts, but it should not determine ahead of time which subject files must exist.
- Answer impact: Changes model.
- Spec impact: Remove the suggested fixed file skeleton as a requirement. State that documentation shape belongs to the planner agent, while Myelin only enforces orchestration, evidence/report, path safety, and promotion integrity.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: None.

### Question 4: Human review versus automatic curated state

- Status: Answered
- Branch type: Initial
- Why it matters: Removing content validation leaves the question of when `project-memory.json` can honestly say `curated`. The answer affects dogfood, automation, and trust semantics.
- Scenario probe: A live provider creates a large documentation tree and safety checks pass, but no human has inspected it yet. Should Project Memory be queryable as curated?
- Options:
  - A. Mark curated automatically after safety checks and successful promotion — most automated, but risks another bad wiki being labeled trusted.
  - B. Mark `review_ready` until an operator accepts the docs; query can still read refs but state is not trusted — honest quality boundary, extra manual step.
  - C. Mark curated automatically for live provider runs but not stubs — simple distinction, still lacks quality review.
- Recommendation: B for `llm-wiki` dogfood until the flow proves itself; maybe later automate acceptance once live quality is consistently good.
- Answer: Modified A. Mark Project Memory curated automatically after a live agent-authored create/maintenance run passes safety and promotion checks. Manual review is an audit/debug activity, not a normal success gate. State should record that the docs are agent-curated, the provider mode was live, and no human review was required.
- Answer impact: Changes model.
- Spec impact: Replace review-ready gating with automatic live agent-curated state. Keep explicit distinction that stubbed/test runs cannot be mistaken for product-quality dogfood.
- Context impact: Resolved in `spec.md` as `curation_kind: agent_authored`, `run_kind`, and provider mode state.
- ADR impact: Resolved by ADR 0067.
- Follow-ups: Ensure safety/promotion checks remain narrow and do not become content-shape validation by another name.

### Question 5: Maintenance candidate disposition authority

- Status: Answered
- Branch type: Initial
- Why it matters: Maintenance will mark candidates as ingested, already covered, or not durable. If Myelin stops validating content, candidate lifecycle still needs enough structure to avoid losing leads silently.
- Scenario probe: The maintenance agent says candidate A is already covered, candidate B was applied, and candidate C lacks evidence. What minimum report shape must Myelin require before updating candidate status?
- Options:
  - A. Require a small structured disposition report for candidates only; docs remain freeform markdown — preserves lifecycle without schema-shaping docs.
  - B. Let the maintenance agent write a markdown report and do not mutate candidate statuses automatically — safest for data loss, less automated.
  - C. Keep current structured maintenance proposal model — preserves existing lifecycle, but keeps the constraining machinery this design is trying to remove.
- Recommendation: A. Keep structure only around candidate lifecycle, not documentation content.
- Answer: A. Require a small structured disposition report for candidates only; documentation remains freeform markdown.
- Answer impact: Confirms branch.
- Spec impact: Clarify maintenance report structure as lifecycle metadata only, with no structured documentation proposal or page schema.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: Resolved in `spec.md` by the canonical maintenance candidate disposition list.

### Question 6: Create mode agent topology

- Status: Answered
- Branch type: Initial
- Why it matters: A single documentation agent is closest to the simple Codex-session mental model. Multiple agents can inspect more surface area in parallel, but require synthesis and coordination so the wiki does not become fragmented or contradictory.
- Scenario probe: On a large repo, one agent can write a coherent documentation tree but may miss details. Several agents can cover architecture, commands, storage, and tests in parallel, but a synthesis pass must merge them into one voice and one navigable wiki. Which product shape should create mode optimize for first?
- Options:
  - A. Single create documentation agent writes the full draft wiki — simplest, most coherent, easiest to ship.
  - B. Multiple research agents produce notes, then one writer agent creates the draft wiki — stronger coverage, more moving parts.
  - C. Multiple page/section agents write draft pages directly, then a reviewer/synthesizer reconciles — most parallel, highest fragmentation risk.
- Recommendation: A first. It best matches "ask Codex to document this repo" and keeps the first implementation hands-off. Add multi-agent research later if live dogfood proves one agent misses too much.
- Answer: Modified C. Create mode should use a multi-agent documentation topology: one planner/index agent inspects the repo, identifies required documentation subjects, writes the navigable index and placeholder subject files with short purpose descriptions, then Myelin invokes one writer agent per subject/file to document that subject from the repo. Maintenance mode remains a single candidate-guided agent.
- Answer impact: Changes model.
- Spec impact: Replace single create documentation agent with planner/index agent plus per-subject writer agents. Record create mode as the highest-cost, highest-gain phase. Keep maintenance single-agent because candidate-guided updates are smaller in scope.
- Context impact: Not needed.
- ADR impact: Resolved by ADR 0067.
- Follow-ups: Decide whether create mode needs a final synthesis/index repair pass after subject writers finish.

### Question 7: Create mode final synthesis pass

- Status: Answered
- Branch type: Initial
- Why it matters: Per-subject agents improve depth but can leave the wiki inconsistent as a whole. A final pass can repair navigation, duplicates, terminology, and cross-links without reintroducing schema validation.
- Scenario probe: Subject writers produce strong pages, but two pages explain the same concept differently, one page references a file that another page renamed, and the index no longer describes the actual content well. Should create mode include a final agent pass to reconcile the documentation tree?
- Options:
  - A. Yes, run a final synthesis/index repair agent after subject writers — better whole-wiki coherence, extra cost.
  - B. No, rely on the planner plus subject writers only — simpler and cheaper, more fragmentation risk.
  - C. Run final synthesis only when cheap integrity checks find broken links or stale placeholders — conditional complexity, less predictable quality.
- Recommendation: A. Create mode is intentionally the expensive high-gain phase, and final synthesis addresses the main weakness introduced by per-subject parallelism.
- Answer: B. Do not add a third synthesis agent layer by default. Create mode should stay as a two-layer run: planner/index agent creates the documentation shape and per-subject writer agents document their assigned subjects. If a focused subject writer cannot produce useful documentation for one assigned subject, that is a core product failure rather than a reason to add another agent layer up front.
- Answer impact: Changes model.
- Spec impact: Clarify that there is no final synthesis/index repair agent in the initial design. Deterministic safety/integrity checks may still run, but no extra content-reconciliation agent is part of create mode.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: Keep this under live dogfood pressure; add a synthesis pass only if repeated evidence shows subject-level writing succeeds but whole-wiki coherence fails.

### Question 8: Subject writer failure semantics

- Status: Answered
- Branch type: Initial
- Why it matters: Create mode now depends on multiple writer agents. The system needs a clear boundary for whether partial documentation can become canonical Project Memory.
- Scenario probe: The planner creates ten subject files. Nine subject writers produce detailed docs, but one exits non-zero, leaves a placeholder, or writes obviously incomplete output. Should Myelin promote the nine completed pages?
- Options:
  - A. Fail the create run before promotion when any required subject writer fails or leaves its placeholder incomplete — strongest documentation integrity.
  - B. Promote partial docs and mark missing subjects as known gaps — more useful earlier, but risks canonical Project Memory that is knowingly incomplete.
  - C. Retry failed subject writers first, then fail if still incomplete — more robust to transient failures, more orchestration.
- Recommendation: A for the initial design. A subject writer has one scoped job; if it cannot produce the assigned documentation, the create run should not mark Project Memory curated.
- Answer: C. Retry failed subject writers first, then fail the create run before promotion if any required subject remains incomplete after retry.
- Answer impact: Changes model.
- Spec impact: Add subject-writer retry semantics. Retries should be triggered by mechanical failures such as non-zero exit, missing assigned file, unchanged placeholder, missing/malformed report, or unsafe writes; they should not become content-quality scoring.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: Resolved in `spec.md`: default is one retry after the initial failed attempt.

### Question 9: Subject writer execution model

- Status: Answered
- Branch type: Initial
- Why it matters: Create mode may invoke many subject writers. Running them in parallel better matches the multi-agent value proposition, while serial execution is simpler and easier on provider limits.
- Scenario probe: The planner creates twelve subject files. Should Myelin run twelve subject writers at once, run them one by one, or use a bounded concurrency pool?
- Options:
  - A. Bounded parallelism — run multiple subject writers concurrently with a configurable limit; best balance of throughput and control.
  - B. Fully serial — simplest and lowest provider pressure, but slower and less multi-agent.
  - C. Unbounded parallelism — fastest on small repos, risky for rate limits and local resource pressure.
- Recommendation: A. Use bounded parallelism by default so create mode gets real multi-agent throughput without giving up operational control.
- Answer: A. Run subject writers with bounded parallelism using a configurable concurrency limit.
- Answer impact: Confirms branch.
- Spec impact: Add bounded-concurrency subject writer execution. Preserve write isolation by assigning each writer one documentation file and one report file.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: Resolved in `spec.md`: default concurrency is 4 with bounded overrides.

### Question 10: Planner output manifest

- Status: Answered
- Branch type: Initial
- Why it matters: Myelin needs a reliable way to know which subject writer jobs to launch. Inferring jobs from freeform markdown files is fragile, but requiring a rich content schema would recreate the old validation problem.
- Scenario probe: The planner writes `index.md`, creates twelve placeholder pages, and describes each page's intended subject. Should Myelin parse the markdown tree to discover jobs, or should the planner also write a small structured manifest?
- Options:
  - A. Require a small structured subject manifest only — reliable orchestration without schema-shaping the docs.
  - B. Infer subject jobs from `index.md` links and placeholder files — fewer artifacts, more brittle.
  - C. Require a rich structured plan with page sections and coverage goals — strong orchestration, but too close to the old schema.
- Recommendation: A. Keep structure only for orchestration: subject id, path, title, purpose, and suggested repo areas. The documentation remains freeform markdown.
- Answer: A. Require a small structured subject manifest for orchestration only.
- Answer impact: Confirms branch.
- Spec impact: Add planner manifest with subject id, path, title, purpose, and suggested repo areas. Explicitly prohibit section schemas, coverage scoring, or content-quality validation from the manifest.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: Resolved in `spec.md`: manifest validation is limited to safe paths, placeholder presence, and job-launch completeness.

### Question 11: Subject writer report shape

- Status: Answered
- Branch type: Initial
- Why it matters: Myelin needs to distinguish "writer completed the assigned file" from "writer exited but left a placeholder." Too much report structure recreates content validation; too little makes retries and failure handling unreliable.
- Scenario probe: A subject writer finishes its assigned planned subject file. What must it report so Myelin can treat the writer as mechanically complete without judging the content quality?
- Options:
  - A. Small structured completion report only — subject id, assigned path, status, touched path, evidence paths inspected, known gaps.
  - B. No structured report; rely on file existence and placeholder replacement only — simpler, less auditable.
  - C. Rich report with sections covered and quality diagnostics — more insight, but close to old validation.
- Recommendation: A. Keep reports operational and evidence-oriented, not content-shaping.
- Answer: A. Require a small structured completion report only, focused on subject id, assigned path, status, touched path, evidence paths inspected, and known gaps.
- Answer impact: Confirms branch.
- Spec impact: Add subject writer completion report as operational evidence. Clarify that reports do not define or validate the documentation file shape.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: Keep report validation limited to mechanical completion, evidence presence, and path safety.

### Question 12: Evidence model for generated documentation

- Status: Answered
- Branch type: Initial
- Why it matters: Project Memory should be grounded in the repo, but evidence requirements can easily turn back into citation-count validation. The design needs a clear boundary between asking agents for evidence and scoring documentation shape.
- Scenario probe: A subject writer documents a runtime concept from three source files. Should the markdown page itself cite those files, should only the completion report list inspected evidence, or should both exist?
- Options:
  - A. Ask writers to include natural repo references in markdown and require evidence paths in the completion report; Myelin validates report/path safety only, not citation density.
  - B. Keep evidence only in structured reports; markdown can read like normal docs without citations.
  - C. Require line-precise citations throughout markdown and fail pages without enough citations.
- Recommendation: A. It preserves grounded documentation and auditability without recreating old citation-count quality gates.
- Answer: A. Ask writers to include natural repo references in markdown and require evidence paths in completion reports. Myelin validates report/path safety only, not citation density.
- Answer impact: Confirms branch.
- Spec impact: Add natural markdown repo references plus structured report evidence paths. Explicitly avoid line/citation-count quality gates.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: Resolved in `spec.md`: reports carry evidence paths, while markdown uses natural repo references without citation-density gates.

### Question 13: Maintenance write scope

- Status: Answered
- Branch type: Initial
- Why it matters: Maintenance keeps Project Memory living, but candidate-driven runs should not accidentally rewrite the entire wiki. The write scope determines how self-maintaining and how stable the canonical docs are.
- Scenario probe: A candidate reveals missing knowledge about the command/runtime model. The maintenance agent thinks it should update two existing pages, add one new page, and adjust `index.md`. Should that be allowed in one maintenance run?
- Options:
  - A. Allow maintenance to update existing pages, create new pages, and adjust `index.md`, but require the disposition report to list touched paths and reasons.
  - B. Only allow maintenance to edit existing pages; new pages require a future create/restructure command.
  - C. Allow unrestricted draft-wiki rewrites as long as promotion safety passes.
- Recommendation: A. It preserves self-maintenance while keeping changes auditable and candidate-scoped.
- Answer: A. Allow maintenance to update existing pages, create new pages, and adjust `index.md`, but require the disposition report to list touched paths and reasons.
- Answer impact: Confirms branch.
- Spec impact: Clarify maintenance write scope as candidate-scoped wiki evolution, including new pages and index updates, with touched-path/reason reporting.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: Resolved in `spec.md` validation and error-handling boundaries.

### Question 14: Recreate mode after curated Project Memory exists

- Status: Answered
- Branch type: Initial
- Why it matters: The default later run is maintenance-only, but operators still need a way to rebuild Project Memory if the documentation shape is bad or the repo changed radically.
- Scenario probe: A project already has curated Project Memory, but the operator decides the planner made the wrong subject breakdown. Should `project learn` ever rerun create automatically, or should recreate be an explicit command/flag?
- Options:
  - A. Recreate only through an explicit reset/recreate command or flag — safest; normal runs remain maintenance-only.
  - B. Let Myelin rerun create automatically when it detects large repo or wiki drift — more autonomous, but harder to predict and risks expensive surprise rewrites.
  - C. Never rerun create after first curation; only maintenance can evolve the wiki — stable, but too rigid for bad initial shape.
- Recommendation: A. Keep create as an intentional high-cost rebuild path, not normal maintenance behavior.
- Answer: A. Recreate only through an explicit reset/recreate command or flag. Normal `project learn` remains maintenance-only once Project Memory is curated.
- Answer impact: Confirms branch.
- Spec impact: Clarify that create mode is never automatically rerun for curated projects; explicit recreate/reset is the only rebuild path.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: Resolved in `spec.md`: explicit recreate surface is `myelin project learn <key> --recreate`.

## Pressure Test

- Checked for remaining open agenda questions; none remain.
- Checked for fixed-file-shape leakage after the `architecture.md` correction; the spec now gives documentation shape ownership to the planner agent and requires only a navigable `index.md`.
- Checked for old validation proxy leakage; the spec rejects section counts, body length, role/domain coverage, citation density, and content-quality scoring.
- Found and fixed one lifecycle contradiction: the spec previously promoted and marked curated before first-run maintenance, while earlier decisions allowed unsafe maintenance failures to block promotion. The spec now runs maintenance before canonical promotion, with a fallback to promote the create snapshot only for candidate-specific/non-destructive maintenance failures.
- Confirmed structured data is limited to orchestration, lifecycle, evidence, and audit reports rather than documentation shape.

## External Audit Reconciliation

- First external auditor: Software Architect sub-agent `019f3706-b0a5-7541-b4ca-44f87d8f8249`.
- First audit verdict: Needs Refinement.
- Final full plan-set audit verdict: Ready for Development.
- Critical issue: artifacts marked themselves unfinalized.
  - Resolution: spec, agenda, roadmap, ADR, and chunk plan set were refined until the external audit returned Ready for Development.
- Critical issue: accepted ADRs conflicted with the new design.
  - Resolution: ADR 0067 now supersedes the conflicting structured create/apply/validation decisions and records preserved decisions from ADR 0021, ADR 0060, ADR 0062, and ADR 0066.
- Critical issue: direct-write agent execution was not reconciled with the current read-only JSON runner.
  - Resolution: `spec.md` now defines a separate file-authoring runner contract using run-local writable output roots and filesystem artifact discovery, not JSON stdout parsing through `invokeLlm`.
- Critical issue: lifecycle/state vocabulary was unstable.
  - Resolution: `spec.md` now defines the `project-memory.json` fields and canonical maintenance candidate dispositions.
- Recommendation: define retry, concurrency, and recreate defaults.
  - Resolution: `spec.md` now sets one subject-writer retry, default writer concurrency 4, and explicit recreate surface `myelin project learn <key> --recreate`.
