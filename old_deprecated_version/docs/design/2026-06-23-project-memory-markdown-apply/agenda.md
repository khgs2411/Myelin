# Project Memory Markdown Apply Design Agenda

## Status

- Spec: `spec.md`
- State: Complete
- Completion gate:
  - Live agenda questions resolved: Yes
  - Pressure test complete: Yes
  - Spec finalized: Yes

## Documented Decisions

- Project Memory canonical truth lives in project markdown plus project state, not SQLite.
- `project learn` is the authoritative Project Memory command.
- `project learn` uses two state-derived modes: `create` before trusted curated Project Memory exists, and `maintain` after it exists.
- Creation and maintenance use related but separate curator output contracts.
- The curator returns structured JSON and must not write files.
- Myelin validates curator output deterministically before canonical Project Memory can change.
- Routine low-risk `project learn` output should auto-apply by default; `--dry-run`, `--review`, risky output, invalid output, rejected output, and quarantined output stop before writes.
- The markdown-apply boundary must cover both creation and maintenance modes. A mode may be sequenced later only for product-safety reasons, not workload avoidance.
- Derived Project Memory retrieval indexing, Practice Memory, Personal Memory, and Current Briefing are out of scope for this slice.
- `project ingest` is not restored as a separate Project Memory command.
- After this design is finalized and before `$pmp-writing-plans`, a separate sub-agent must audit the design/spec with `plan-auditor`; `Ready for Development` means ready to proceed to `$pmp-writing-plans`.
- Project Memory Apply Payloads are structured page/entry payloads rendered by deterministic code, not exact markdown patches or `content_intent` write authority.
- Project Memory apply targets all-or-nothing canonical writes with staged outputs and an apply journal for interrupted-promotion recovery.
- Project Memory changesets store bounded before/after snippets for changed blocks or page sections, plus file hashes and provenance; they do not duplicate full pages by default.
- Project Memory apply writes terminal Project Memory Source Consumption records for consumed candidate/handoff refs into project state and mirrors them in run artifacts; candidate/handoff status mutation remains owned by a later reconciler.
- `project learn` preflights incomplete apply journals and recovers by replaying/completing deterministic apply from durable run artifacts before invoking a new curator.
- Trusted Project Memory for apply means `projects/<key>/state/project-memory.json.status === "curated"`. `bootstrap-state.status === "curated"` alone is not enough to treat wiki markdown as trusted maintenance state.

## Questions

### Question 1: Concrete apply payload shape

- Status: Answered
- Branch type: Initial
- Why it matters: The current curator contracts expose `content_intent`, which is insufficient for deterministic canonical writes. This decision defines the contract between provider-written curator output, deterministic validation, and markdown mutation.
- Scenario probe: The curator proposes a setup update: "Document that `project learn` writes apply artifacts." Should the provider return structured paragraphs/evidence for code to render, exact markdown that code inserts after validation, or a patch-like edit against the target page?
- Options:
  - A. Structured page/entry payload rendered by code — strongest deterministic boundary and most consistent provenance rendering, but requires a richer contract and renderer.
  - B. Exact markdown payload inserted into stable blocks — simpler contract and preserves model-authored wording, but validation must police markdown shape and provenance placement more carefully.
  - C. Patch-like changes against target markdown — most flexible for existing pages, but weakest safety boundary and hardest to validate, audit, and keep bounded.
- Recommendation: A. Structured payloads preserve the "agent proposes, code validates, code applies" boundary. They also avoid making arbitrary markdown patches the authority for canonical memory.
- Answer: A. Use structured page/entry payloads rendered by deterministic code. The user agreed this is the right boundary despite the extra contract, validation, and renderer work.
- Answer impact: Confirms branch
- Spec impact: Updated to make structured Project Memory Apply Payloads the selected design rather than an open alternative.
- Context impact: Updated - added `Project Memory Apply Payload` to `CONTEXT.md`.
- ADR impact: Created - `docs/adr/0059-use-structured-project-memory-apply-payloads.md`.
- Follow-ups: None.

