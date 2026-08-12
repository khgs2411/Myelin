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

Evidence: `src/commands/ingest.ts`, `src/ingest/*`, `src/memory/session-memories.ts`, `src/memory/candidates.ts`, `src/memory/handoffs.ts`, `src/memory/session-memory-query.ts`, `src/maintenance/auto-memory-maintenance.ts`, `src/commands/maintenance.ts`

## Roadmap Step 3: Project Memory Layer

Goal: maintain curated, human-readable project truth in `projects/<key>/` with machine-readable state and provenance under `state/<key>/`.

Project Memory is the first durable curation layer. It should capture what the repo alone does not cheaply reveal: product behavior, feature intent, setup, runbooks, decisions, current state, contradictions, and provenance. It should not become a generic code summarizer, a Session Memory replacement, or a place for unverified free-form agent claims.

Step 3 is complete when `project learn <key>` can safely maintain Project Memory from bounded evidence, with validated curator output and provenance-backed markdown updates.

Step 3 foundation is complete. Step 3.5 completed transport, retrieval-quality, and schema-output hardening. The 2026-06-30 dogfood output proved the mechanics but not the memory-layer quality bar, so Step 4 now owns Project Memory shape, creation, maintenance, and producer-routing redesign before the core agent-facing facades and Current Briefing resume in Step 13.

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
  - Progress: implemented on 2026-06-28. `memory inbox create` writes immutable Project runtime inbox JSON under `sources/<key>/inbox/<id>.json`, `memory inbox intake` normalizes valid items into idempotent `needs_review` `project.inbox` candidates, and `project learn` runs the same intake service after source-consumption reconciliation and before packet construction.
- [x] `done` ~~Flatten Project Memory into an Obsidian-ready project root and move generated data to ownership-specific roots.~~
  - Description: Canonical markdown lives directly under `projects/<key>/`; per-project machine state lives under `state/<key>/`; preserved source evidence lives under `sources/<key>/`; run artifacts and logs live under `runs/<key>/`; the shared SQLite database lives at `state/memory/memory.db`.
  - Progress: implemented on 2026-07-16 with idempotent, collision-safe `project migrate-layout` support and legacy recorded-run path compatibility.
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

- [x] Runtime inbox item files are preserved as pretty JSON under `sources/<key>/inbox/<id>.json`.
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
  - Description: Allow an operator-selected reset path to delete and recreate the project shell while preserving the repo-root `state/memory/memory.db` continuity layer.
  - Why: Untrusted project-shell files are replaceable; Session Memory and Memory Candidates in SQLite should seed the clean first-create run.
- [x] `done` ~~Reject generic summaries in create mode.~~
  - Description: Treat broad role-shaped prose without concrete repo paths, commands, state files, flows, and gotchas as shallow even when it has citations.
  - Why: The previous output had the right titles but not enough product value.
  - Progress: implemented in the 2026-07-05 create-contract work. `project learn` now writes `project-memory-evidence-map.json`, requires sectioned create pages, runs deterministic rendered-quality validation, runs independent usefulness critique, and exposes `project reset <key> --clean --confirm <key>` for explicit clean rebootstrap while preserving root SQLite continuity.

## Roadmap Step 6.5: Project Memory Create-Mode Redesign

Goal: make first-create Project Memory behave like agent-authored repo documentation instead of an acceptance-test-shaped wiki generator.

The product correction was to stop enforcing a fixed page taxonomy and move the documentation shape to agents: one planner agent studies the repo, creates the documentation index and subject manifest, and one subject-writer agent writes each documentation page. Create mode is intentionally the expensive/high-gain path. Maintenance mode then runs immediately over the generated baseline and any candidates that were created during the same run.

- [x] `done` ~~Retire fixed create-mode file names as product requirements.~~
  - Description: Create mode no longer requires predetermined files such as `architecture.md`; it asks the planner to decide the documentation subjects and wiki paths, with `index.md` as the only required entry point.
  - Why: Project Memory should reflect the repo's real documentation shape, not a rigid schema imposed by the harness.
- [x] `done` ~~Add planner-plus-subject-writer create mode.~~
  - Description: Create mode invokes a planner file-authoring agent to produce `draft-wiki/index.md`, placeholder subject files, `documentation-subject-manifest.json`, and a planner report; it then invokes a subject writer per manifest entry.
  - Why: One agent should own the project-level documentation outline, while focused agents own deep documentation for specific subjects.
