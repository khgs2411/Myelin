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

- [x] `done` ~~Bun/TypeScript CLI entrypoint and command registry.~~
- [x] `done` ~~Runtime helpers for repo-safe paths, JSON state, project discovery, IDs, subprocesses, and provider execution.~~
- [x] `done` ~~Provider abstraction for Codex and Claude through authenticated local CLIs.~~
- [x] `done` ~~`myelin.config`, `.env`, and process-env precedence.~~
- [x] `done` ~~SQLite runtime selection for local vector-extension use, including vendored runtime support and macOS fallback.~~

Evidence: `src/cli.ts`, `src/commands/registry.ts`, `src/runtime/*`, `src/memory/sqlite-runtime.ts`, `myelin.config`

## Roadmap Step 1: Project Shell And Capture

Goal: register software repos, capture agent work, and keep discovery scoped to current projects.

- [x] `done` ~~`myelin bootstrap <key> --repo <path>` creates a project shell.~~
- [x] `done` ~~Bootstrap repairs existing project shells without deleting preserved material.~~
- [x] `done` ~~`myelin project list` shows active projects by default.~~
- [x] `done` ~~Project discovery routes only current active project configs by default.~~
- [x] `done` ~~Capture hooks persist provider-neutral Experience Log rows for bootstrapped projects.~~
- [x] `done` ~~Capture records repo path, git branch, git commit, and worktree id when available.~~
- [x] `done` ~~Capture is fail-open and records hook errors instead of breaking agent workflow.~~

Current active projects expected in normal routing:

- `class-kit`
- `llm-wiki`
- `senshi`
- `wizepal`

Evidence: `src/commands/bootstrap.ts`, `src/commands/project.ts`, `src/runtime/projects.ts`, `src/capture/facade.ts`, `src/capture/git-context.ts`, `src/memory/experience.ts`

## Roadmap Step 2: Session Memory Layer

Goal: accurate, relevant project-scoped continuity from recent work.

- [x] `done` ~~Top-level `myelin ingest <key>` starts detached provider-backed Experience Log to Session Memory work.~~
- [x] `done` ~~Ingest uses tombstone-backed leases so raw Experience Log rows are not deleted before terminal output.~~
- [x] `done` ~~Ingest writes trusted Session Memories, Memory Candidates, layer handoff instructions, supersession links, retractions, noops, and terminal tombstone state.~~
- [x] `done` ~~Ingest preserves branch context as metadata and does not fail just because a repo is not on `master`.~~
- [x] `done` ~~Prompt-size packing budgets instructions, leased evidence, and reconciliation context together.~~
- [x] `done` ~~Session Memory writes create pending embedding metadata.~~
- [x] `done` ~~`myelin memory index session <key>` indexes pending Session Memories through the active embedding contract.~~
- [x] `done` ~~Query embeddings are cached.~~
- [x] `done` ~~`myelin memory query <key> "<question>"` retrieves indexed active Session Memories.~~
- [x] `done` ~~`memory query --branch current|<name>` filters Session Memory by branch context.~~
- [x] `done` ~~Query returns explicit degraded states when sqlite-vec, embeddings, or indexed rows are unavailable.~~
- [x] `done` ~~Capture can schedule auto-maintenance after enough queued Experience Log rows exist.~~
- [x] `done` ~~Auto-maintenance is detached, lock-guarded, cooldown-guarded, and prevents recursive self-capture.~~
- [x] `done` ~~Auto-maintenance runs ingest, waits for ingest drain, and indexes pending Session Memory embeddings.~~

Evidence: `src/commands/ingest.ts`, `src/ingest/*`, `src/memory/session-memories.ts`, `src/memory/candidates.ts`, `src/memory/handoffs.ts`, `src/memory/session-memory-query.ts`, `src/maintenance/auto-memory-maintenance.ts`, `src/maintenance/worker.ts`

## Roadmap Step 3: Project Memory Layer

Goal: maintain curated, human-readable project truth in `projects/<key>/wiki/` with machine-readable state and provenance.

Project Memory is the first durable curation layer. It should capture what the repo alone does not cheaply reveal: product behavior, feature intent, setup, runbooks, decisions, current state, contradictions, and provenance. It should not become a generic code summarizer, a Session Memory replacement, or a place for unverified free-form agent claims.

