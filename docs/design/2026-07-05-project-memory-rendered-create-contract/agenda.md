# Project Memory Rendered Documentation And Create Contract Design Agenda

## Status

- Spec: `spec.md`
- State: Complete
- Completion gate:
  - Live agenda questions resolved: Yes
  - Pressure test complete: Yes
  - Spec finalized: Yes

## Documented Decisions

- Project Memory is living repo documentation, not direct memory-row retrieval.
- Session Memory is recent continuity from captured agent conversations and may create Project Memory leads.
- Project Memory candidates and handoffs are leads only; they do not become durable truth without target-repo exploration and repo-grounded citations.
- Project Memory canonical truth remains markdown plus project state; SQLite/vector rows are derived serving pointers back to markdown.
- While dogfooding Myelin from inside this repo, use CLI commands and repo-local scripts directly. MCP is a later wrapper for agents in other projects.
- The 2026-06-30 `llm-wiki` Project Memory output is product-quality failed even though the pipeline reported `content_quality_status: trusted`.
- The implementation may replace the current Project Memory creation payload, role coverage model, validator shape, prompt contract, generated schemas, state fields, and tests. Backward compatibility with the failed create-mode contract is not required.
- Existing mechanics to preserve only if they fit the new design: target-repo curator cwd, schema-driven curator output, deterministic validation, markdown apply, apply journals, changesets, source-consumption reconciliation, runtime inbox intake, and derived Project Memory retrieval indexing.
- Project Memory creation must use structured section payloads that render real markdown headings. Free-form markdown heading conventions and post-render inference are not the primary contract.
- Project Memory creation must replace the old six-role page taxonomy with an answer-domain documentation map organized around domains future agents need to query and act on.
- Project Memory create mode must use a two-pass evidence workflow: first build a deterministic evidence map for required answer domains, then write documentation from that map.
- First-create Project Memory must pass deterministic validation and an independent model-backed usefulness critique before project state can mark it curated.
- The independent usefulness critique returns `pass`, `review_only`, or `fail`; `blocked` is reserved for deterministic validation or infrastructure conditions.
- First-create Project Memory promotion is all-or-nothing: partial output stays in run artifacts and does not become trusted canonical wiki/state.
- For untrusted dogfood/create reset, Myelin may explicitly delete and recreate the project shell while preserving the repo-root SQLite memory database.
- Failed, shallow, blocked, or review-only first-create runs write compact project state with trust status and run-artifact refs, while detailed diagnostics remain in run artifacts.
- The current quality bug is that creation role coverage is derived from declared `required_sections` and body chars, while rendered markdown exposes only one top-level section per page.

## Questions

### Question 1: Canonical documentation organization

- Status: Answered
- Branch type: Initial
- Why it matters: The old six-role page taxonomy produced plausible page titles without useful documentation. Since backward compatibility is not a constraint, the design should choose the documentation organization that best serves future agents, not the shape that happens to exist today.
- Scenario probe: A future agent asks, "where is the SQLite database stored in Myelin for project/session memory, and how is that different from Project Memory retrieval rows?" The Project Memory query should land on durable markdown that answers the question without requiring broad repo rediscovery. What page/section organization makes that outcome most reliable?
- Options:
  - A. Answer-domain documentation map — replace the six-role taxonomy with required answer domains such as product model, storage/retrieval, command workflows, curation/apply lifecycle, evidence/provenance, and current work/decisions. Strongest fit for the product vision; requires a new create contract and validation model.
  - B. Keep six stable role pages with stricter required sections — preserve the current taxonomy but make every role publish real sections and required topics. Lower conceptual churn; risks keeping a page model that already encouraged shallow role-shaped output.
  - C. Curator-designed wiki map with mandatory index and answerability gates — let the curator choose page taxonomy from repo evidence, while deterministic checks ensure required questions are answerable. Most flexible; harder to make deterministic and consistent across projects.
- Recommendation: A. Project Memory should be organized around the domains future agents need to answer, not around generic role labels. The six old roles can become inspiration, but they should not be the primary contract.
- Answer: A. Replace the six-role taxonomy with an answer-domain documentation map.
- Answer impact: Changes model.
- Spec impact: Updated the settled direction to make answer-domain documentation the primary create-mode organization contract. The old six roles may inform coverage but are no longer the primary contract.
- Context impact: Updated `CONTEXT.md` with Answer-Domain Documentation Map.
- ADR impact: Created ADR 0063 because replacing the page-role taxonomy is a durable product contract with real alternatives.
- Follow-ups: Question 2 is now highest leverage because the selected answer-domain model depends on how create mode discovers and maps evidence for each required domain.

### Question 2: Create-mode evidence exploration boundary

