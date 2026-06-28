# Project Memory Retrieval Quality Design Agenda

## Status

- Spec: `spec.md`
- State: Complete
- Completion gate:
  - Live agenda questions resolved: Yes
  - Pressure test complete: Yes
  - Spec finalized: Yes

## Documented Decisions

- Project Memory canonical truth remains markdown plus metadata JSON, not SQLite/vector rows.
- Derived Project Memory retrieval rows should be rebuildable serving state that point back to canonical markdown.
- `project learn` should follow this model: candidate/source intake, curator decision, validated markdown/state writes, then derived retrieval indexing over canonical markdown.
- Base retrieval index pointer creation should be deterministic over markdown paths, sections, and content hashes.
- The Project Memory curator should keep a single responsibility: propose durable Project Memory content and state intent, not retrieval hints. Deterministic Myelin apply code writes canonical markdown and project state after validation.
- Retrieval hints should be produced by a separate hint-generation model over completed markdown plus deterministic structural metadata.
- Hint generation should be mandatory for new memory entries and newly created pages, and optional for existing updated pages/entries when existing hints remain valid and useful. It can still be run on existing memory layers when better semantic recall is needed.
- Creation runs may report `completed_with_pending_index` when canonical markdown/state writes succeeded but mandatory hint generation, embedding, or index refresh did not finish. `completed` means required retrieval indexing finished.
- Hint-generation job state should use both run artifacts for provider output/diagnostics and SQLite job/status rows for retryable serving-state work.
- Creation mode and maintenance mode should share typed lookup-quality and scoped apply-gating semantics.
- Creation mode may rely on fallback markdown lookup because the first trusted Project Memory surface and derived index may not exist yet.
- Maintenance mode should normally use indexed section retrieval; missing, stale, or unavailable index state must be surfaced and scoped rather than hidden.
- Maintenance-mode proposals that depend on fallback lookup must stop for review rather than auto-apply. Creation-mode proposals may use fallback lookup as bootstrap context when direct candidate/source evidence supports the write.
- Explicit no-op decisions apply to any non-empty `project learn` packet that used fallback lookup and produced zero write proposals, in both creation and maintenance modes.
- Artifact-reference prompt transport is implemented for Codex-backed curator runs and is not the active design problem.
- Markdown text search exists as a deterministic bootstrap/fallback lookup, but it is not sufficient as the target Project Memory retrieval quality mechanism.
- Routine low-risk Project Memory updates should auto-apply by default; risky or low-evidence updates must stop before canonical writes.
- Curator output does not directly mutate markdown. Myelin validates and renders structured apply payloads.

## Questions

### Question 1: Lookup quality versus blocking degradation

- Status: Answered
- Branch type: Initial
- Why it matters: The current packet-wide degraded flag blocks every run before apply, including the latest dogfood run where the curator produced zero proposals. The design needs a sharper rule before retrieval indexing can be integrated safely.
- Scenario probe: A runtime inbox candidate asks whether `docs/ROADMAP.md` already covers a follow-up. Lookup uses markdown fallback only. The curator returns zero proposals because it sees no new durable knowledge. Should the run complete, need review, or stop as degraded?
- Options:
  - A. Packet-wide blocking degradation — safest and simplest, but keeps bootstrap lookup quality from dominating the product loop and blocks no-op outcomes.
  - B. Typed degradation with scoped gating — degradation can be blocking, proposal-scoped, or advisory; no-op and unaffected outcomes may complete when the degraded evidence was not needed for a write.
  - C. Proposal-only degradation — degradation matters only when a write proposal exists; fastest path through no-op dogfood, but risks hiding retrieval failures behind empty curator output.