Step 3 is complete when `project learn <key>` can safely maintain Project Memory from bounded evidence, with validated curator output and provenance-backed markdown updates.

Step 3 foundation is complete. Step 3.5 completed transport, retrieval-quality, and schema-output hardening. The 2026-06-30 dogfood output proved the mechanics but not the memory-layer quality bar, so Step 4 now owns Project Memory shape, creation, maintenance, and producer-routing redesign before Current Briefing resumes in Step 4.5.

- [x] `retired` ~~The old Phase-0 `project learn` / `project ingest` runner scaffold has been removed from the active Project Memory command surface.~~
  - Why: `project learn` now owns Project Memory curation through the mode-scoped Project Memory Curator pre-write flow, while top-level `ingest <key>` remains Session Memory / Experience Log ingest.
- [x] `retired` ~~The obsolete Phase-0 Project Memory stage assets have been removed from live runtime assets.~~
  - Why: Project Memory curation now starts from curator contracts, packet input, validation, and run artifacts instead of generic staged proposal/apply scaffolding.
- [x] `done` ~~`project packet <key>` builds a read-only bounded Project Memory packet from project state, wiki markdown, pending project handoffs/candidates, recent Session Memory, and deterministic markdown lookup results.~~
  - Why: the curator needs a bounded project-specific evidence bundle instead of unbounded rediscovery or raw conversation history.
- [x] `done` ~~Project Memory lookup reports degraded state because it is currently deterministic markdown text search, not a derived metadata/vector index.~~
  - Why: we need honest retrieval quality signals; weak lookup is acceptable as a temporary existence check only if it is clearly labeled.
- [x] `done` ~~Evolve `project learn` from a Phase-0 pipeline scaffold into a Project Memory Curator pre-write flow.~~
  - Description: `project learn` builds the Project Memory packet, invokes the mode-scoped curator, validates the result, and records curator artifacts before any apply decision.
  - Why: the command answers the question "what durable project knowledge changed?" through a bounded, inspectable proposal contract before canonical writes are considered.
- [x] `done` ~~Define the Project Memory Curator output schema and validation contract.~~
  - Description: Define the structured proposal format returned by the curator and the deterministic validation rules Myelin applies before any proposal can become canonical Project Memory.
  - Why: before an agent can affect durable memory, Myelin needs a strict contract for what the curator may claim, update, create, reject, or mark uncertain.
- [x] `done` ~~Make `project learn` use the Project Memory packet as its curator input.~~
  - Description: `project learn` should pass the bounded Project Memory packet to the curator as the authoritative input bundle for deciding what durable project knowledge changed.
  - Why: `project learn` should reason from the same bounded evidence contract that we can inspect, test, and reuse later for Practice and Personal Memory.
- [x] `done` ~~Reject invalid Project Memory Curator proposals before wiki writes.~~
  - Description: Curator proposals that are malformed, unsupported, out of scope, too broad, or missing provenance should stop before touching markdown.
  - Why: Project Memory is trusted by future agents, so malformed, unsupported, low-confidence, or provenance-free output must fail before it changes canonical files.
- [x] `done` ~~Apply bounded page updates with provenance.~~
  - Description: `project learn` can apply validated structured Project Memory Apply Payloads for creation and maintenance through deterministic markdown rendering, staged outputs, apply journals, changesets, source-consumption state, and recovery preflight.
  - Why: accepted low-risk curation now becomes durable markdown/state only after validation, while dry-run, review, invalid, rejected, quarantined, degraded, or unsupported output stops before canonical writes.
  - Progress: implemented on 2026-06-24 and reviewed. Follow-up fixes closed journal terminal-artifact gaps, unpromoted and observed-promotion recovery drift, temp-file promotion, missing-artifact recovery failure reporting, and the explicit `no-domain-pages` creation rationale path.
- [x] `done` ~~Reconcile Project Memory source-consumption records with pending candidates and handoffs.~~
  - Description: Applied Project Memory source-consumption records should retire or terminally account for the consumed candidate and handoff refs without making apply directly own candidate/handoff mutation.
  - Why: markdown apply now records consumed Project Memory sources, but pending curator input should not keep re-feeding sources that already became canonical memory.
  - Progress: implemented on 2026-06-25. `project learn` now runs a deterministic source-consumption reconciler after apply recovery and before packet construction, moving consumed project candidates and project handoffs to `processed` in root SQLite while keeping apply and packet building separate.
