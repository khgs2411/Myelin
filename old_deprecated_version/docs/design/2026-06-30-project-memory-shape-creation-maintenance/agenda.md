# Project Memory Shape, Creation, And Maintenance Design Agenda

## Status

- Spec: `spec.md`
- State: Complete
- Completion gate:
  - Live agenda questions resolved: Yes
  - Pressure test complete: Yes
  - Spec finalized: Yes

## Agenda Audit And Correction

- Status: Repaired after user challenge.
- Issue found: The original live agenda re-asked at least one requirement already stated in the user's initial prompt. Question 5 should have been recorded as a documented decision from the start, not asked live.
- Repair method: Reconciled the user's initial request, the live roadmap scope, current code behavior, and the agenda. Requirements that were already stated by the user are now marked as documented decisions or answered agenda entries.
- Trust boundary: This agenda should not be treated as authoritative because it was written first; it should be trusted only to the extent that each entry is now traceable to user-stated requirements, repo evidence, or an explicitly recorded answer.
- Codebase audit status: Completed for the design surface. The audit covered Project Memory curator contracts, validator, markdown applier, prompt budget, packet construction, runtime inbox intake, Session Memory ingest output, candidate/handoff storage, Project Memory retrieval indexing, current query facade behavior, and targeted tests.
- Codebase audit correction: The spec now distinguishes current implementation from redesign targets. Current code has page-count creation, direct repo citation checks, entry-block maintenance, normalized candidates/handoffs, target-repo cwd curator invocation, Project Memory retrieval index plumbing, and Session-Memory-only `memory query`. Step 4 is responsible for role-based documentation quality, section-first maintenance, Project Memory markdown-backed query return behavior, and content-quality states.
- Resolved live branch: Question 6 settled the Step 4 distinction between content-quality trust and retrieval/index readiness.
- Correction outcome: The agenda no longer treats Project Memory query return behavior as an open question. It records it as: derived SQLite/vector lookup finds markdown, then returns content under a size threshold or canonical refs when too large; answer synthesis is deferred.

## Documented Decisions

- Project Memory is the root durable project documentation layer and should capture what future agents need to understand the repo without re-reading everything.
- Project Memory canonical truth remains markdown plus project state; derived SQLite/vector rows point back to markdown.
- Session Memory is valid evidence from real agent conversations and can suggest Project Memory candidates, but candidate text is not canonical Project Memory.
- Runtime durable-memory inbox items and Session Memory handoffs are proposal lanes feeding `project learn`.
- Step 4 focuses on Project Memory shape, creation, maintenance, quality, and producer routing where producers feed Project Memory candidates or handoffs. This scope was expanded from the original roadmap split after the user clarified that the full request should move Step 4.5 items into Step 4 when needed.
- For now, Project Memory query should return markdown content or canonical path/section references, not synthesize a final answer.
- The current page-count creation bar is insufficient; Step 4 needs a stronger documentation quality bar.

## Pressure-Test Result

- Status: Complete
- Checked categories: lifecycle/status outcomes, state persistence, producer handoff boundaries, retrieval/query scope, recovery paths, verification evidence, planning boundaries, and user review gate.
- Result: No new live design questions were added. The remaining ambiguous details are implementation-shaping choices already assigned to later planning or optional pseudocode: exact section marker/ID strategy, exact content-size threshold for Project Memory query returns, exact JSON result shape, and exact validator artifact fields.
- Remaining non-blocking risks:
  - Section-first maintenance must preserve deterministic bounded writes when it replaces or evolves the current entry-block applier.
  - Content-quality diagnostics must be strong enough to reject shallow pages without becoming an untestable subjective review.
  - Project Memory query return shape must remain markdown-backed even if the existing `memory query` command later becomes a multi-layer facade.

## External Audit Result

- Auditor: Software Architect sub-agent `019f1862-8938-76c3-aec6-227fa20e543a` using `plan-auditor`.
- Audit mode: Full design/spec audit, not implementation-plan audit.
- Verdict: Ready for Development, interpreted for this workflow as ready to proceed to `$pmp-writing-plans`.
- Critical issues: None.
- Recommendations incorporated before planning:
  - Pseudocode README status now clarifies that artifacts are reference-ready draft shaping inputs for planning.
  - Pseudocode review points now require planning to treat the six first-create roles as the default contract unless it records a coverage-preserving merge/split.
  - Pseudocode review points now require Project Memory query work to stay separate from creation/maintenance quality work or be explicitly deferred.