- Recommendation: B. It preserves fail-closed behavior for dependent writes while allowing no-op or unaffected outcomes to complete only when the run can explain that degraded lookup did not authorize a canonical change.
- Answer: Modify the framing. "Degraded" in the dogfood run means lookup used the temporary markdown text-search fallback, not that Project Memory content is bad or canonical state is unsafe. The design should split `lookup_quality`, `lookup_freshness`, and `apply_severity` instead of treating fallback lookup as packet-wide blocking degradation.
- Answer impact: Changes model.
- Spec impact: Updated `Lookup Quality And Apply Gating` to distinguish fallback lookup quality from blocking unsafe packet state.
- Context impact: Updated; `Evidence Dependency` and `Explicit No-Op Decision` capture the durable contract terms that came out of scoped gating.
- ADR impact: Created; ADR 0062 records the broader retrieval boundary and serving-state repair lane.
- Follow-ups: None. Question 6 records the explicit no-op completion policy.

### Question 2: Retrieval unit

- Status: Answered
- Branch type: Initial
- Why it matters: The index unit determines freshness, snippet quality, citation precision, rebuild cost, and how much markdown context the curator receives.
- Scenario probe: A wiki page contains setup guidance, stale migration notes, and a separate operator runbook section. A candidate only concerns the runbook. Should lookup return the whole page, the runbook heading section, or smaller entry blocks?
- Options:
  - A. Whole page — simple and stable, but noisy for mixed-topic pages and weak for proposal-scoped evidence.
  - B. Heading section — good balance of stable canonical refs, focused snippets, and manageable freshness hashes.
  - C. Entry block — most precise for append/update workflows, but depends on stable block structure and may miss page-level context.
  - D. Deterministic heading sections plus category-scoped hint generation — the harness derives page/heading/section records from markdown, while a separate hint-generation model may add category-local keywords/topics/aliases/query phrases as retrieval metadata that improves recall but never owns pointer authority.
- Recommendation: D, with hints stored in mirrored `state/project-memory-retrieval/hints/` files rather than inside `wiki/`, so authoring stays category-scoped without mixing machine-readable metadata into canonical markdown folders.
- Answer: Use deterministic heading sections plus mirrored category-scoped hint files under `state/project-memory-retrieval/hints/`. The Project Memory curator should not write hints; it proposes durable memory content and state intent only, while deterministic Myelin apply code writes canonical markdown/state. Deterministic harness code derives structural metadata, and a separate hint-generation model creates/refreshes semantic keywords/aliases/topics/query phrases. Hint generation is mandatory for new memory entries/pages and optional for existing updated pages/entries when existing hints still validate and remain useful.
- Answer impact: Changes model.
- Spec impact: Updated Proposed Direction and planning boundaries to separate curator responsibility, deterministic structural metadata, and hint-generation flow.
- Context impact: Updated; `Project Memory Retrieval Index`, `Structural Retrieval Metadata`, `Retrieval Hint`, and `Hint Generation Flow` were added to `CONTEXT.md`.
- ADR impact: Created; ADR 0062 records the separation of deterministic pointers, hint generation, and retrieval maintenance.
- Follow-ups: None. Question 4 records deterministic structural freshness, embedding freshness, and usage-driven semantic usefulness.

### Question 3: Markdown fallback role

- Status: Answered
- Branch type: Initial
- Why it matters: The current scanner is useful, but it should not define target retrieval quality or keep every packet permanently degraded.
- Scenario probe: sqlite-vec is unavailable on a machine, but markdown files are readable. Should `project learn` still perform markdown fallback lookup, and what status should that produce?
- Options:
  - A. Keep fallback as advisory lookup — usable for context/no-op, insufficient for dependent auto-apply writes.
  - B. Keep fallback as blocking degradation — always safe, but leaves retrieval index availability as a hard product dependency.
  - C. Remove fallback after index exists — cleaner semantics, but worse bootstrap/debug behavior and less graceful failure.