- [x] `done` ~~Add the V2 runtime durable-memory candidate inbox and Project Memory intake boundary.~~
  - Description: Operators, runtime agents, and future tools can explicitly create project-scoped inbox candidate items that are validated, preserved with provenance, and normalized into `memory_candidates` for `project learn`.
  - Why: Session Memory already creates automated candidates; Project Memory also needs an intentional runtime proposal path that shares the same downstream curator lifecycle without making Session Memory or the tool layer own Project Memory writes.
  - Progress: implemented on 2026-06-28. `memory inbox create` writes immutable Project runtime inbox JSON under `projects/<key>/sources/inbox/<id>.json`, `memory inbox intake` normalizes valid items into idempotent `needs_review` `project.inbox` candidates, and `project learn` runs the same intake service after source-consumption reconciliation and before packet construction.
    Completed markdown-apply acceptance evidence:

- [x] ~~Proposed markdown changes are bounded to known pages or explicit new-page requests.~~
- [x] ~~Every proposed durable memory update carries provenance or an explicit inference label.~~
- [x] ~~Apply consumes validated curator artifacts, not raw provider output.~~
- [x] ~~Invalid, rejected, quarantined, degraded, dry-run, or review-required curator output cannot mutate canonical wiki files.~~
- [x] ~~Apply journals stay recoverable until apply result and changeset artifacts exist.~~
- [x] ~~Recovery fails closed on missing apply artifacts, unpromoted canonical hash drift, or observed-promotion drift.~~
- [x] ~~Tests prove accepted low-risk output updates only the expected markdown/state files.~~
- [x] ~~Final reported verification: targeted markdown-apply regressions, full `bun test` at 308 tests, `bun run typecheck`, and `git diff --check`.~~

Completed runtime-inbox/intake acceptance evidence:

- [x] Runtime inbox item files are preserved as pretty JSON under `projects/<key>/sources/inbox/<id>.json`.
- [x] Runtime inbox creation creates lazy source indexes and does not create candidate rows.
- [x] Unsupported layers, invalid input, unknown projects, and duplicate ids fail before unsafe source writes.
- [x] Intake creates exactly one `needs_review` `project.inbox` candidate per valid Project runtime inbox item.
- [x] Repeated intake reports existing or terminal duplicates without inserting duplicate candidates.
- [x] Malformed or unsupported source files degrade intake without rewriting source files or reaching curator packet input.
- [x] `project learn` runs runtime inbox intake before packet construction and records `runtime-inbox-intake.json`.
- [x] Final reported verification: focused affected suites at 37 tests, full `bun test` at 331 tests, `bun run typecheck`, and `git diff --check`.

Evidence: `src/commands/project.ts`, `src/commands/memory.ts`, `src/inbox/runtime-inbox-items.ts`, `src/project/project-memory-candidate-intake-service.ts`, `src/project/project-memory-packet.ts`, `src/project/project-memory-lookup.ts`, `src/project/project-memory-curator-contracts.ts`, `src/project/project-memory-apply-contracts.ts`, `src/project/project-memory-curator-validator.ts`, `src/project/project-memory-markdown-renderer.ts`, `src/project/project-memory-markdown-applier.ts`, `src/project/project-memory-curator-service.ts`, `src/runtime/project-run-infrastructure.ts`

## Roadmap Step 3.5: Project Memory Transport And Retrieval Quality

Goal: correct the dogfood-discovered Project Memory reliability and retrieval gaps before adding more producer integrations.

The first real `project learn llm-wiki` dogfood showed that the Project Memory foundation works mechanically, but also surfaced three product-shape issues: curator prompts should not inline large packet evidence when Codex can read run artifacts, Project Memory lookup should not remain markdown text search once it is gating durable curation, and curator output should be constrained by an authoritative machine-readable contract instead of prompt prose that can drift from TypeScript validation.

Step 3.5 is complete when `project learn` uses artifact-reference prompt transport for Codex-backed curator stages, Project Memory lookup quality has a designed target architecture, curator output is driven by an authoritative schema artifact, and dogfooding can proceed without prompt-size workarounds, bootstrap-only lookup degradation, or schema-shape prompt drift dominating the apply decision.

