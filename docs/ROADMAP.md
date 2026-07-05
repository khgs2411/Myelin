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
- `next`: the single active implementation task.
- `open`: known future work.
- `retired`: removed from active direction.

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

## Roadmap Step 4: Project Memory Product Reality Reset

Goal: correct the active product baseline so future work starts from the user's intended Project Memory model, not from the false-positive 2026-06-30 dogfood result.

The product target is now explicit: Session Memory gives recent continuity and can create higher-layer leads; Project Memory is living repo documentation. Project Memory candidates are not durable truth. They are leads that `project learn` must investigate inside the target repo, ground with repo evidence, and turn into canonical markdown only when the resulting documentation is useful to a future agent.

The 2026-06-30 `llm-wiki` Project Memory output proved transport, schema, apply, and retrieval plumbing, but it did not produce trustworthy documentation. It must be treated as a product-quality failure even though the run reported `content_quality_status: trusted`.

- [x] `done` ~~Reclassify the 2026-06-30 Project Memory dogfood as product-quality failed.~~
  - Description: Update the roadmap/design validation record so the generated six-page wiki is documented as mechanically valid but not trusted Project Memory.
  - Why: Future work should not inherit the incorrect conclusion that role names, citations, and successful writes are enough for useful Project Memory.
- [x] `done` ~~Record the product model for Session Memory and Project Memory.~~
  - Description: Document that Session Memory is recent conversation-derived continuity and Project Memory is repo-grounded living documentation; candidates and handoffs are leads only.
  - Why: This boundary is the core product shape and should drive every following Project Memory item.
- [x] `done` ~~Identify existing implementation pieces that should be preserved.~~
  - Description: Keep the working mechanics: target-repo curator cwd, structured output contracts, deterministic validation, markdown apply, source-consumption reconciliation, runtime inbox intake, and derived Project Memory retrieval index.
  - Why: The failure is the documentation-quality gate, not the whole pipeline.
  - Progress: Recorded in the 2026-06-30 Step 4 dogfood validation reclassification.

## Roadmap Step 5: Project Memory Published Documentation Contract

Goal: make Project Memory quality depend on the rendered markdown a future agent can read and query, not on curator-declared intent.

Step 5 is complete when create-mode Project Memory has a real documentation contract: answer-domain documentation coverage, real markdown sections, useful section depth, grounded citations, and answerability checks that fail shallow output before `project-memory.json` can be marked curated. The old six-role page taxonomy is historical input only, not the primary create-mode contract.

- [x] `done` ~~Define the rendered markdown section contract.~~
  - Description: Require Project Memory pages to publish real headings and sections for their answer domains, not only metadata such as `required_sections`.
  - Why: Project Memory retrieval indexes markdown headings; a page that declares sections but renders one top-level section is not useful documentation.
- [x] `done` ~~Derive answer-domain coverage from rendered markdown.~~
  - Description: Compute section count, section body depth, citation coverage, and answer-domain coverage from the actual apply payload or rendered markdown artifact.
  - Why: The current validator can pass thin docs because it counts declared `required_sections` rather than published sections.
- [x] `done` ~~Replace the six-role create taxonomy with an answer-domain documentation map.~~
  - Description: Use required domains such as product and memory model, storage and retrieval, command workflows, curation/apply lifecycle, evidence/provenance/candidate boundaries, and current work/decisions as the primary create-mode contract.
  - Why: Project Memory should be organized around durable questions and workflows future agents need to answer, not generic role labels.
- [x] `done` ~~Replace shallow page-count checks with usefulness gates.~~
  - Description: Keep page count as a lower-level safety guard, but make trust depend on real documentation depth, repo-grounded sections, and the ability to answer representative agent questions.
  - Why: `index.md` plus several thin pages is still not Project Memory.
- [x] `done` ~~Add Project Memory answerability questions to the quality bar.~~
  - Description: Use fixture questions such as where SQLite is stored, how Session Memory feeds Project Memory, how `project learn` decides writes, and how Project Memory query returns markdown content or refs.
  - Why: The product exists to save future agents from rediscovering the codebase; quality should be measured against that use.
- [x] `done` ~~Keep content quality separate from retrieval readiness.~~
  - Description: Preserve the two-axis model where trusted content can have pending retrieval indexing, but shallow content cannot be reported as curated or `completed_with_pending_index`.
  - Why: Retrieval state is serving readiness; it cannot launder weak documentation into trusted Project Memory.
  - Progress: implemented in the 2026-07-05 rendered create-contract work. Create mode now uses sectioned page payloads, answer-domain diagnostics, rendered markdown quality checks, deterministic answerability questions, and separate `content_quality_status` / `retrieval_readiness_status`.

## Roadmap Step 6: Project Memory Create Mode

Goal: make first-create Project Memory inspect the target repo deeply enough to produce useful living documentation.

Creation mode should not be candidate-driven. It should use candidates and Session Memory as leads, but the durable first wiki must come from bounded target-repo orientation and citations.