- [x] `done` ~~Run first-create as create plus maintenance.~~
  - Description: `project learn <key>` runs create mode for uncurated projects, promotes the draft wiki, then runs maintenance over pending Project Memory leads before publishing the final canonical wiki.
  - Why: A first run should produce a full baseline and immediately reconcile the leads created during the run.
- [x] `done` ~~Keep Project Memory docs as canonical markdown and retrieval/index state as derived.~~
  - Description: Draft wiki output is promoted directly into `projects/<key>/`; section manifests, vector rows, FTS rows, and hint metadata remain rebuildable serving state.
  - Why: Future agents should trust markdown, not SQLite retrieval rows.

Evidence: `src/project/project-memory-agent-create-service.ts`, `src/project/project-memory-agent-maintenance-service.ts`, `src/project/project-memory-curator-service.ts`, `src/runtime/file-authoring-agent.ts`, `tests/project/project-memory-curator-service.test.ts`

## Roadmap Step 7: Memory Query, Logging, And Retrieval Quality

Goal: make Project Memory and Session Memory queryable through a measurable CLI contract that can be benchmarked over time.

The current query surface is not meant to synthesize final answers. It retrieves relevant memory records or Project Memory markdown sections, logs the full interaction, and gives agents enough context or canonical references to answer from memory instead of rediscovering the whole repo.

- [x] `done` ~~Stabilize Project Memory query as a markdown-backed layer.~~
  - Description: `myelin memory query <key> "<question>" --layer project` embeds the question, searches Project Memory retrieval state, resolves hits back to canonical markdown sections, and returns inline content or canonical references.
  - Why: Project Memory retrieval rows are pointers into markdown, not durable truth.
- [x] `done` ~~Keep Session Memory query separate from Project Memory query.~~
  - Description: Session Memory returns active trusted SQLite memory rows; Project Memory returns canonical markdown-backed sections or refs.
  - Why: The layers have different truth sources and lifecycle semantics.
- [x] `done` ~~Log memory queries per layer.~~
  - Description: Project, Session, Practice, and Personal Memory each have their own query-log table shape, including question, embedding, full result JSON, answer/eval fields where applicable, and degradation metadata.
  - Why: Retrieval quality should be compared through persisted evidence, not remembered informally.
- [x] `done` ~~Add hybrid Project Memory retrieval.~~
  - Description: Project Memory query combines vector recall with SQLite FTS/BM25 recall through reciprocal-rank fusion, then applies deterministic rerank/penalty rules for navigation sections and exact subject matches.
  - Why: Dense vector search alone blurred exact phrases and let broad index sections outrank precise documentation sections.
- [x] `done` ~~Benchmark retrieval with reusable question sets.~~
  - Description: The first 15 Project Memory questions and 5 Session Memory questions were logged as a baseline, followed by additional Project Memory questions after hybrid retrieval.
  - Why: Query tuning now has a durable comparison trail in SQLite query logs.

Evidence: `src/query/project-memory-query-service.ts`, `src/query/memory-query-service.ts`, `src/memory/query-logs.ts`, `src/memory/project-memory-section-fts.ts`, `src/memory/migrations.ts`, `tests/query/project-memory-query-service.test.ts`, `tests/memory/session-memory-query.test.ts`, `tests/commands/memory.test.ts`

## Roadmap Step 8: Session Memory Auto-Maintenance

Goal: keep Session Memory fresh without manual queue draining.

Session Memory auto-maintenance now treats capture as evidence append, then schedules bounded detached maintenance after enough Experience Log rows exist. The worker drains manageable ingest batches, waits for the ingest window, indexes Session Memory embeddings, and reschedules itself when the queue remains above threshold.

- [x] `done` ~~Lower the dogfood auto-maintenance threshold.~~
  - Description: `AUTO_MEMORY_MIN_CAPTURED_EVENTS` is configured to `25` for the dogfood repo.
  - Why: The previous threshold let the Experience Log queue grow stale before maintenance ran.
- [x] `done` ~~Make auto Session Memory maintenance a bounded drain loop.~~
  - Description: The worker runs one bounded ingest window, indexes pending Session Memory embeddings, records state, and schedules a continuation when queued rows remain above threshold.
  - Why: A single ingest launch with a long wait could leave large queues stale.