- Status: Answered
- Branch type: Dependency
- Why it matters: Project Memory creation must inspect the target repo deeply enough to write useful documentation, but unbounded exploration can become slow, noisy, and hard to reproduce. The design needs a clear boundary for what create mode must inspect before it is allowed to publish.
- Scenario probe: A repo has product docs, ADRs, CLI docs, and implementation spread across `src/project`, `src/memory`, `src/query`, and `src/runtime`. A candidate says "document SQLite memory storage." Should create mode follow a fixed manifest, perform a discovery pass to find storage-specific code, or let the curator explore freely inside the repo?
- Options:
  - A. Two-pass evidence workflow — first build a deterministic evidence map from default surfaces plus repo searches for required answer domains, then ask the curator to write from that map. Strongest reproducibility and depth; more implementation work.
  - B. Fixed orientation manifest — require known docs and source directories, with no separate discovery phase. Simpler and bounded; may miss repo-specific files that are not in the manifest.
  - C. Broad read-only curator exploration — invoke the curator inside the repo and let it inspect whatever it needs, with strict output validation after. Flexible; weaker reproducibility and harder to debug failed coverage.
- Recommendation: A. A two-pass evidence workflow matches the product: candidates are leads, the system explores bounded repo evidence, then documentation is written from cited sources.
- Answer: A. Use a two-pass evidence workflow.
- Answer impact: Confirms branch and extends the model.
- Spec impact: Updated the settled direction to require an evidence-map pass before curator writing. Candidates and Session Memory remain leads; the evidence map is the repo-grounded bridge from lead to documentation.
- Context impact: Updated `CONTEXT.md` with Two-Pass Evidence Workflow.
- ADR impact: Created ADR 0064 because this is a durable create-mode architecture decision with real alternatives.
- Follow-ups: Question 3 is now highest leverage because the selected evidence workflow still needs a trust gate that decides whether the written documentation is useful enough to mark curated.

### Question 3: Quality gate authority

- Status: Answered
- Branch type: Dependency
- Why it matters: The failed dogfood passed because the validator checked mechanical shape instead of usefulness. The design must decide whether usefulness is enforced only by deterministic checks or also by an independent model-backed review before marking Project Memory curated.
- Scenario probe: A create run publishes sectioned markdown with citations and passes deterministic topic checks, but the prose is still too generic for a future agent to rely on. Should Myelin block that run through an independent reviewer, mark it review-only, or rely on deterministic gates plus later dogfood?
- Options:
  - A. Deterministic gate plus model-backed critique — deterministic checks enforce structure/citations/answer-domain coverage, then a separate reviewer critiques usefulness before `curated`. Strongest quality bar; adds latency/cost and another provider output contract.
  - B. Deterministic gate only — rendered sections, citations, topic coverage, and answerability fixtures decide trust. More reproducible; may still miss generic-but-passing prose.
  - C. Deterministic gate with mandatory human dogfood before curated for first-create only — avoids trusting model review; slows the loop and prevents full automation of first-create.
- Recommendation: A for first-create Project Memory. The product failed on usefulness, not parseability; an independent critique gives us another guardrail before state says `curated`.
- Answer: A. Require deterministic gates plus an independent model-backed critique before first-create Project Memory can be marked curated.
- Answer impact: Confirms branch.
- Spec impact: Updated the settled direction to add an independent usefulness critique after deterministic validation. The critique reviews rendered markdown and evidence map, and it gates first-create curated state.
- Context impact: Updated `CONTEXT.md` with Independent Usefulness Critique.
- ADR impact: Created ADR 0065 because this adds a durable trust gate with cost/latency tradeoffs.
- Follow-ups: Question 4 is now highest leverage because the selected trust gate needs a write strategy for partial or failed first-create output.

### Question 4: First-create write strategy

- Status: Answered
- Branch type: Risk
- Why it matters: If create mode can rewrite the whole wiki, it needs a policy for partial success. The design must decide whether first-create is all-or-nothing, can publish trusted subsets, or writes review-only drafts when coverage is incomplete.
- Scenario probe: The curator produces excellent storage/retrieval and command workflow pages, but weak current-work and decisions pages. Should Myelin publish the strong pages and mark the project partially curated, write everything as review-only drafts, or fail the run before canonical wiki writes?
- Options:
  - A. All-or-nothing curated create — first-create only marks curated when the full required documentation contract passes. Prevents false trust; may discard useful partial docs unless preserved as run artifacts.
  - B. Publish trusted subsets with incomplete project status — canonical markdown can contain trusted pages while project state says `partial`. More incremental; complicates query/status semantics.
  - C. Write review-only draft wiki pages for failed create runs — preserves useful work in wiki paths but clearly marks untrusted. Convenient for review; risks future agents reading untrusted markdown as truth.
