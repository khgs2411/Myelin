# Current Briefing Design Agenda

## Status

- Spec: `spec.md`
- State: Grilling
- Completion gate:
  - Live agenda questions resolved: No
  - Pressure test complete: No
  - Spec finalized: No

## Documented Decisions

- Current Briefing is the first useful product surface to design.
- `myelin status <project>` is the likely first delivery mechanism.
- v0 should avoid LLM generation, vector search, Practice/Personal promotion, and broad `project learn` redesign.
- The V2 project layout is `projects/<key>/{sources,wiki,schema,state,log,runs}`.
- Status should be structured first, with prose as convenience.
- Missing schema or state should degrade explicitly rather than silently weakening behavior.

## Questions

### Question 1: Canonical artifact ownership and path

- Status: Answered
- Branch type: Initial
- Why it matters: The artifact path determines whether Current Briefing is treated as curated Project Memory, generated serving state, or a hybrid. Later commands and planners need one stable place to read and update.
- Scenario probe: A future agent starts in a repo with no chat history and runs `myelin status my-project`. Should it inspect a human-maintained wiki page, generated state, or both to know what is current?
- Options:
  - A. `projects/<key>/wiki/current-briefing.md` as canonical, with optional state metadata - keeps the briefing human-reviewable curated memory, but requires conventions for structured status fields.
  - B. `projects/<key>/state/current-briefing.json` as canonical, with human output rendered from JSON - maximizes machine stability, but risks making the briefing less readable and less wiki-like.
  - C. Hybrid: markdown in `wiki/` is canonical, `state/current-briefing.json` is derived metadata/cache - separates human truth from serving state, but introduces a sync boundary.
- Recommendation: C, with a narrow v0 that starts by reading `wiki/current-briefing.md` and only adds state metadata when needed. This matches "markdown is curated truth; SQLite/state is serving state" without overbuilding.
- Answer: Choose the hybrid boundary, but not dual manual maintenance. `wiki/current-briefing.md` is canonical. Any `state/current-briefing.json` or equivalent metadata/cache must be derived automatically from the markdown or omitted until automation is reliable.
- Answer impact: Changes model
- Spec impact: Updated Data / State to forbid manual maintenance of two briefing files.
- Context impact: Not needed; this clarifies artifact ownership for the spec but does not introduce or rename product glossary.
- ADR impact: Not needed; this follows existing "markdown is curated truth; state is serving state" decisions rather than introducing a new durable architectural tradeoff.
- Follow-ups: Ensure later JSON/status contract does not require manually authored duplicate fields.

### Question 2: Minimum v0 briefing fields

- Status: Answered
- Branch type: Initial
- Why it matters: If the artifact tries to be a full project summary, it will blur into Project Memory. If it is too thin, it will not help a new session start smarter.
- Scenario probe: A new agent has 90 seconds before touching code. Which fields must be present for it to avoid re-discovery and avoid stale assumptions?
- Options:
  - A. Minimal: project identity, current state, next action, freshness/degraded notes - fast and focused, but may omit verification and blockers.
  - B. Balanced: identity, current state, recent work, verified facts, blockers/uncertainties, next action, citations - enough for handoff without becoming full docs.
  - C. Expanded: balanced fields plus relevant docs, run inventory, open candidates, and source freshness details - richer, but risks becoming an index page.
- Recommendation: B. It is the smallest shape that captures why the surface matters: continuity, trust, and actionability.
- Answer: Confirm option B. The v0 artifact should include identity, current state, recent work, verified facts, blockers/uncertainties, next action, and citations.
- Answer impact: Confirms branch
- Spec impact: Updated User-Facing Behavior with the required v0 briefing fields.
- Context impact: Not needed; no product term was renamed or newly disambiguated.
- ADR impact: Not needed; this is a scoped artifact-shape decision, not a hard-to-reverse architectural decision.
- Follow-ups: Later status JSON design should decide whether these fields are parsed structurally from markdown or surfaced as markdown plus metadata.

### Question 3: Status output precedence