### Question 2: Creation publication minimum

- Status: Answered
- Branch type: Initial
- Why it matters: Creation mode marks the first trusted Project Memory surface. If the minimum publishable page set is too loose, Myelin can mark weak memory as curated. If it is too strict, new projects may be blocked by unnecessary page taxonomy.
- Scenario probe: A newly bootstrapped project has an uncurated `wiki/index.md` and the curator returns only a new `index.md` page with high-level purpose and provenance. Is that enough to mark `project-memory.json` as curated, or must creation publish a small required set such as index plus setup/runbook/architecture pages?
- Options:
  - A. Minimal trusted index is enough — fastest path to trusted state, but may leave Project Memory too thin.
  - B. Require index plus at least one domain page or explicit no-domain-pages rationale — balances startup flexibility with a real curated surface.
  - C. Require a fixed first-brain page set — strongest uniformity, but risks forcing speculative pages and generic code summarization.
- Recommendation: B. Require an index plus at least one meaningful page or an explicit reason why no additional page is warranted. This fits the product principle that Project Memory captures what code does not cheaply reveal without forcing generic pages.
- Answer: B. Creation mode must publish a trusted index plus at least one meaningful domain page, or include an explicit no-domain-pages rationale before marking Project Memory curated.
- Answer impact: Confirms branch
- Spec impact: Updated creation apply requirements to include the minimum publishable Project Memory surface.
- Context impact: Not needed - no new durable glossary term emerged.
- ADR impact: Not needed - this is a design-level threshold, not a surprising hard-to-reverse architectural choice.
- Follow-ups: None.

### Question 3: Apply atomicity and recovery

- Status: Answered
- Branch type: Initial
- Why it matters: Apply mutates canonical markdown and state. The design needs a recovery model for partial writes, failed state updates, reruns, and review of changed files.
- Scenario probe: A run needs to write two wiki pages and `state/project-memory.json`. The first page write succeeds, the second page write fails, and state has not been updated. What should the run report, and what should a later rerun rely on?
- Options:
  - A. All-or-nothing per run using temp files and commit/rename discipline — strongest consistency, more implementation work, and clearer failure semantics.
  - B. Best-effort per file with changeset evidence — easier to implement, but future agents must handle partially applied Project Memory.
  - C. Best-effort per item — maximizes progress, but makes provenance, reruns, and state consistency harder to reason about.
- Recommendation: A. Canonical Project Memory should fail closed. If full filesystem transactionality is impractical, the implementation should still stage writes and update state only after all page writes succeed.
- Answer: Modified A. Use an all-or-nothing target with apply journal recovery: render and validate staged outputs, track expected writes and observed promotions, promote canonical files only after the full staged set is ready, update state last, and use the journal to complete or repair interrupted promotion.
- Answer impact: Changes model
- Spec impact: Updated error handling and documented decisions to require staged outputs, an apply journal, state-last updates, and recovery for interrupted promotion.
- Context impact: Not needed.
- ADR impact: Created - `docs/adr/0060-use-apply-journal-for-project-memory-writes.md`.
- Follow-ups: Pressure test should verify recovery behavior and visible canonical consistency.

### Question 4: Changeset evidence depth

- Status: Answered
- Branch type: Initial
- Why it matters: Changesets are the review and recovery trail for auto-applied Project Memory writes. Too little evidence weakens auditability; too much duplicates canonical markdown and bloats run artifacts.
- Scenario probe: A maintenance item changes one entry block. Should `project-memory-changeset.json` store only file hashes and provenance, an entry-level before/after snippet, or the full before/after page content?
- Options:
  - A. Hashes, paths, page/item ids, and provenance only — compact and avoids duplicating canonical pages, but review needs git or file reads for content diff.
  - B. Entry/page-section before/after snippets plus hashes — better local audit trail with bounded artifact size, but requires reliable block extraction.
  - C. Full before/after file content — easiest standalone rollback evidence, but bloats artifacts and duplicates canonical markdown.