- Recommendation: A. Markdown fallback should remain deterministic and inspectable, but dependent writes should require indexed/fresh retrieval or direct canonical evidence.
- Answer: Combine typed lookup-quality/scoped gating with mode-specific expectations. Creation mode may rely on fallback markdown lookup because the first trusted Project Memory surface and index may not exist yet. Maintenance mode should normally use indexed section retrieval and can fall back to canonical markdown, but missing/stale index state must be surfaced and should not silently authorize dependent writes.
- Answer impact: Confirms branch and adds mode-specific nuance.
- Spec impact: Updated Proposed Direction to record creation-vs-maintenance lookup expectations.
- Context impact: Not needed; fallback lookup quality remains an implementation status, while the durable domain terms are captured through retrieval index and evidence/no-op concepts.
- ADR impact: Created; ADR 0062 records the relevant retrieval boundary.
- Follow-ups: None. Maintenance fallback can provide context, but fallback-dependent maintenance writes require review.

### Question 4: Index freshness and rebuild ownership

- Status: Answered
- Branch type: Initial
- Why it matters: Project Memory markdown wins over stale indexes, but the system requires a clear owner for detecting stale rows and deciding whether to rebuild, fallback, or stop.
- Scenario probe: A wiki page changed after the Project Memory vector index was built. A query returns an index hit whose content hash no longer matches the markdown file. What happens inside `project learn`?
- Options:
  - A. Query detects stale rows and degrades/falls back; rebuild is explicit operator work.
  - B. Query performs bounded synchronous rebuild for stale/missing rows before returning results.
  - C. Separate index command owns rebuild; `project learn` fails closed if the index is stale.
- Recommendation: A initially. It keeps `project learn` bounded and truthful while leaving room for an explicit indexer/backfill command in the implementation plan.
- Answer: Split freshness into structural freshness, embedding freshness, and semantic usefulness. Structural freshness is deterministic: hints bind to wiki path, section id, and section hash; missing or changed targets make hints stale/orphaned and excluded until refreshed. Embedding freshness is also deterministic: a valid hint under a changed embedding contract needs re-embedding. Semantic usefulness is usage-driven: MCP/CLI query users or agents can flag poor retrieval quality, which creates a hint-refresh signal or candidate without implying the canonical markdown is stale.
- Answer impact: Changes model.
- Spec impact: Added the three-layer freshness model and user/agent retrieval-quality feedback path.
- Context impact: Updated; `Structural Retrieval Metadata`, `Retrieval Hint`, and `Retrieval Maintenance Queue` cover the stable domain vocabulary. Freshness status values remain contract details for later pseudocode.
- ADR impact: Created; ADR 0062 records the retrieval serving-state boundary.
- Follow-ups: Decide whether hint refresh signals are project-memory candidates, a separate retrieval-maintenance queue, or ordinary inbox items.

### Question 5: Proposal evidence dependency tracking

- Status: Answered
- Branch type: Initial
- Why it matters: Scoped degradation only works if validation can tell whether a proposal depended on degraded lookup evidence.
- Scenario probe: The curator proposes updating `wiki/architecture/project-state.md` and cites a candidate source plus two lookup hits. One lookup hit is stale. Should the item be quarantined, eligible if another citation is fresh, or rejected as unsupported?
- Options:
  - A. Require each proposal to declare lookup result ids it depends on — explicit and validator-friendly, but adds contract surface.
  - B. Infer dependency from cited wiki refs and source refs — less curator burden, but weaker and easier to misclassify.
  - C. Treat any degraded lookup in the packet as affecting all proposals — current safety model, but defeats scoped gating.
- Recommendation: A. If scoped gating is selected, proposal dependency should be explicit enough for deterministic validation.
- Answer: A. Curator proposals should explicitly list the lookup result ids or canonical section refs they depend on. Validation should use those declared dependencies to apply scoped gating instead of inferring from citations or blocking every proposal in the packet.
- Answer impact: Confirms branch.
- Spec impact: Added explicit proposal evidence dependency requirements and scoped gating behavior.
- Context impact: Updated; `Evidence Dependency` was added to `CONTEXT.md`.
- ADR impact: Created; ADR 0062 records the derived retrieval and scoped repair boundary.
- Follow-ups: Define exact contract field names during pseudocode or planning.

### Question 6: No-op completion under fallback lookup