- [x] `done` ~~Switch Codex-backed Project Memory curator prompts to artifact-reference transport.~~
  - Description: Write the full Project Memory packet as a run artifact and prompt Codex with compact instructions plus artifact paths, instead of inlining the entire packet in stdin.
  - Why: Codex-backed agents can read repository files under read-only sandboxing; prompt text should carry instructions and artifact references, while large evidence belongs in inspectable run artifacts.
  - Boundary: Keep the transport boundary provider-aware. Codex can use artifact references now; unsupported providers may keep an inline bounded fallback until they have equivalent file/artifact semantics.
  - Progress: implemented on 2026-06-28. `project learn` now writes the full packet artifact and invokes the curator with an artifact-reference prompt; inline bounded packet transport remains available as a fallback. Dogfood rerun `2026-06-28T11-21-13.506Z-run` used `transport: artifact_reference`, `prompt_chars: 641`, full `packet_chars: 222792`, `lookup_matches: 125`, and stopped only because the current lookup is still markdown text search.
  - Refs: `src/project/project-memory-prompt-budget.ts`, `src/project/project-memory-curator-service.ts`, `tests/project/project-memory-prompt-budget.test.ts`, `tests/project/project-memory-curator-service.test.ts`, `projects/llm-wiki/runs/project-learn/2026-06-28T11-21-13.506Z-run/prompt-budget.json`, `projects/llm-wiki/runs/project-learn/2026-06-28T11-21-13.506Z-run/input-packet.json`, `projects/llm-wiki/runs/project-learn/2026-06-28T11-21-13.506Z-run/curator-run-result.json`.
- [x] `done` ~~Review the current Project Memory lookup implementation against the dogfood failure mode.~~
  - Description: Brainstorm the existing markdown text-search lookup, why it degraded the packet, what it was meant to bootstrap, and which parts should survive into the target retrieval architecture.
  - Why: lookup quality now blocks the first real Project Memory apply path, so the design should be revisited before gap/stale producers add more inputs.
  - Apply-gating note: the latest dogfood run stopped because the packet was degraded even though the curator draft contained zero proposals. The review should decide whether degraded lookup always blocks canonical writes/review completion, or only blocks proposals that depend on low-quality lookup evidence.
  - Progress: implemented on 2026-06-28. Lookup quality is now typed as fallback/indexed/unavailable with freshness and apply severity. Fallback markdown lookup is advisory in creation mode and proposal-scoped in maintenance mode instead of packet-wide blocking. Explicit no-op decisions are required for non-empty fallback packets with zero write proposals, and maintenance writes depending on fallback lookup stop for review.
  - Refs: `src/project/project-memory-retrieval-contracts.ts`, `src/project/project-memory-lookup.ts`, `src/project/project-memory-packet.ts`, `src/project/project-memory-curator-validator.ts`, `src/project/project-memory-curator-service.ts`, `tests/project/project-memory-lookup.test.ts`, `tests/project/project-memory-packet.test.ts`, `tests/project/project-memory-curator-validator.test.ts`, `tests/project/project-memory-curator-service.test.ts`, dogfood evidence in `projects/llm-wiki/runs/project-learn/2026-06-28T19-12-14.791Z-run/input-packet.json`.
- [x] `done` ~~Draft pseudocode for Project Memory derived retrieval indexing.~~
  - Description: Use pseudocode artifacts to shape index storage, indexing flow, query flow, freshness checks, and packet integration before implementation planning.
  - Why: retrieval indexing is a core memory-layer boundary and should be designed deliberately instead of grown from the temporary markdown scanner.
  - Progress: completed through the 2026-06-28 design set under `docs/design/2026-06-28-project-memory-retrieval-quality/`, including pseudocode, audited plan set, and executor chunks for contracts, section manifests, storage, queueing, indexing, hints, gating, and lifecycle.
  - Refs: `docs/design/2026-06-28-project-memory-retrieval-quality/spec.md`, `docs/design/2026-06-28-project-memory-retrieval-quality/plan.md`, `docs/design/2026-06-28-project-memory-retrieval-quality/pseudocode/`.