- Status: Answered
- Branch type: Initial
- Why it matters: Existing `status` shows project/freshness/run details. Current Briefing could become the primary answer, or it could be an attached section. That choice shapes user expectations.
- Scenario probe: `myelin status my-project` has a briefing and stale changed paths. What should the user see first?
- Options:
  - A. Briefing first, then structured state - optimizes for session start, but may hide operational alerts lower in output.
  - B. Operational state first, then briefing - preserves current command feel, but weakens the "what should I know now?" product surface.
  - C. Summary header first, then briefing and alerts as peer sections - balanced, but slightly less direct.
- Recommendation: A, with stale/degraded alerts promoted above or inside the briefing header when urgent.
- Answer: Confirm option A. `myelin status <project>` should show the Current Briefing first, with urgent stale or degraded state promoted above or inside the briefing header.
- Answer impact: Confirms branch
- Spec impact: Updated User-Facing Behavior to make briefing-first status explicit while preserving elevated urgent alerts.
- Context impact: Not needed; no product term was renamed or newly disambiguated.
- ADR impact: Not needed; this is a user-facing precedence decision within the existing Status Facade direction.
- Follow-ups: Later JSON design should preserve structured operational state even when human output is briefing-first.

### Question 4: Missing and stale behavior

- Status: Answered
- Branch type: Risk
- Why it matters: The product must fail loud. A missing or stale briefing should guide repair without making `status` unusable.
- Scenario probe: The project has no briefing, but has freshness state and a latest run. Should status succeed, fail, or return a degraded success?
- Options:
  - A. Degraded success - preserves useful state while making the missing briefing actionable.
  - B. Hard failure - forces the artifact to exist, but makes status less useful during onboarding.
  - C. Silent fallback to old status - avoids disruption, but violates the fail-loud product principle.
- Recommendation: A. Missing briefing is degraded state, not a command failure.
- Answer: Choose option A. Missing or stale Current Briefing should produce degraded success: `status` still returns available project state, but clearly reports the briefing problem and expected repair path.
- Answer impact: Confirms branch
- Spec impact: Updated Error Handling to forbid silent old-status fallback and define missing/stale briefing as degraded success.
- Context impact: Not needed; this applies existing fail-loud/degraded-state vocabulary.
- ADR impact: Not needed; this follows existing fail-closed/degraded behavior principles.
- Follow-ups: Later JSON shape should decide whether the overall response `degraded` flag is true when only the briefing is missing, or whether degradation is scoped per component.

### Question 5: Manual-first versus generated-first v0

- Status: Answered
- Branch type: Initial
- Why it matters: The roadmap allows a manual bypass, but implementation pressure may pull the slice toward generators. This decision controls scope.
- Scenario probe: During v0, who writes the first briefing for an existing project: a human/agent editing markdown, or a command synthesizing one from existing state?
- Options:
  - A. Manual-first artifact - proves usefulness and shape before automation, but requires discipline to keep it updated.
  - B. Deterministic generated artifact from existing state - gives immediate command output, but may be too shallow to prove product value.
  - C. Model-generated artifact - closer to the future vision, but pulls in provider/runtime and verification complexity too early.
- Recommendation: A for v0, with deterministic missing/stale detection in status. Generation can come later once the artifact shape is trusted.
- Answer: Choose option C. Since the repo already has provider infrastructure for invoking Codex, v0 should prove model-generated Current Briefing rather than only manual artifact maintenance. The generation must remain bounded and explicit, not a background worker or broad `project learn` redesign.
- Answer impact: Changes model
- Spec impact: Updated Technical Design, Integrations, Testing Strategy, Planning Boundary Guidance, Acceptance Criteria, and Assumptions to include bounded provider-backed generation.
- Context impact: Not needed; this uses existing Provider Abstraction and Current Briefing terms.
- ADR impact: Not needed yet; using the existing provider abstraction follows ADR 0051 rather than creating a new provider decision.
- Follow-ups: New proving-ground question is required because static `wizepal` and live `class-kit` test different product risks.

### Question 7: First proving-ground project