- Status: Answered
- Branch type: Follow-up
- Why it matters: After separating fallback lookup quality from blocking packet degradation, the design must distinguish when an empty curator result is a successful no-op versus an inconclusive run. Without this rule, fallback lookup could either block too much work or hide retrieval failures behind zero proposals.
- Scenario probe: `project learn llm-wiki` consumes a Project Memory candidate, uses markdown fallback lookup because the derived retrieval index does not exist yet, and the curator returns zero proposals. The packet includes candidate/source context and approximate markdown matches. Should the run complete, stop for review, or require a stronger no-op explanation?
- Options:
  - A. Complete any zero-proposal run when lookup fallback was available — simplest and unblocks dogfood, but can hide cases where lookup failed to find relevant memory.
  - B. Keep zero-proposal runs in `needs_review` until indexed retrieval exists — safest, but makes fallback lookup nearly useless for progressing real dogfood.
  - C. Complete only when the curator emits an explicit no-op decision with enough canonical markdown/source evidence — allows progress while making the no-op auditable.
- Recommendation: C. It treats fallback lookup as usable context but requires the curator to prove that zero proposals mean "no durable update needed," not "I could not tell."
- Answer: Complete only if the curator emits an explicit no-op decision with cited candidate/source refs and canonical markdown refs it checked. A bare zero-proposal result under fallback lookup is inconclusive and remains reviewable.
- Answer impact: Confirms branch.
- Spec impact: Added explicit no-op completion policy under fallback lookup.
- Context impact: Updated; `Explicit No-Op Decision` was added to `CONTEXT.md`.
- ADR impact: Created; ADR 0062 records the broader retrieval quality boundary; no separate no-op ADR is needed unless implementation changes the auto-apply contract beyond this design.
- Follow-ups: None. Pseudocode should pin the no-op schema shape enough for implementation planning.

### Question 7: Retrieval hint refresh signal ownership

- Status: Answered
- Branch type: Pressure-test
- Why it matters: The design introduces usage-driven semantic usefulness feedback, but does not yet say where poor-retrieval feedback or stale hint refresh work is queued. Without this, retrieval maintenance could get mixed with canonical Project Memory candidates or disappear as an untracked side effect.
- Scenario probe: An MCP query user asks about ranking behavior. The markdown answer exists, but retrieval misses it because hints are weak. The user/agent flags the result as poor retrieval. What durable work item should Myelin create?
- Options:
  - A. Project Memory candidate — reuses existing candidate flow, but risks treating retrieval-hint maintenance as canonical memory content work.
  - B. Runtime inbox item with a retrieval-maintenance layer/type — uses preserved intake semantics and lets `project learn` route it, but requires a new implemented consumer path.
  - C. Dedicated retrieval-maintenance queue — cleanly separates hint/index work from memory content work, but adds another state surface and command lifecycle.
- Recommendation: C for the target design, with B as a bridge if implementing a dedicated queue is too much for the first slice. Retrieval hint refresh is serving-state maintenance, not canonical memory curation.
- Answer: C. Use a dedicated retrieval-maintenance queue. Do not treat foundational serving-state maintenance as out of scope, and do not blur retrieval hint refresh with canonical Project Memory candidates.
- Answer impact: Resolves branch.
- Spec impact: Added dedicated retrieval-maintenance queue requirement and planning boundary.
- Context impact: Updated; `Retrieval Maintenance Queue` was added to `CONTEXT.md`.
- ADR impact: Created; ADR 0062 records queue ownership and curator/hint-generation separation.
- Follow-ups:

## Pressure-Test Result

- Status: Complete
- Checked categories: lifecycle and interruption, state persistence, handoff boundaries, verification evidence, scope control, recovery paths, sequencing, and user review gates.
- Result: Added and resolved Question 7 so poor-retrieval feedback and hint refresh work have a dedicated retrieval-maintenance queue instead of being folded into Project Memory candidates.
- Remaining non-blocking risks: exact JSON field names, hint-refresh queue schema, and embedding/index command boundaries can be pinned during `$pmp-writing-plans` without changing the product behavior.