- [x] `done` ~~Build a derived Project Memory retrieval index that points back to canonical wiki files.~~
  - Description: Build lookup state that helps agents find relevant Project Memory pages or sections without making SQLite the source of truth.
  - Why: agents will need better Project Memory retrieval, but indexes should derive from canonical markdown rather than becoming another source of truth.
  - Shape: Project Memory remains canonical in `.md` files. SQLite/vector rows are disposable serving state that store embeddings, page or section pointers, and freshness hashes. Query uses vector hits to select relevant wiki files or sections, then answers from the markdown source.
  - Boundary: Session Memory rows are trusted memory records in SQLite; Project Memory vector rows are not trusted memory records. They are rebuildable pointers into trusted markdown.
  - Rebuild rule: if the SQLite index is missing, stale, or disagrees with markdown, markdown wins and the index should be rebuilt from wiki files.
  - Progress: implemented on 2026-06-28. Myelin now extracts deterministic section manifests, stores Project Memory retrieval embedding rows keyed by section and hint hashes, indexes section vectors through `memory index project`, tracks retrieval maintenance queue items, validates category-scoped semantic hint files, records hint jobs, and refreshes retrieval metadata after successful `project learn` applies. The remaining product gap is using the derived vector index as the pre-write lookup source instead of reporting fallback markdown lookup when no usable index is selected.
  - Refs: `src/project/project-memory-markdown-sections.ts`, `src/project/project-memory-hints.ts`, `src/project/project-memory-hint-generator.ts`, `src/memory/project-memory-retrieval-storage.ts`, `src/memory/project-memory-retrieval-indexer.ts`, `src/memory/project-memory-hint-jobs.ts`, `src/memory/retrieval-maintenance-queue.ts`, `src/commands/memory.ts`, `tests/memory/project-memory-retrieval-indexer.test.ts`, dogfood retrieval result `projects/llm-wiki/runs/project-learn/2026-06-28T19-12-14.791Z-run/project-memory-retrieval-index-result.json`.
- [x] `done` ~~Dogfood `project learn llm-wiki` against a real Project Memory candidate.~~
  - Description: Run the same runtime-inbox-derived Project Memory candidate through `project learn` and verify packet input, curator behavior, markdown/state output or review gating, candidate/source lifecycle, prompt transport, and retrieval quality.
  - Why: this is the first point where Project Memory maintenance can be tested as a real product loop instead of isolated mechanics; the first dogfood found architectural issues that Step 3.5 owned.
  - Progress: completed on 2026-06-28 with live run `projects/llm-wiki/runs/project-learn/2026-06-28T19-12-14.791Z-run`. The run used `transport: artifact_reference` (`prompt_chars: 967`, `packet_chars: 296625`, `lookup_matches: 125`), validated successfully, applied canonical markdown/state writes, and ended `completed_with_pending_index` because mandatory semantic hint generation remains pending. Fallback markdown lookup was `lookup_quality: fallback`, `lookup_freshness: not_applicable`, `apply_severity: advisory`, with `packet.degraded: false`, so fallback lookup no longer dominated the apply decision. Structural retrieval indexing completed (`indexed: 74`, `pending_remaining: 0`).
  - Refs: runtime inbox source `projects/llm-wiki/sources/inbox/2026-06-28T10-11-25.076Z_4a7d5d.json`; normalized candidate id `project_inbox:llm-wiki:2026-06-28T10-11-25.076Z_4a7d5d`; failed prompt-size run `projects/llm-wiki/runs/project-learn/2026-06-28T10-11-48.488Z-run`; bounded inline retry `projects/llm-wiki/runs/project-learn/2026-06-28T10-35-30.982Z-run`; artifact-reference retry `projects/llm-wiki/runs/project-learn/2026-06-28T11-21-13.506Z-run`; successful retrieval-quality run `projects/llm-wiki/runs/project-learn/2026-06-28T19-12-14.791Z-run`.