- [x] `done` ~~Keep auto Session Memory maintenance detached and fail-open.~~
  - Description: Capture hooks append evidence first, then schedule a detached worker guarded by lock, cooldown, and self-capture prevention.
  - Why: Hooks should never block agent workflow or recursively capture Myelin-owned provider sessions.
- [x] `done` ~~Schedule derived Session Memory indexing independently of capture pressure.~~
  - Description: Newly created Session Memory schedules active-contract indexing even when captured Experience Log rows remain below the ingest threshold.
  - Why: Ingest pressure and derived retrieval freshness are separate workloads.

Evidence: `src/maintenance/auto-memory-maintenance.ts`, `src/commands/maintenance.ts`, `src/capture/facade.ts`, `tests/maintenance/auto-memory-maintenance.test.ts`

## Roadmap Step 9: Project Memory Maintenance And Review

Goal: let Project Memory improve over time from runtime inbox items and higher-layer candidates without copying unverified candidate text into durable docs.

Project Memory maintenance now mirrors Session Memory's shape: deterministic intake first, agentic curation second, derived retrieval refresh last. Candidates are leads, not truth. Runtime inbox files are preserved source material; inbox intake normalizes them into `memory_candidates`; the maintenance agent reads existing docs and repo evidence before updating canonical markdown.

- [x] `done` ~~Add manual Project Memory maintenance.~~
  - Description: `myelin memory maintain project <key>` runs deterministic runtime inbox intake, invokes the maintenance file-authoring agent over pending project candidates/handoffs, applies wiki changes, records source-consumption state, and refreshes Project Memory retrieval indexes.
  - Why: Post-bootstrap Project Memory needs a maintenance command that is smaller and more targeted than full create mode.
- [x] `done` ~~Keep deterministic inbox intake separate from agentic curation.~~
  - Description: Inbox intake creates or reuses Project Memory candidates and does not update docs or invoke an agent by itself.
  - Why: Intake is normalization; curation is documentation authorship.
- [x] `done` ~~Record terminal-but-reviewable outcomes.~~
  - Description: `myelin memory review <key>` reports outcomes such as `insufficient_evidence`, `not_durable`, `belongs_to_other_layer`, `deferred_unsafe_change`, `needs_followup`, `no_output`, rejected candidates, and degraded runs.
  - Why: We can inspect non-success terminal states later without adding another queue.
- [x] `done` ~~Add Project Memory auto-maintenance.~~
  - Description: Runtime inbox creation and Session Memory ingest-created project candidates schedule detached Project Memory maintenance after either un-intaked inbox items or pending project candidates reach the configured threshold.
  - Why: Project Memory should grow naturally from leads without requiring every operator to remember to run maintenance manually.
- [x] `done` ~~Prevent maintenance recursion.~~
  - Description: Project inbox intake inside the maintenance job does not schedule another auto-maintenance run; only external inbox creation and Session Memory-created project candidates trigger scheduling.
  - Why: Inbox intake is already the first stage of the Project Memory maintenance job.
- [x] `done` ~~Schedule Project Memory retrieval independently of curation pressure.~~
  - Description: Pending active-contract Project Memory retrieval rows can schedule and run derived indexing below the inbox and candidate threshold.
  - Why: Canonical wiki changes should become queryable without waiting for unrelated curation leads.

Evidence: `src/project/project-memory-agent-maintenance-service.ts`, `src/project/project-memory-candidate-intake-service.ts`, `src/project/project-memory-curator-service.ts`, `src/commands/memory.ts`, `src/memory/memory-review-service.ts`, `src/maintenance/auto-project-memory-maintenance.ts`, `src/commands/maintenance.ts`, `tests/project/project-memory-curator-service.test.ts`, `tests/memory/memory-review-service.test.ts`, `tests/maintenance/auto-project-memory-maintenance.test.ts`

## Roadmap Step 10: Working Skeleton Hardening

Goal: turn the working Myelin skeleton into a reliable operator product before extending new memory layers.

The core loop now exists: capture and inbox create evidence, Session Memory turns experience into continuity and higher-layer leads, Project Memory creates and maintains repo documentation, query retrieves memory context, and review commands expose non-success terminal outcomes. The next work should make that loop operable from outside the Myelin checkout, observable without internal state inspection, and repeatably useful on another repository.