- [x] `done` ~~Define the two-pass create-mode evidence workflow.~~
  - Description: Build a deterministic answer-domain evidence map from default orientation surfaces plus repo-local searches before asking the curator to write sectioned markdown.
  - Shape: For `llm-wiki`, this includes product docs, roadmap, ADRs/design docs, CLI docs, and the core `src/project`, `src/memory`, `src/ingest`, `src/query`, `src/commands`, and `src/runtime` areas, plus domain-specific searches for storage, retrieval, commands, curation/apply lifecycle, evidence/provenance, and current work.
- [x] `done` ~~Require deep first-create answer-domain documentation.~~
  - Description: Require real sections and durable details inside each answer domain, including product and memory model, storage and retrieval, command workflows, curation/apply lifecycle, evidence/provenance/candidate boundaries, and current work/decisions.
  - Why: Answer domains are useful only if they carry enough operational detail for a future agent.
- [x] `done` ~~Make SQLite, storage, retrieval, and memory-layer boundaries first-class documented topics for Myelin.~~
  - Description: Ensure the initial `llm-wiki` Project Memory can explain where SQLite state lives, how Session Memory records differ from Project Memory retrieval rows, and how queries resolve back to markdown.
  - Why: This is the user's concrete example of a question Project Memory must answer.
- [x] `done` ~~Add independent first-create usefulness critique before curated state.~~
  - Description: After deterministic validation passes, run a separate model-backed critique over the rendered markdown and evidence map before `project-memory.json` can mark the project curated.
  - Why: The failed dogfood was a usefulness failure, not only a schema or citation failure.
- [x] `done` ~~Support explicit clean rebootstrap reset for untrusted create/dogfood runs.~~
  - Description: Allow an operator-selected reset path to delete and recreate the project shell while preserving the repo-root `state/memory.db` continuity layer.
  - Why: Untrusted project-shell files are replaceable; Session Memory and Memory Candidates in SQLite should seed the clean first-create run.
- [x] `done` ~~Reject generic summaries in create mode.~~
  - Description: Treat broad role-shaped prose without concrete repo paths, commands, state files, flows, and gotchas as shallow even when it has citations.
  - Why: The previous output had the right titles but not enough product value.
  - Progress: implemented in the 2026-07-05 create-contract work. `project learn` now writes `project-memory-evidence-map.json`, requires sectioned create pages, runs deterministic rendered-quality validation, runs independent usefulness critique, and exposes `project reset <key> --clean --confirm <key>` for explicit clean rebootstrap while preserving root SQLite continuity.

## Roadmap Step 7: Project Memory Maintenance And Candidate Promotion

Goal: make Project Memory improve over time from Session Memory leads, runtime inbox items, stale/gap findings, and operator hints without copying unverified candidate text into durable markdown.

Maintenance mode should treat candidates more heavily than creation mode because they are created after a repo already has memory, often against existing memory. That weight is a prioritization signal, not write authority.

- [ ] `next` Enforce candidates-as-leads in maintenance.
  - Description: Require the curator to inspect bounded target-repo evidence before applying a candidate to Project Memory.
  - Why: Session Memory captures what happened; Project Memory documents what is true and useful about the repo.
- [ ] `open` Make maintenance section-first.
  - Description: Update existing owned sections when possible, create new sections or pages only when concept ownership is missing, and preserve uncertainty or disputed state instead of flattening contradictions.
  - Why: Maintenance should sharpen documentation, not accumulate shallow entry fragments.
- [ ] `open` Strengthen candidate disposition and source-consumption behavior.
  - Description: Retire candidates only after a grounded write or a grounded terminal no-op, and keep insufficient-evidence leads reviewable.
  - Why: Candidate lifecycle should reflect documentation work actually done.
- [ ] `open` Report missing and stale coverage as first-class maintenance output.
  - Description: When a lead reveals weak existing docs but no grounded write is possible, record a missing-coverage diagnostic instead of producing shallow text.
  - Why: A useful memory system should identify where documentation is absent instead of pretending it is complete.

## Roadmap Step 8: Project Memory Query And CLI Contract

Goal: expose Project Memory as a queryable documentation layer through Myelin's own CLI/script contracts.

For the current product slice, Project Memory query should not synthesize final answers. It should embed the user's question, search derived SQLite/vector serving state, resolve hits back to canonical markdown sections or pages, and return inline content under a size threshold or canonical refs when too large. While dogfooding Myelin from inside this repo, agents and operators should use CLI commands and scripts directly; MCP is a later wrapper around working behavior, not a prerequisite for the core product loop.

- [ ] `open` Stabilize the Project Memory query layer contract.
  - Description: Make the `project` layer query path a documented CLI/product contract rather than hidden service behavior.
  - Why: Dogfooding and future wrappers need a stable command/result shape.
- [ ] `open` Return markdown content or canonical refs from Project Memory hits.
  - Description: Keep Project Memory query markdown-backed: Session Memory can return trusted SQLite rows directly, but Project Memory rows must resolve to canonical wiki markdown.
  - Why: SQLite/vector rows are derived pointers, not Project Memory truth.