- [x] `done` ~~Make Project Memory curator output schema-driven.~~
  - Description: Provide an authoritative machine-readable output contract for `ProjectMemoryCreationDraft` and `ProjectMemoryMaintenanceProposal`, write the applicable contract into each `project learn` run, and have the curator read that artifact alongside `input-packet.json`.
  - Why: dogfooding showed that prompt prose can drift from deterministic validation; the curator produced conceptually useful output that failed because refs, path kinds, wiki paths, and inference labels did not match the real contract. This takes precedence over producer routing because more candidate producers would only feed a brittle curator boundary.
  - Shape: Keep prompt prose focused on intent, policy, and evidence boundaries. Make the contract artifact the source of truth for output shape, and use provider structured-output support where available instead of manually restating TypeScript shapes in prompts.
  - Progress: implemented on 2026-06-29 and hardened on 2026-06-30. `project learn` now writes a mode-specific `curator-output-contract.json` JSON Schema beside `input-packet.json`, references it in the curator prompt, passes it to Codex through `--output-schema`, and still uses deterministic validation as the final authority. The 2026-06-30 dogfood create run proved the schema and apply shape by writing a five-page Project Memory set, but the generated content was too shallow to trust as a durable memory layer. Step 4 now owns the redesign before more producer integrations feed this layer.

## Roadmap Step 4: Project Memory Shape, Creation, And Maintenance Redesign

Goal: make Project Memory useful as a durable memory layer, not merely valid markdown that satisfies the current schema.

The 2026-06-30 `llm-wiki` create dogfood proved the transport, schema, validation, and apply mechanics, but the generated pages were too thin to trust as project memory. A valid first layer must document the project deeply enough for future agents to rely on it: repo-bounded, citation-backed, organized by stable project concepts, and maintained with clear quality gates.

Step 4 is complete when create mode can produce a trustworthy first Project Memory layer, maintain mode can update that layer without flattening it into shallow summaries, generic page categories, or unchecked candidate text, and Project Memory candidate producers route into that documentation-shaped curation boundary instead of defining a parallel memory path.

- [ ] `next` Redesign the Project Memory wiki shape and creation quality bar.
  - Description: Define the expected first-create documentation shape, page taxonomy, minimum depth, citation density, required repo surfaces, and quality checks for a valid Project Memory layer.
  - Why: the current create output has the right mechanical shape but is too shallow to serve as reliable memory.
- [ ] `open` Redesign create-mode repo orientation and evidence gathering.
  - Description: Decide which bounded repo files and directories the curator should inspect in create mode, how it should cite them, and how to avoid broad unbounded search while still producing useful documentation.
  - Why: creation mode cannot be driven primarily by memory candidates or bootstrap state; it must learn the repo itself inside a bounded evidence contract.
- [ ] `open` Refactor the creation contract around durable page intent instead of generic page count.
  - Description: Replace the current minimum-page guard with a stronger contract for required page roles, section coverage, repo citations, and rejected shallow summaries.
  - Why: `index.md` plus several thin pages is still not a trustworthy memory layer.
- [ ] `open` Redesign maintain mode around existing Project Memory structure.
  - Description: Make maintenance preserve and improve canonical page structure, update specific sections, attach evidence, mark uncertainty, and identify missing/stale coverage without creating generic duplicates.
  - Why: maintenance should make Project Memory sharper over time, not accumulate shallow fragments.
- [ ] `open` Route Project Memory producer outputs through the documentation-shaped candidate boundary.
  - Description: Session Memory handoffs, project gaps, stale findings, runtime inbox items, and future producer outputs should become Project Memory candidates or handoff inputs that the curator treats as leads for repo-grounded documentation updates, not as direct durable memory text.
  - Why: the user's target shape includes Session Memory curators suggesting higher-layer memory candidates, but Project Memory must still own exploration, evidence checks, page placement, and durable markdown writes.
- [ ] `open` Define Project Memory quality diagnostics and review artifacts.
  - Description: Add inspectable signals that explain whether a create or maintain run produced reliable coverage, shallow coverage, missing citations, stale areas, or review-only material.
  - Why: operators and agents need to know whether a run produced trusted memory, not just valid JSON and successful file writes.
- [ ] `open` Dogfood the redesigned Project Memory layer on `llm-wiki`.
  - Description: Rebootstrap `llm-wiki`, rerun create and maintain, inspect the generated wiki manually, and only mark the step complete if the output is useful as a memory layer.
  - Why: the previous dogfood showed that schema validity is not enough; manual product-quality review is part of the acceptance bar.

## Roadmap Step 4.5: Current Briefing Follow-Up