- [x] `done` ~~Stabilize the installed `myelin` namespace.~~
  - Description: Make the operator-facing `myelin` command consistently available instead of relying on `bun src/cli.ts` during development.
  - Why: External project usage and detached consumers need a stable operator boundary before they can prove the product outside this repository.
  - Progress: Completed 2026-07-10 with a copied launcher and recoverable ownership lifecycle, then strengthened on 2026-07-12 with content-addressed immutable runtime versions, V1-to-V2 locator migration, verified atomic activation, rollback, owned-version garbage collection, and locator-authoritative provider shims.
- [x] `done` ~~Reconcile operator documentation with the executable surface.~~
  - Description: Align setup, installation, command, and troubleshooting guidance with the commands and global invocation path operators can actually use.
  - Why: External dogfood should not depend on stale command vocabulary or knowledge of the Myelin source checkout.
- [x] `done` ~~Add operational health status.~~
  - Description: Surface Session and Project auto-maintenance state, ingest jobs and queue pressure, pending candidates and inbox items, locks, log paths, and retrieval readiness through a stable CLI status surface.
  - Why: Background maintenance is useful only when operators can diagnose it without reading SQLite tables or internal state files directly.
  - Progress: Completed 2026-07-10 with a read-only operational status contract that is shared by human and JSON output.
- [x] `done` ~~Stabilize embedding identity and derived-index lifecycle.~~
  - Description: Persist one active embedding contract per memory scope, keep automatic selection local and sticky, stage contract changes behind verified activation and rollback, separate active health from historical rows, and retire old derived state through preview-first cleanup.
  - Why: Provider reachability may vary by process, but the embedding space that owns a retrieval index must remain stable.
  - Progress: Completed on 2026-07-13. Session and Project retrieval now share persisted contract resolution, versioned migration/rollback/prune behavior, active-contract status semantics, and indexing schedules independent of ingest and curation thresholds.

## Roadmap Step 11: Codebase Review And Consolidation

Goal: review the working implementation as a whole and consolidate only the structural seams that materially improve maintainability before external dogfooding expands the supported surface.

- [x] `done` ~~Review the current implementation for structural debt.~~
  - Description: Examine responsibilities, dependency direction, duplication, object lifecycles, test seams, and module boundaries across the working memory, installation, status, query, and maintenance paths, then identify the concrete findings worth changing.
  - Why: The core product now works end to end, making this the right point to distinguish real consolidation opportunities from premature abstraction.
  - Progress: Completed through the whole-codebase review that prioritized explicit contracts and types, one-provider-per-file embedding boundaries, shared service/runtime behavior, stricter lifecycle invariants, and removal of obsolete implementation paths.
- [x] `done` ~~Apply approved high-value consolidation.~~
  - Description: Implement the review findings that simplify ownership, reduce duplication, or strengthen boundaries without introducing patterns, factories, classes, or extensibility solely for stylistic compliance.
  - Why: SOLID and common object-oriented patterns are useful only where they make the current contracts clearer and safer.
  - Progress: Extracted dedicated contract and type modules, separated embedding providers behind the factory and embedding service, consolidated maintenance run behavior, and removed superseded inbox, query-planner, and Project Memory validation/rendering paths.
- [x] `done` ~~Re-verify the consolidated product boundary.~~
  - Description: Confirm that installation, provider hooks, command invocation, status, query, capture, and maintenance behavior remain intact after consolidation.
  - Why: Cleanup is complete only when the operator-facing contracts remain stable.
  - Progress: The consolidated runtime remained intact through the managed immutable installation upgrade, including locator-authoritative launch, provider hooks, health inspection, rollback, and version retention.

## Roadmap Step 12: External Project Dogfood

Goal: prove the installed operator product on both an established repository with accumulated continuity and a genuinely clean project with no prior Myelin state.

Class Kit and Droplet Bot exercise complementary paths. Class Kit already has substantial Session Memory and captured Experience Log evidence, so its rebootstrap should prove that a fresh Project Memory shell can reuse preserved continuity. Droplet Bot is a Wizepal project but should enter Myelin under its own clean project identity, proving the first-run experience without inherited SQLite rows.