- Recommendation: A. For first-create, avoid partial canonical trust. Preserve drafts in run artifacts and only promote to canonical wiki/state when the complete contract passes.
- Answer: A. First-create canonical wiki/state promotion is all-or-nothing.
- Answer impact: Confirms branch.
- Spec impact: Updated the settled direction so failed, shallow, blocked, review-only, or partially successful first-create output remains in run artifacts and does not become trusted canonical Project Memory.
- Context impact: Not needed; no new project-specific term is required beyond existing Project Memory Creation Mode and Content Quality State.
- ADR impact: Not needed; this is the least surprising consequence of rejecting partial canonical trust.
- Follow-ups: Question 5 is now highest leverage because all-or-nothing promotion still needs durable failed-run state and resume visibility.

### Question 5: Failed-run state and resume visibility

- Status: Answered
- Branch type: Risk
- Why it matters: Failed or shallow create runs should not vanish, but project state should not become a duplicate of run artifacts. The design needs a durable way for future sessions to know whether Project Memory is trusted, shallow, blocked, or awaiting review.
- Scenario probe: A create run fails because SQLite/query answerability is missing. Five days later a new agent opens the project. What should it read to learn that Project Memory is not curated and why the previous run failed?
- Options:
  - A. Compact project state plus run-artifact refs — `project-memory.json` stores trust status, quality contract version, latest run ref, and diagnostic artifact refs. Detailed findings remain in run artifacts. Balanced and inspectable.
  - B. Full quality diagnostics in project state — project state contains every missing topic, section finding, and citation issue. Easy to inspect; bloats state and duplicates artifacts.
  - C. Run artifacts only until curated — project state remains absent or uncurated until success. Cleanest; weak continuity after failed or shallow runs.
- Recommendation: A. Store compact state and artifact refs for all terminal create outcomes, while keeping detailed diagnostics in run artifacts.
- Answer: A. Failed, shallow, blocked, or review-only first-create runs should write compact project state with artifact refs.
- Answer impact: Confirms branch.
- Spec impact: Updated the settled direction so `project-memory.json` acts as a resume pointer for all terminal create outcomes, while detailed diagnostics stay in run artifacts.
- Context impact: Not needed; this refines Project Memory Content Quality State rather than introducing a new term.
- ADR impact: Not needed; compact state plus artifact refs follows the existing state/artifact split.
- Follow-ups: Live initial agenda is answered. Run pressure-test pass before finalizing.

### Question 6: Untrusted existing project shell handling

- Status: Answered
- Branch type: Pressure-test
- Why it matters: The current repo already has precedent for failed or shallow Project Memory markdown, and the current curator contract includes `untrusted_existing_markdown_policy`. With all-or-nothing first-create, planners need to know whether preexisting untrusted wiki files are ignored, archived, rewritten in place, or selectively adopted.
- Scenario probe: `projects/llm-wiki/wiki/` contains markdown from a previous failed or shallow dogfood run, while `project-memory.json` says the project is uncurated or shallow. A new first-create run is about to build an answer-domain evidence map. Should those wiki files be treated as evidence, removed from the canonical wiki surface before the run, rewritten in place, or selectively adopted?
- Options:
  - A. Archive-and-recreate — before trusted first-create promotion, move untrusted wiki files and related retrieval state to a timestamped baseline/archive, then create from an empty canonical wiki surface. Clearest trust boundary; requires reset/archive mechanics.
  - B. Read-only evidence, then full rewrite — keep untrusted markdown in place as explicitly labeled evidence, but require successful first-create to rewrite all canonical Project Memory pages. Less file churn; risks accidental retrieval/use of untrusted files before success.
  - C. Selective adoption — allow create mode to adopt useful untrusted pages or sections if evidence and critique pass. Most reusable; complex and risks laundering bad docs into the new contract.
- Recommendation: A. Archive-and-recreate keeps the trust boundary simple: untrusted markdown can be preserved, but it should not remain in the canonical wiki path while first-create decides trusted Project Memory.
- Answer: A, modified to delete and recreate. For a clean create command or dogfood reset, it is acceptable to completely remove and rebootstrap the existing project shell. Root SQLite memory state, including Session Memory and Memory Candidates keyed by project, should be preserved unless the operator explicitly asks to wipe memory.
- Answer impact: Changes model.
- Spec impact: Updated the design from archive-only wiki reset to clean project-shell rebootstrap: delete/recreate `projects/<key>/` material, rerun bootstrap, preserve `state/memory.db`, then run first-create from the clean shell plus preserved memory-layer rows.
- Context impact: Updated `CONTEXT.md` with Clean Rebootstrap Reset.
- ADR impact: Created ADR 0066 because destructive project-shell reset while preserving root memory state is a durable and non-obvious boundary.
- Follow-ups: Pressure-test branch resolved. Re-run pressure-test pass before finalizing.

## Pressure-Test Result

- Status: Complete
- Checked categories: lifecycle/interruption, state persistence, handoff boundaries, verification evidence, scope control, recovery paths, sequencing, user review points.
- Result: Initial pass found Question 6. After the clean rebootstrap decision, no additional design questions were found.
- Remaining non-blocking risks:
  - The exact CLI spelling for clean reset/rebootstrap belongs to implementation planning, not this design agenda.