Goal: revisit current-state follow-up only after the core Project Memory layer and its producer intake boundary are trustworthy.

- [ ] `open` Decide whether Current Briefing is needed after Project Memory curation and retrieval are stable.
  - Description: Revisit session-start briefing only after Project Memory and Session Memory can prove whether a separate current-state view is still useful.
  - Why: Myelin should not create another current-state surface unless Project Memory and Session Memory still leave a real session-start gap.
  - Refs: revisit after Step 4 proves Project Memory quality and producer routing clarifies any remaining retrieval/status gap. Compare against `src/commands/status.ts`, `src/status/status-service.ts`, `src/query/memory-query-service.ts`, and Session Memory query behavior in `src/memory/session-memory-query.ts`.
- [ ] `deferred` Resume Current Briefing only if Project Memory curation and retrieval prove it is still needed.
  - Description: Keep Current Briefing out of active work unless the core memory layers still need a derived session-start summary.
  - Why: Current Briefing should be a derived session-start view only if the core memory layers do not already cover that need.
  - Refs: no active implementation target yet; this remains gated by Project Memory quality and retrieval, Session Memory freshness in Step 5, and status/query facade evidence.

## Roadmap Step 5: Session Memory Freshness And Catch-Up

Goal: make recent work catch up into Session Memory predictably enough that agents can trust it as current working context, not only older durable orientation.

Session Memory retrieval is useful today, but the dogfood inspection showed a current freshness gap: active Session Memory can be accurate for older decisions while missing the latest work slice because auto-maintenance waits for a threshold and recent auto-ingest jobs can fail. Myelin needs an explicit product answer for when recent captured work should become durable Session Memory.

Step 5 is complete when Myelin has a clear, tested catch-up mechanism for recent session work, with honest status reporting when the latest captured work has not yet been ingested, indexed, or reconciled.

- [ ] `open` Audit shared memory-layer primitives before changing Session Memory freshness.
  - Description: Compare Session Memory, Project Memory, and expected Practice/Personal Memory flows for repeated reliability logic that should live in shared runtime services, facades, or primitives instead of being reimplemented per layer.
  - Why: Myelin should behave as one coherent product, not several memory applications inside one repository; freshness work is a good point to identify shared boundaries before adding more layer-specific code.
- [ ] `open` Extract prompt-budget primitives into a shared runtime boundary.
  - Description: Move shared prompt-size measurement, safety-margin handling, estimated-token diagnostics, attempt selection, and budget artifact fields into a reusable runtime service while keeping each memory layer responsible for its own reduction strategy.
  - Why: Session Memory and Project Memory now both need preflight prompt reliability; prompt budgeting is the first concrete shared primitive that should benefit all memory layers without coupling their domain semantics.
- [ ] `open` Identify shared candidate, lifecycle, and diagnostic patterns across memory layers.
  - Description: Review whether candidate normalization, needs-review semantics, degraded-context reporting, source provenance, run artifacts, and status/freshness diagnostics have common primitives that Project, Practice, Personal, and Session Memory should reuse.
  - Why: shared mechanics should be consistent across durable memory layers, while layer-specific curation authority, scope, and evidence rules remain separate.
- [ ] `open` Reevaluate the auto-maintenance threshold and trigger policy.
  - Description: Decide whether the current captured-event threshold is too high for work-slice completion and whether the default should be lower, adaptive, or tied to explicit session/work-slice boundaries.
  - Why: recent work can remain absent from Session Memory even when capture is working, which makes query results useful but stale.
- [ ] `open` Design an explicit Session Memory catch-up command or workflow.
  - Description: Define a first-class way to ingest and index recent captured work for a project without relying only on background threshold scheduling.
  - Why: before dogfooding memory-dependent workflows, operators and agents need a deliberate catch-up path that is not hidden inside auto-maintenance timing.
- [ ] `open` Decide whether future tools/MCP should expose a session-memory catch-up action.
  - Description: Evaluate whether a future agent tool should trigger Session Memory ingest/indexing at the end of an agreed work slice.
  - Why: runtime agents may know when a meaningful slice is complete better than a raw message-count threshold does.
- [ ] `open` Make Session Memory freshness visible in query/status output.
  - Description: Surface whether active Session Memory is current, how many captured rows are queued, whether recent ingest jobs failed, and whether indexing is pending.
  - Why: agents should not treat stale Session Memory as complete current context.