- Recommendation: B. Store bounded before/after snippets for changed blocks plus file hashes and provenance. It is a stronger review trail than hashes alone without copying entire pages.
- Answer: B. Store bounded entry/page-section before/after snippets plus file hashes and provenance.
- Answer impact: Confirms branch
- Spec impact: Updated apply artifact requirements to include bounded snippets and to reject full-page duplication by default.
- Context impact: Not needed.
- ADR impact: Not needed - this is an artifact-detail design requirement under the already recorded apply-journal boundary.
- Follow-ups: None.

### Question 5: Candidate and handoff lifecycle after apply

- Status: Answered
- Branch type: Initial
- Why it matters: The next roadmap item routes gaps and inbox items into Project Memory candidates. Successful apply may need to mark consumed candidates/handoffs to avoid re-proposal loops, but doing so may expand this slice into queue lifecycle work.
- Scenario probe: A maintenance item cites `project_candidate:cand_123` and apply writes the corresponding wiki entry. Should this slice mark `cand_123` processed, leave it pending for later candidate routing work, or write only an apply artifact that future candidate routing can consume?
- Options:
  - A. Mark consumed project candidates/handoffs processed during apply — prevents immediate reprocessing, but expands the write set into queue lifecycle semantics.
  - B. Leave candidates/handoffs unchanged and rely on the next roadmap item — keeps scope focused, but may cause repeated proposals until candidate routing lands.
  - C. Write apply artifacts with consumed refs only; candidate lifecycle remains a later deterministic reconciler — preserves this slice boundary while giving the next item evidence.
- Recommendation: C. This slice should record consumed refs in apply artifacts and changesets, but not own candidate/handoff lifecycle unless existing repositories make a narrow status update obviously safe.
- Answer: Modified C. Apply should write terminal Project Memory source-consumption records for consumed candidate/handoff refs, using the tombstone-backed lifecycle pattern of source refs plus terminal decisions plus output refs, but it should not directly mutate candidate/handoff statuses in this slice. Avoid calling these records tombstones because Experience Log tombstones have raw-row archive and lease semantics that do not fit structured Project Memory inputs.
- Answer impact: Changes model
- Spec impact: Updated apply artifacts and data/state sections to include source-consumption records while keeping candidate/handoff lifecycle mutation out of scope.
- Context impact: Updated by Question 6 - added `Project Memory Source Consumption` to `CONTEXT.md` after pressure testing confirmed the state surface.
- ADR impact: Not needed - the term is Project Memory-specific state evidence and does not establish a cross-layer tombstone abstraction.
- Follow-ups: Pressure test should confirm whether source-consumption records live as run artifacts only or also in project state.

### Question 6: Source-consumption record persistence

- Status: Answered
- Branch type: Pressure-test
- Why it matters: Source-consumption records are the bridge between successful apply and later candidate/handoff lifecycle reconciliation. If they live only inside one run directory, future reconciliation may need to scan all runs. If they become project state, this slice owns a new durable index surface.
- Scenario probe: A candidate is consumed by a successful apply run today. Two weeks later, the candidate-routing reconciler needs to mark it processed. Should it search historical run artifacts, read a project-level source-consumption state file, or query a SQLite serving table?
- Options:
  - A. Run artifacts only — smallest canonical write surface, but later reconciliation must scan runs and handle artifact history.
  - B. Project-level state file plus run artifact — easier deterministic reconciliation and still markdown/state rooted, but expands this slice's durable state writes.
  - C. SQLite serving table plus run artifact — query-friendly, but risks making SQLite look like canonical Project Memory lifecycle truth.
- Recommendation: B. Write source-consumption records into a project-level state file and mirror them in the run changeset. This keeps Project Memory lifecycle evidence in project-owned state without making SQLite canonical.
- Answer: B. Write Project Memory Source Consumption records into a project-level state file and mirror them in the run changeset.
- Answer impact: Confirms branch
- Spec impact: Updated data/state and source-consumption requirements to name `projects/<key>/state/project-memory-source-consumptions.json` or equivalent project-level state.
- Context impact: Updated - added `Project Memory Source Consumption` to `CONTEXT.md`.
- ADR impact: Not needed - this is a Project Memory state-surface detail under the apply-source lifecycle, not a separate surprising architectural decision.
- Follow-ups: None.