- Status: Answered
- Branch type: Follow-up
- Why it matters: A static project tests whether generation can read a stable repo and produce a useful briefing. A changing project tests whether Current Briefing handles live drift, stale state, and rapid refresh pressure. The first proof should match the risk we want to learn from.
- Scenario probe: We generate a briefing at 10:00. By 10:05, `class-kit` has changed because active work continued. Should v0 be judged by how well it notices that drift, or should v0 first prove quality on a stable repo like `wizepal`?
- Options:
  - A. Start with static `wizepal` - isolates generation quality and prompt/artifact shape, but does not test freshness under active work.
  - B. Start with live `class-kit` - tests the real session-start problem under drift, but can blur product issues with repo churn.
  - C. Use both in sequence: static `wizepal` as the first golden fixture, then live `class-kit` as the freshness/drift test - more work, but separates quality proof from drift proof.
- Recommendation: C. Use `wizepal` first to validate the artifact shape and generated answer quality, then `class-kit` to test freshness/degraded behavior once the generation path is coherent.
- Answer: Choose option C. Use both projects in sequence: `wizepal` first as the stable generation-quality fixture, then `class-kit` as the active freshness/drift fixture.
- Answer impact: Confirms branch
- Spec impact: Updated Integrations and Testing Strategy with the two-project proof path.
- Context impact: Not needed; this selects validation fixtures, not product terminology.
- ADR impact: Not needed; this is a reversible validation strategy.
- Follow-ups: Later implementation planning should keep these as validation targets, not hardcoded product behavior.

### Question 6: Relationship to Session Memory

- Status: Open
- Branch type: Dependency
- Why it matters: Status currently has a latest-session pointer, but Session Memory is not yet the authoritative current-state source. The design must avoid pretending session recall is solved.
- Scenario probe: The SQLite session store says one thing, `wiki/sessions/*.md` says another, and `current-briefing.md` has a third summary. Which source wins in v0?
- Options:
  - A. Current Briefing wins, with conflicting session sources reported as degraded state - keeps the v0 surface coherent.
  - B. SQLite sessions win - aligns with future structured recall, but may over-trust immature session tooling.
  - C. `wiki/sessions/*.md` wins - matches current status behavior, but preserves a known mismatch from `docs/TODO.md`.
- Recommendation: A for v0. Current Briefing is the curated session-start truth; session sources are supporting signals until recall is redesigned.
- Answer:
- Answer impact:
- Spec impact:
- Context impact:
- ADR impact:
- Follow-ups:

### Question 8: First-slice viability after generation scope

- Status: Answered
- Branch type: Risk
- Why it matters: Provider-backed generation makes Current Briefing more valuable, but it also adds dependencies on provider execution, prompt shape, artifact contract, status delivery, freshness/degraded behavior, and validation fixtures. If this becomes the first implementation slice unchanged, we may knowingly build something that must be redone.
- Scenario probe: We implement generated Current Briefing first, then later redesign source preservation, session recall, and facade response contracts. Was the first implementation still useful as a product proof, or did it create throwaway coupling?
- Options:
  - A. Continue with Current Briefing as the first vertical slice - best product proof, but accepts expected refactor pressure.
  - B. Reframe Current Briefing as a design/discovery spike only, then implement smaller prerequisites first - preserves learning while avoiding premature product coupling.
  - C. Defer Current Briefing entirely and start with foundation tasks such as project layout, source preservation, provider profiles/stubs, and facade response contract - reduces redo risk, but delays the first visible product surface.
- Recommendation: B. Keep Current Briefing as the guiding product proof, but do not implement the full status-integrated generated feature first. Use this design to identify the smallest prerequisite slice that teaches us something and lowers refactor risk.
- Answer: Confirm option B. Pause Current Briefing as an implementation candidate and treat this design as a discovery/north-star artifact. Review all roadmap features and dependencies to choose a smaller first slice before starting a new brainstorming session.
- Answer impact: Changes model
- Spec impact: Updated Open Questions to mark Current Briefing as paused for implementation and dependent on a smaller prerequisite slice.
- Context impact: Not needed; this is a sequencing decision, not terminology.
- ADR impact: Not needed; this is reversible roadmap sequencing.
- Follow-ups: Review roadmap feature areas and dependencies, pick the next smaller slice, then start a new brainstorming session for that slice.