- [ ] `open` Fix prompt-budget failure loops in recent auto-maintenance ingest.
  - Description: The dogfood database showed recent retryable auto-ingest failures from prompts exceeding the configured budget; diagnose whether batching, retained context, or reconciliation payloads need tighter bounds.
  - Why: failed auto-ingest prevents recent captured work from becoming durable Session Memory even when scheduling succeeds.
- [ ] `open` Define how Session Memory catch-up interacts with Project Memory candidates.
  - Description: Clarify whether catch-up should opportunistically create Project/Practice/Personal candidates and how to avoid duplicating candidates already handled by durable memory curation.
  - Why: Session Memory is a producer for higher memory layers, but catch-up should not flood or duplicate the candidate queue.

## Roadmap Step 6: Practice Memory Layer

Goal: canonical utility, library, third-party provider, workflow, and tooling guidance derived from repeated or explicitly selected project evidence.

Practice Memory should reuse the Project Memory curation pattern after Project Memory and Session Memory freshness are stable: bounded evidence, structured curator proposals, deterministic validation, canonical markdown, and derived retrieval state. The subject changes from "what is true about this project?" to "how do we use this tool, library, provider, workflow, or platform across projects?"

Example: Supabase Practice Memory should describe how we use Supabase Auth, Edge Functions, local development, migrations, storage, or vector search in general. Project-specific Supabase choices remain Project Memory and can cite or override the canonical practice.

Step 6 is complete when Myelin can maintain reusable practice guidance as canonical markdown, promote practice candidates from project evidence, retrieve the right practice for agent work, and keep project-specific exceptions separate from canonical guidance.

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

## Roadmap Step 7: Personal Memory Layer

Goal: durable guidance about Liad's preferences and agent behavior expectations.

Personal Memory should reuse the same curation pattern as Project and Practice Memory, but with stricter evidence rules. The subject is not a project or a tool; it is durable guidance about how agents should collaborate with Liad and how Liad prefers engineering work to be approached.

Step 7 is complete when Myelin can preserve durable personal guidance as canonical markdown, distinguish explicit preferences from inferred patterns, retrieve that guidance for agent behavior, and update or retract stale preferences safely.

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

## Roadmap Step 8: Query, How, And Status Facades

Goal: small semantic interfaces over the memory layers.

Step 8 is complete when agents can use stable semantic interfaces instead of knowing the storage layout. `query` answers explanatory questions, `how` answers prescriptive workflow questions, and `status` answers structured current-state questions.

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

## Roadmap Step 9: Schema Layer

Goal: rules and conventions that teach agents how to maintain Myelin.

Step 9 is complete when schema rules can evolve from real memory evidence without becoming a hidden source of product truth. Schema teaches agents how to maintain memory; it does not replace Project, Practice, or Personal Memory.

- [x] `done` ~~Global schema inputs and typed rules exist.~~
- [x] `done` ~~`schema check` validates authored/global schema context.~~
- [x] `done` ~~`schema build` writes generated per-project schema context.~~
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

## Roadmap Step 10: Session Memory Hardening

Goal: improve Session Memory quality and operations after Project Memory has a stable curation path.

Step 10 is complete when Session Memory remains accurate across branches, retires stale continuity safely, reports maintenance failures clearly, and feeds higher memory layers without duplicating what those layers already know.

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

- `rtk bun test tests/project/project-memory-curator-output-schema.test.ts tests/project/project-memory-curator-validator.test.ts tests/project/project-memory-prompt-budget.test.ts tests/project/project-memory-curator-service.test.ts tests/project/project-service.test.ts tests/project/project-memory-markdown-applier.test.ts tests/runtime/project-run-infrastructure.test.ts tests/runtime/llm-client.test.ts tests/commands/project.test.ts` passed with 82 tests.
- `rtk bun run typecheck` passed.
- `rtk git diff --check` passed.
- `rtk make learn PROJECT=llm-wiki ARGS='--json'` completed create mode with valid schema/apply shape, but manual review found the generated Project Memory content too shallow to trust; Step 4 now owns that redesign.
- A second `rtk make learn PROJECT=llm-wiki ARGS='--json'` completed maintain mode as a validated no-op.