- Recommendations to carry into `plan.md` readiness gate:
  - First chunk owns concrete quality metric choices: minimum sections, citation sufficiency, shallow-summary detection, and role coverage schema fields.
  - Section ID/marker strategy must be resolved before maintenance implementation chunks.
  - Dogfood reset/recreate should remain a final validation chunk after creation contract, diagnostics, and retrieval readiness are wired.

## Questions

### Question 1: Creation shape contract

- Status: Answered
- Branch type: Initial
- Why it matters: This is the root contract for Step 4. It determines whether implementation strengthens the current generic page-count guard or replaces it with a documentation role model that future agents can trust.
- Scenario probe: A first-create run emits `index.md`, `product-purpose.md`, `runtime-commands.md`, and `architecture-data-flow.md`, each with citations but only a paragraph or two. Should that be publishable because it has the right page count and citations, or review-only because it does not satisfy role depth and coverage?
- Options:
  - A. Role-based documentation contract - creation must satisfy required page roles, section coverage, citation density, and missing-coverage diagnostics; page count becomes secondary.
  - B. Strengthened current page-count contract - keep the current required generic pages but add minimum line/section/citation counts.
  - C. Candidate-driven contract - creation and maintenance produce only pages needed for available candidates, with no fixed first-create documentation shape.
- Recommendation: A. It matches the user's stated "living repo documentation" shape, avoids shallow page-count compliance, and gives later retrieval/indexing a stable markdown surface to point at.
- Answer: A. Project Memory creation should use a role-based documentation contract. Creation must satisfy required page roles, section coverage, citation density, and missing-coverage diagnostics; page count is secondary.
- Answer impact: Confirms branch.
- Spec impact: The spec now treats the role-based documentation contract as a requirement rather than a recommendation.
- Context impact: Updated - added Project Memory Documentation Contract to `CONTEXT.md`.
- ADR impact: Not needed - this strengthens existing markdown-as-curated-truth and mode-scoped creation decisions rather than changing the canonical memory model.
- Follow-ups: None. Existing questions cover candidate promotion, producer routing, orientation, maintenance granularity, query return behavior, and quality states.

### Question 2: Candidate-to-documentation promotion rule

- Status: Answered
- Branch type: Dependency
- Why it matters: Session Memory and inbox candidates can be useful leads, but treating them as direct write text would weaken Project Memory into copied conversation summaries.
- Scenario probe: This exact brainstorming session produces a Session Memory candidate saying "Project Memory query returns matching markdown files or contents from derived SQLite hints." Should maintain mode write that statement from the candidate alone, or must it inspect/update the product docs/code/design artifacts that make the statement durable for this repo?
- Options:
  - A. Candidates are leads only - curator must explore bounded repo evidence and cite durable sources before writing Project Memory.
  - B. High-confidence candidates may become Project Memory directly if they came from real conversation hooks.
  - C. Candidate text may write directly only into review-only pages or pending sections until later verified.
- Recommendation: A. Session Memory is valid evidence of what happened, but Project Memory should document project truth; direct copying would blur the layer boundary.
- Answer: A. Candidates are leads only. The curator must explore bounded repo evidence and cite durable sources before writing Project Memory. The invoked curator agent must run inside the target project cwd from bootstrap, so it has the full codebase as context and returns structured output back to Myelin.
- Answer impact: Confirms branch and adds an execution-boundary requirement.
- Spec impact: The spec now defines Memory Candidates as leads, prohibits direct candidate-text promotion, and requires Project Memory curator invocation inside the target repo cwd.
- Context impact: Updated - refined Memory Candidate to "lead" language in `CONTEXT.md`.
- ADR impact: Not needed - this reinforces existing Project Memory curation and provider cwd behavior rather than changing canonical storage or command ownership.
- Follow-ups: Producer routing remains open as Question 2A.