### Question 7: Apply journal recovery entrypoint

- Status: Answered
- Branch type: Pressure-test
- Why it matters: The apply journal is only useful if recovery ownership is explicit. A later agent should know whether `project learn` automatically recovers interrupted apply work, whether a separate command is required, or whether recovery is only a diagnostic artifact.
- Scenario probe: A previous `project learn` was interrupted after one staged file was promoted but before `project-memory.json` was updated. The operator later runs `myelin project learn llm-wiki`. Should it recover the interrupted apply before invoking the curator, fail and tell the operator to run a recovery command, or ignore the old journal and start a new curator run?
- Options:
  - A. `project learn` auto-recovers or fails before new curator work — strongest safety and least operator burden, but adds preflight complexity to every learn run.
  - B. Dedicated recovery command only — explicit and easier to reason about, but interrupted canonical memory can remain unrepaired until the operator knows to run it.
  - C. Artifact-only recovery guidance — simplest implementation, but too weak for canonical Project Memory consistency.
- Recommendation: A. `project learn` should inspect active/incomplete apply journals before new curator work and either complete safe recovery or fail closed with exact recovery guidance.
- Answer: Modified A. `project learn` preflights incomplete apply journals. If it finds one, it replays or completes the deterministic apply from saved run artifacts, staged outputs or renderable apply payloads, validation, and the journal. It must not rerun the agentic curator as recovery before the interrupted apply is completed or fails closed.
- Answer impact: Changes model
- Spec impact: Updated recovery behavior to distinguish deterministic apply replay from redoing the curator run.
- Context impact: Not needed.
- ADR impact: Not needed if covered by ADR 0060.
- Follow-ups: None.

### External audit refinement: Trusted-state predicate

- Status: Answered
- Branch type: Audit refinement
- Why it matters: Current packet mode code can classify a project as maintenance-ready when either `state/project-memory.json.status` or `state/bootstrap-state.json.status` is `curated`. The apply design needs a stronger predicate so deterministic maintenance writes never treat merely bootstrapped or shell-compatible state as trusted Project Memory.
- Answer: For apply authority, trusted curated Project Memory requires `projects/<key>/state/project-memory.json.status === "curated"`. `bootstrap-state.status === "curated"` may remain compatibility/onboarding context, but it is not sufficient by itself to bypass creation publication or apply maintenance updates to untrusted markdown.
- Spec impact: Updated user-facing behavior and documented decisions with the trusted-state predicate.
- Pseudocode impact: Updated apply gate and flow artifacts to preserve the predicate during planning.

### External audit refinement: Prior ADR path drift

- Status: Answered
- Branch type: Audit refinement
- Why it matters: The external audit verified that several older ADR filenames supplied as context had been renamed or were stale. Future planning should use the existing ADR filenames, not the stale aliases.
- Answer: Current prior ADR paths are `docs/adr/0018-project-learn-can-read-live-repo.md`, `docs/adr/0019-project-learn-auto-applies-by-default.md`, `docs/adr/0020-gate-risky-project-learn-changes.md`, and `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`.
- Spec impact: No change needed; spec already names the current paths.
- Pseudocode impact: Updated pseudocode source notes to identify current ADR paths and avoid stale aliases.

## Pressure-Test Result

- Status: Complete
- Checked categories: lifecycle and interruption; state persistence; handoff boundaries; verification evidence; scope control; recovery paths; planning handoff; user review gates.
- Result: Added and resolved Questions 6 and 7 because the initial agenda resolved the main apply shape but left source-consumption persistence and journal recovery ownership underspecified.
- Remaining non-blocking risks:
  - Exact JSON field names for apply payloads, apply journals, changesets, and source-consumption state remain implementation-level details, but the required ownership, persistence, and recovery semantics are settled.
  - The implementation may choose a concrete state filename equivalent to `project-memory-source-consumptions.json` if it records the divergence during planning.