- [ ] `open` Define size-threshold and degraded-state behavior.
  - Description: Decide when query returns inline section content, whole page content, or only path/section refs, and make stale/missing index states explicit.
  - Why: Agents need useful context without hidden token blowups or stale answers.
- [ ] `open` Add product-query fixture questions.
  - Description: Cover questions about SQLite storage, Session-to-Project candidate flow, `project learn` write decisions, runtime inbox intake, source consumption, and retrieval/indexing.
  - Why: The generated docs should be tested against the questions future agents will actually ask.

## Roadmap Step 9: Project Memory CLI Dogfood Acceptance Loop

Goal: prove the redesigned Project Memory layer on `llm-wiki` before expanding to other durable memory layers.

Step 9 is complete only when `llm-wiki` Project Memory is useful enough that a future agent can answer product and implementation-orientation questions from the wiki without rediscovering the whole repo. This dogfood loop uses Myelin's CLI commands and repo-local scripts directly; it does not depend on MCP.

- [ ] `open` Reset or quarantine the current shallow `llm-wiki` wiki.
  - Description: Preserve the current output as failed dogfood evidence, then recreate Project Memory under the new quality gates.
  - Why: The current wiki should not remain the trusted baseline.
- [ ] `open` Rerun create mode against `llm-wiki` through the CLI.
  - Description: Generate a new first Project Memory set with repo-local CLI commands only after the rendered documentation contract, create-mode orientation, and quality gates are in place.
  - Why: Another provider run before the gates are fixed would only repeat the same failure mode.
- [ ] `open` Insert or surface the product-vision lead through CLI-supported inputs.
  - Description: Use the available CLI/candidate/inbox path to feed this product vision into Project Memory maintenance, then require repo-grounded documentation before accepting writes.
  - Why: This is the dogfood behavior the product is meant to support.
- [ ] `open` Manually review usefulness before marking Project Memory curated.
  - Description: Accept the dogfood only if the wiki answers representative questions and a future agent can use it as living repo documentation.
  - Why: Mechanical success is not enough for Project Memory.

## Roadmap Step 10: MCP Tool Wrapper For Other Projects

Goal: expose proven Myelin CLI/script behavior as globally available tools for agents working in other repositories.

MCP is not part of the core dogfood loop for Myelin-on-Myelin work. It is the external agent interface after Project Memory works through local commands. The MCP layer should wrap stable Myelin CLI/script contracts and expose them as tools for agents in other projects, without moving core memory behavior into MCP implementation code.

- [ ] `open` Define the MCP wrapper boundary after CLI behavior is stable.
  - Description: Decide which proven CLI/script operations should become tools, what arguments/results they expose, and what remains internal to the Myelin repo.
  - Why: MCP should be a wrapper over working behavior, not the place where Project Memory semantics are invented.
- [ ] `open` Wrap Project Memory query for external agents.
  - Description: Expose the markdown-backed Project Memory query behavior as a tool that agents in other repositories can call.
  - Why: The user-facing value of MCP is letting other project agents ask Myelin for relevant memory without knowing the repo internals.
- [ ] `open` Wrap candidate/inbox insertion for external agents.
  - Description: Expose a controlled way for agents outside this repo to submit Project Memory leads through the same candidate/inbox boundary used by CLI dogfood.
  - Why: External tools should feed the same lead-to-documentation pipeline, not create a parallel write path.
- [ ] `open` Preserve detached MCP ownership.
  - Description: Keep core behavior in Myelin CLI/runtime code and keep MCP as a detached consumer of stable command/JSON contracts.
  - Why: The wrapper must not become a second implementation of memory logic.

## Roadmap Step 11: Extend Practice And Personal Memory Roadmap

Goal: add Practice Memory and Personal Memory work only after Session Memory plus Project Memory prove the core memory loop.

Practice and Personal Memory should reuse the working Project Memory pattern where appropriate: candidates as leads, canonical markdown, provenance, deterministic validation, derived retrieval, and explicit review boundaries. They are intentionally later because they are global layers and simpler than Project Memory's repo-bound documentation problem.

- [ ] `open` Extend the roadmap for Practice Memory.
  - Description: After Project Memory works, define the roadmap for reusable global practice guidance such as tools, providers, libraries, and workflows.
  - Why: Practice Memory should inherit proven curation mechanics instead of being designed in parallel with the harder Project Memory layer.
- [ ] `open` Extend the roadmap for Personal Memory.
  - Description: After Project Memory works, define the roadmap for durable personal guidance, explicit preferences, and collaboration rules.
  - Why: Personal Memory needs careful evidence boundaries, but its storage and retrieval shape should build on the proven durable-memory pattern.

## Always-On Guardrails

- Keep hooks fast and fail-open.
- Keep provider-backed work detached and bounded.
- Do not let auto-maintenance recursively capture its own provider sessions.
- Keep SQLite as serving/recall state, not curated truth.
- Keep markdown Project/Practice/Personal memory human-reviewable.
- Do not import root `src/` from detached MCP or MCP source from root core.
- Do not manually drain the live dogfood queue as proof of progress.