### Question 2A: Producer routing ownership

- Status: Answered
- Branch type: Follow-up
- Why it matters: The scope now includes producer routing into Step 4 where needed. The design must decide whether Step 4 only documents the common intake boundary or also changes specific producers such as gap/stale outputs.
- Scenario probe: A future query detects stale Project Memory, while a Session Memory curator detects the same missing behavior from a conversation. Should both producers write the same normalized Project Memory candidate shape, or should stale/gap producers use a separate lane that the Project Memory Curator later merges?
- Options:
  - A. One Project Memory candidate/handoff intake boundary - all Project Memory producers emit normalized candidate or handoff inputs that `project learn` handles consistently.
  - B. Producer-specific lanes - Session Memory, gap, stale, and runtime inbox producers each keep separate records, and packet construction merges them.
  - C. Two lanes only - conversation-derived producers use handoffs, explicit operator/tool producers use runtime inbox candidates.
- Recommendation: A. It keeps Project Memory as the single durable curation owner and avoids special-case producer semantics leaking into maintenance.
- Answer: A. All Project Memory producers should normalize into one Project Memory candidate/handoff intake boundary. Producers may use the existing normalized shapes, `Memory Candidate` and `Layer Handoff Instruction`, but producer-specific lanes should not survive past normalization into `project learn`.
- Answer impact: Confirms branch.
- Spec impact: The spec now states that producer-specific semantics stop at normalization; `project learn` handles candidates and handoffs consistently as leads for Project Memory documentation.
- Context impact: Updated - added relationship language tying Project Memory producers to `Memory Candidate` and `Layer Handoff Instruction`.
- ADR impact: Not needed - this preserves the existing runtime inbox/handoff concepts while clarifying their shared downstream boundary.
- Follow-ups: None. Existing orientation and maintenance questions cover the remaining implementation-shaping choices.

### Question 3: First-create repo orientation boundary

- Status: Answered
- Branch type: Dependency
- Why it matters: Creation mode cannot be useful if it only reads packet/candidate summaries, but it also cannot do unbounded rediscovery every time.
- Scenario probe: For `llm-wiki`, a useful first Project Memory layer likely needs `MYELIN.md`, `CONTEXT.md`, `docs/ROADMAP.md`, relevant ADRs/design docs, and core `src/project`, `src/memory`, `src/ingest`, `src/commands`, and `src/runtime` surfaces. Should the creation contract encode a required orientation set, or should it leave the curator to choose files inside a bounded search budget?
- Options:
  - A. Required orientation manifest - Myelin builds or names a repo-specific orientation set that creation must inspect and cite.
  - B. Curator-chosen bounded exploration - prompt gives categories and budgets, curator chooses files and reports what it inspected.
  - C. Hybrid - deterministic defaults plus curator-added files when justified, all reported in diagnostics.
- Recommendation: C. The default set prevents shallow creation, while curated additions keep the design repo-shaped instead of hardcoding one repo's structure.
- Answer: C. Creation mode should use a hybrid orientation model: deterministic default files/surfaces plus curator-added files when justified, all reported in diagnostics.
- Answer impact: Confirms branch.
- Spec impact: The spec now requires a default orientation set, justified curator additions, and inspected-surface diagnostics for creation mode.
- Context impact: Not needed - this is contract behavior, not new product vocabulary.
- ADR impact: Not needed - this refines creation evidence gathering without changing a hard-to-reverse architecture boundary.
- Follow-ups: None. Maintenance target granularity remains the next live design dependency.

### Question 4: Maintenance target granularity

- Status: Answered
- Branch type: Initial
- Why it matters: Maintenance quality depends on updating the right existing documentation unit. Whole-page updates are easy to validate but can lead to broad rewrites; entry-only updates are safe but may not fit documentation-shaped pages.
- Scenario probe: A future candidate says Session Memory catch-up should expose explicit status when recent captured work is not indexed. Should maintain mode patch a specific section under `operations-current-work.md`, create an entry block, or create a new page?
- Options:
  - A. Section-first maintenance - target existing page sections when possible, create pages only for missing concept ownership.
  - B. Entry-block maintenance - keep marker-based entries as the only writable unit for deterministic apply.
  - C. Page-first maintenance - allow page-level rewrites when the curator judges the page concept changed.