- [x] `done` ~~Rebootstrap Class Kit from preserved continuity.~~
  - Description: Re-register and rebuild the Class Kit project shell, then run the product loop from the beginning while preserving its existing Session Memory, captured evidence, and connected hook history in root SQLite.
  - Why: An established repository should be able to recreate Project Memory without discarding the continuity Myelin has already earned.
  - Progress: Completed on 2026-07-15. The installed product recreated a curated Project Memory from the continuity-rich Class Kit baseline, retained correct repository identity, and returned Project-layer answers for destructive product reset and member auto-approval. Progress, retry, managed-version, repository-isolation, authoring-coverage, publication, and retrieval findings exposed by the run were closed before this baseline was accepted.
- [ ] `next` Bootstrap Droplet Bot as a clean Wizepal project.
  - Description: Register Droplet Bot as a new project with no pre-existing project-scoped SQLite memory, then run the same first-create and maintenance path from a genuinely clean state.
  - Why: A clean initialization exposes first-run assumptions that an established project with accumulated memory can hide.
  - Shape: Treat Droplet Bot as a distinct Myelin project identity rather than reusing the existing `wizepal` SQLite continuity.
- [ ] `open` Run the full external-project dogfood across both paths.
  - Description: Use the installed command and public CLI/JSON contracts to run create, query, maintenance, and auto-maintenance for Class Kit and Droplet Bot, then ask real Project and Session Memory questions before touching either repo directly.
  - Why: Comparing continuity-rich rebootstrap with clean initialization tests both sides of the operator product boundary.
  - Progress: The continuity-rich Class Kit create and Project Memory query path now passes. The clean Droplet Bot path and the cross-path maintenance and auto-maintenance comparison remain.
- [ ] `open` Close external-dogfood findings and repeat the product loop.
  - Description: Incorporate material findings from both external runs and repeat the affected workflows until normal use no longer depends on the Myelin checkout or internal serving-state inspection.
  - Why: External dogfood is a reliability gate, not a one-time demonstration.
  - Progress: Class Kit findings have been closed through an accepted recreated and queryable baseline; this item remains open for Droplet Bot findings and the final repeated comparison.

## Roadmap Step 13: Core Agent-Facing Facades And Current Briefing

Goal: expose Project Memory, Session Memory, and current project state through stable semantic interfaces before detached consumers wrap them.

The current CLI can retrieve Project and Session Memory explicitly, but the product-level `query`, `how`, and `status` facades remain incomplete. This step should establish one extensible core contract that later Practice and Personal Memory can join without changing the truth or ownership boundaries of existing layers.

- [ ] `open` Define the next query-composition boundary.
  - Description: Design the intended way to compose or select Project Memory and Session Memory results with explicit precedence, citations, confidence, and degraded behavior, without reviving the removed `--layer auto` facade.
  - Why: The next query shape should follow an explicit product design rather than preserve an incomplete routing flag.
- [ ] `open` Restore Current Briefing as a first-class product surface.
  - Description: Combine recent continuity, durable project context, active work, and operational health into a bounded current-state briefing for a new agent session.
  - Why: A new agent needs a reliable starting point before deciding which deeper memory questions to ask.
- [ ] `open` Add the `how` facade.
  - Description: Provide prescriptive operating guidance from project runbooks and current project constraints through a contract designed to prefer Practice Memory once that layer exists.
  - Why: Explanatory recall and operating guidance have different precedence and should not be blended implicitly.
- [ ] `open` Stabilize the agent-facing `status` facade.
  - Description: Compose project identity, continuity, maintenance health, queue state, and retrieval readiness into a structured current-state response.
  - Why: Agent status should build on Step 10 operational truth rather than remain a shallow project-file summary.
- [ ] `open` Stabilize extensible CLI and JSON contracts for detached consumers.
  - Description: Keep `query`, `how`, and `status` contracts stable for current layers while allowing later Practice and Personal Memory scopes to join without a parallel interface.
  - Why: MCP should wrap proven semantic contracts instead of freezing an incomplete Project-only surface.

## Roadmap Step 14: Detached MCP Wrapper

Goal: expose proven Myelin semantic and submission contracts as globally available tools for agents working in other repositories.

MCP remains detached from the core package graph. It should consume the stable CLI/JSON behavior proven across Steps 10 through 13, preserve required compatibility contracts, and never become a second implementation of memory semantics.

- [ ] `open` Define the detached MCP wrapper boundary.
  - Description: Decide which stable CLI/JSON operations become tools, what arguments and results they expose, and what remains internal to the Myelin runtime.
  - Why: MCP should wrap working behavior, not invent product semantics.
- [ ] `open` Wrap `query`, `how`, and `status` for external agents.
  - Description: Expose the core agent-facing facades so agents in other repositories can retrieve memory and current state without knowing Myelin internals.
  - Why: The main value of MCP is global access to the same semantic behavior proven through the core CLI.
- [ ] `open` Wrap controlled inbox and candidate submission.
  - Description: Let external agents submit durable-memory leads through the same preserved-source and candidate boundaries used by CLI dogfood.
  - Why: External tools should feed the existing lead-to-memory pipeline rather than create a parallel write path.
- [ ] `open` Preserve legacy MCP compatibility contracts.
  - Description: Keep required `LLM_WIKI_*` environment and `mcp__llm-wiki__*` namespace compatibility while product naming and behavior remain Myelin-owned.
  - Why: Compatibility should survive the wrapper transition without allowing legacy concepts to shape new core behavior.
- [ ] `open` Preserve detached MCP ownership.
  - Description: Keep core behavior in Myelin CLI/runtime code and keep MCP as a detached consumer of stable command and JSON contracts.
  - Why: The wrapper must not become a second implementation of memory logic.

## Roadmap Step 15: Practice Memory

Goal: promote reusable cross-project guidance into canonical, human-reviewable memory after the core project loop and external interfaces are stable.

Practice Memory should reuse proven curation and retrieval mechanics where appropriate, but its evidence boundary is cross-project: project references are provenance, not instructions to copy local behavior into global guidance.

- [ ] `open` Define Practice Memory evidence and promotion boundaries.
  - Description: Establish when repeated or explicitly selected project evidence is sufficient to propose reusable guidance and how conflicting project practices remain visible.
  - Why: Cross-project recurrence must not automatically become canonical practice.
- [ ] `open` Add canonical Practice Memory storage and provenance.
  - Description: Store approved practice guidance as human-reviewable markdown with source-project provenance and derived serving state kept separate.
  - Why: Practice Memory needs the same canonical-versus-derived boundary that made Project Memory trustworthy.
- [ ] `open` Add Practice Memory curation, maintenance, and review.
  - Description: Turn Practice candidates and handoffs into validated global guidance through explicit promotion and terminal review outcomes.
  - Why: Practice leads are not durable truth and need a dedicated cross-project judgment boundary.
- [ ] `open` Add Practice Memory retrieval and facade integration.
  - Description: Make approved guidance available to `query` and preferentially to `how`, then extend the detached wrapper through the stable core contracts.
  - Why: Practice Memory is useful only when agents can retrieve it without bypassing project-specific overrides.

## Roadmap Step 16: Personal Memory

Goal: maintain durable guidance about user preferences and agent behavior through explicit authority, correction, and privacy boundaries.

Personal Memory is not merely another global Project Memory. Explicit user guidance, repeated corrections, observed behavior, and removal requests carry different authority and risk than cross-project technical evidence.

- [ ] `open` Define Personal Memory authority and evidence boundaries.
  - Description: Establish how explicit guidance, repeated corrections, inferred preferences, uncertainty, and user-requested removal affect promotion and trust.
  - Why: Personal guidance should never be promoted or retained through project-evidence rules alone.
- [ ] `open` Add canonical Personal Memory storage and provenance.
  - Description: Store approved personal guidance as human-reviewable markdown with clear origin, confidence, and correction history while keeping derived serving state replaceable.
  - Why: Personal Memory needs transparent authority and provenance because it directly shapes future agent behavior.
- [ ] `open` Add Personal Memory curation, correction, and review.
  - Description: Turn Personal candidates and handoffs into validated guidance with explicit support for correction, rejection, and removal.
  - Why: Preference mistakes must be reversible without obscuring how the guidance was created.
- [ ] `open` Add Personal Memory retrieval and facade integration.
  - Description: Integrate approved personal guidance into `query`, `how`, and agent behavior precedence, then extend detached consumers through the stable core contracts.
  - Why: Personal guidance should influence agents consistently without overriding explicit project truth or current user instructions.

## Always-On Guardrails

- Keep hooks fast and fail-open.
- Keep provider-backed work detached and bounded.
- Do not let auto-maintenance recursively capture its own provider sessions.
- Keep SQLite as serving/recall state, not curated truth.
- Keep markdown Project/Practice/Personal memory human-reviewable.
- Do not import root `src/` from detached MCP or MCP source from root core.
- Do not manually drain the live dogfood queue as proof of progress.