- Recommendation: A, with deterministic markers or section IDs added during planning if needed. It fits documentation-shaped memory while avoiding broad rewrites.
- Answer: A. Maintenance should be section-first: target existing page sections when possible and create pages only for missing concept ownership. In maintenance mode, Memory Candidates should weigh more heavily than in creation because they are produced after the repo already has established Project Memory and are created against existing memory as part of Session Memory logic. They still remain leads, not direct write authority.
- Answer impact: Confirms branch and adds maintenance candidate-priority nuance.
- Spec impact: The spec now requires section-first maintenance and says maintenance should prioritize Memory Candidates as stronger signals while still requiring evidence checks and durable markdown placement.
- Context impact: Updated - added Section-First Project Memory Maintenance to `CONTEXT.md`.
- ADR impact: Not needed now - the design settles section-first maintenance, while the concrete section ID or marker strategy is an implementation-shaping detail for later pseudocode/planning.
- Follow-ups: None. Implementation planning should decide the concrete section ID/marker strategy.

### Question 5: Query return behavior threshold

- Status: Answered
- Branch type: Initial
- Why it matters: The user wants query to use SQLite/vector hits to find markdown, then return file contents or refs for now. The size threshold and unit affect UX, token cost, and how future MCP tools should behave.
- Scenario probe: A query for "how session memory works" matches a 900-character section in `product-memory-model.md` and a 7,000-character architecture page. What should the tool return today?
- Options:
  - A. Section-first return - return matching sections under a character limit; return page refs when sections/pages are too large.
  - B. Page-first return - return whole markdown files under a limit; otherwise return paths.
  - C. Reference-only return - always return paths/section refs and let the agent read files itself.
- Recommendation: A. It gives direct usefulness while keeping Project Memory markdown canonical and avoiding huge page dumps.
- Answer: A. This was already specified in the user's initial request: Project Memory query should use SQLite/vector lookup to find relevant markdown sections/pages, then return the whole documentation content when it is under a configured size threshold or return canonical path/section refs when too large. Response synthesis is deferred.
- Answer impact: Confirms branch from initial request; no live question was needed.
- Spec impact: The spec already captures markdown-backed query with content-or-ref return behavior; no model change.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: Implementation planning should define the exact size threshold and JSON result shape.

### Question 6: Publication quality states

- Status: Answered
- Branch type: Risk
- Why it matters: Operators need to know whether a run produced trusted Project Memory, valid-but-shallow review material, or trusted markdown with pending retrieval/index work.
- Scenario probe: Creation writes good documentation but hint generation fails. Another creation writes valid markdown with citations but misses key role coverage. Should both be `completed_with_pending_index`, or should the second be held as review-only/shallow-quality failure?
- Options:
  - A. Separate content quality from retrieval readiness - trusted content can be `completed_with_pending_index`; shallow content cannot mark Project Memory curated.
  - B. Use one degraded/completed status family for both content quality and indexing state.
  - C. Always require both content quality and retrieval indexing before creation can complete.
- Recommendation: A. It preserves the Step 3.5 retrieval boundary and prevents valid-but-thin markdown from being reported as trusted Project Memory.
- Answer: A. Separate content quality from retrieval readiness. Trusted Project Memory content may complete with pending retrieval/index work, but shallow or role-incomplete content must not mark Project Memory curated and must not be reported as `completed_with_pending_index`.
- Answer impact: Resolves branch and introduces a named quality axis.
- Spec impact: Added publication quality states: content quality decides whether canonical Project Memory may be trusted/curated; retrieval readiness decides whether derived search state is ready, pending, or degraded.
- Context impact: Updated - added Project Memory Content Quality State to `CONTEXT.md`.
- ADR impact: Not needed - this preserves the existing markdown/source-of-truth and derived retrieval boundary rather than introducing a hard-to-reverse architecture choice.
- Follow-ups: Pressure-test the agenda for second-layer lifecycle or status questions before finalizing.
