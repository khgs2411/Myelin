# Project Memory Creation and Curation

Project Memory is created and maintained by `myelin project learn <key>`, which builds bounded run context, invokes documentation-authoring agents, promotes accepted draft markdown through journal-backed writes, reconciles consumed leads, and refreshes derived retrieval state.

## Current creation model

The current create-mode contract is agent-authored documentation, not structured JSON page generation. ADR 0067 in `docs/adr/0067-use-agent-authored-project-memory-documentation.md` supersedes the create/apply/validation parts of the earlier structured designs in ADR 0059, ADR 0063, ADR 0064, and ADR 0065. Those older contracts still have code and tests in the tree, but future agents should treat ADR 0067 plus `src/project/project-memory-agent-create-service.ts` as the active create-mode behavior.

On the first curated run, `ProjectMemoryCuratorService.runProjectLearn()` in `src/project/project-memory-curator-service.ts`:

- repairs the project shell when not in dry-run mode;
- creates a timestamped run directory under `runs/<key>/project-learn/<run-id>/` through `src/runtime/project-run-infrastructure.ts`;
- ensures schema context freshness before learning;
- runs source-consumption reconciliation and runtime inbox intake before packet construction;
- builds and records `input-packet.json` with current project state, wiki pages, pending project candidates and handoffs, recent Session Memory, and Project Memory lookup results;
- chooses `create` mode when `state.project_memory.status` is not `curated`, unless `--recreate` forces create mode;
- runs create mode, then immediately runs maintenance mode against pending project candidates and handoffs before promotion.

Create mode itself is implemented in `src/project/project-memory-agent-create-service.ts`. A planner agent inspects `target-repo/`, writes `draft-wiki/index.md`, creates placeholder files for planned subjects, and writes `reports/documentation-subject-manifest.json` plus `reports/documentation-planner-report.json`. Myelin validates only the mechanical subject-manifest contract: schema version, project key, unique subject ids, safe markdown paths, and existence of the planned placeholder files.

After planning, Myelin runs one subject writer per manifest entry with bounded concurrency. The default concurrency is 4 and the retry limit is one retry after the initial attempt. Each writer receives the current draft index, its assigned subject metadata, read access to the target repo snapshot, and writable access only to its run-local output roots. The writer replaces its assigned markdown page and writes `reports/subject-report.json`. Subject reports are operational evidence, not content-shape gates.

## Maintenance model

Later ordinary `project learn` runs are maintenance-only. The mode decision is made from `project-memory.json` or bootstrap state in `src/project/project-memory-packet.ts` and `src/project/project-memory-curator-service.ts`. `myelin project learn <key> --recreate` is the explicit high-cost path that forces create mode again; it is separate from `myelin project reset <key> --clean --confirm <key>`, which deletes and reboots the project shell while preserving root `state/memory/memory.db`.

Maintenance is implemented in `src/project/project-memory-agent-maintenance-service.ts`. It copies the base wiki into a run-local `agents/maintenance/draft-wiki/`, gives the maintenance agent pending project candidates and handoffs from the packet, and requires one disposition for every pending source. The canonical dispositions are:

- `applied_to_project_memory`
- `already_covered`
- `insufficient_evidence`
- `not_durable`
- `belongs_to_other_layer`
- `deferred_unsafe_change`
- `blocked_by_runner_failure`

The maintenance report at `reports/documentation-maintenance-report.json` is validated for mechanical completeness: correct schema version and project key, valid dispositions, known pending refs only, and exactly one disposition per pending source. The report then becomes the source for `ProjectMemorySourceConsumptionRecord` entries so consumed candidates and handoffs can be reconciled after apply.

## File-authoring boundary

Agent-authored Project Memory uses `src/runtime/file-authoring-agent.ts`, not the JSON-only `invokeLlm` path. The runner creates a run-local workspace, snapshots the target repo into `target-repo/`, invokes Codex with `--sandbox workspace-write`, and checks filesystem outputs after the agent exits.

The important write boundary is strict: file-authoring agents may write only under declared output roots such as `draft-wiki/` and `reports/` inside their run-local workspace. They never write canonical `projects/<key>/` or `state/<key>/` directly. `tests/runtime/file-authoring-agent.test.ts` covers stub output copying, live runner command shape, escaping output-root rejection, and stray write rejection.

Stubbed file-authoring runs are explicit through `FILE_AUTHORING_STUB_OUTPUTS_DIR`; project state records provider mode as `stub` or `test` rather than presenting fixture output as live product-quality documentation.

## Apply and promotion

Canonical writes are owned by Myelin promotion code. The active agent-authored path uses `promoteDraftWiki()` in `src/project/project-memory-draft-promotion.ts`. It converts every markdown file in the draft wiki into staged writes under canonical `projects/<key>/`, adds `state/<key>/project-memory.json`, adds `state/<key>/project-memory-source-consumptions.json`, and promotes the staged set through `ProjectMemoryMarkdownApplier.promoteStagedWrites()`.

The apply journal is the safety boundary. `src/project/project-memory-markdown-applier.ts` writes `project-memory-apply-journal.json` before promotion, records expected writes with before-hashes, tracks observed promotions, and blocks recovery if canonical files drift after observed promotion. New `project learn` runs first look for incomplete journals and recover or fail before starting fresh curation.

Create-mode draft promotion removes stale canonical wiki markdown files that are absent from the new draft. Maintenance mode promotes the maintenance draft over the existing wiki. Successful promotion writes:

- `project-memory-apply-result.json`
- `project-memory-changeset.json`
- `curator-validation.json`
- `curator-run-result.json`
- `summary.md`

Review and dry-run modes still run the authoring work, but `promoteAndFinish()` stops before canonical writes. The CLI result reports `stopped_before_writes: true` and a stopped reason such as `review requested` or `dry-run requested`.

### Reviewed maintenance promotion

`myelin memory maintain project <key> --review` creates an unpromoted maintenance review; `myelin memory maintain project <key> --promote <run>` is the separate publication step. `src/project/project-memory-review-checkpoint.ts` fingerprints the target repository, hashes the input packet, reviewed source set, canonical wiki baseline, report artifacts, and every draft-wiki file. Before copying the reviewed draft into a new apply run, promotion verifies all of those values, confirms the source run is a validated maintenance review with no apply journal, and checks that each reviewed candidate or handoff is still pending and byte-for-byte unchanged. It then promotes those exact reviewed markdown bytes through the normal journaled apply path; it does not invoke the maintenance authoring agent again.

This deliberately fails closed when the target snapshot, canonical baseline, review artifacts, or pending source set changes, or when the review was already promoted. `src/project/project-memory-curator-service.ts` records the source run as `reviewed_from_run` in the resulting canonical state. `tests/project/project-memory-curator-service.test.ts` and `tests/commands/memory.test.ts` cover repository-drift rejection, promotion option conflicts, and foreground maintenance progress.

## Packets, evidence maps, and older curator contracts

`input-packet.json` is still the active bounded context artifact. It is built by `src/project/project-memory-packet.ts` from project config and state, current wiki markdown and extracted sections, pending project candidates and handoffs, recent Session Memory rows from root `state/memory/memory.db`, and lookup results. Packet degradation remains meaningful for missing wiki pages, missing memory DB, and blocking lookup quality.

Evidence-map-first create mode is no longer active after ADR 0067, but the implementation remains in `src/project/project-memory-evidence-map.ts`. It deterministically maps required answer domains to repo paths, bounded `rg` search results, candidates, handoffs, and Session Memory leads. That file is useful historical context for why Project Memory needed repo-grounded evidence, but it should not be treated as the current create-mode gate.

The structured curator contracts in `src/project/project-memory-curator-contracts.ts`, the output schema in `src/project/project-memory-curator-output-schema.ts`, the validator in `src/project/project-memory-curator-validator.ts`, and structured apply methods in `src/project/project-memory-markdown-applier.ts` are also legacy or compatibility surface for the older JSON-proposal flow. They define concepts such as creation drafts, maintenance proposal items, repo citations, evidence refs, eligible/rejected/quarantined outcomes, and quality diagnostics. The active agent-authored path records a successful validation result with no item-level schema gate because the draft wiki files are the authored product.

## Quality gates

Current quality gating is intentionally mechanical, not section-count or citation-density scoring. The active path verifies that:

- the planner produced `index.md`, placeholders, a safe subject manifest, and planner report files;
- every subject writer completed or failed after retry with a subject report;
- maintenance either no-ops when there are no pending sources or provides valid dispositions for all pending sources;
- file-authoring outputs stay inside allowed run-local output roots;
- draft promotion includes at least `index.md`;
- journal-backed promotion can recover safely or fail closed;
- retrieval indexing status is reported separately from content publication.

The older `src/project/project-memory-quality-contract.ts` still defines answer-domain coverage, trusted/review/shallow/blocked statuses, and body/citation checks. ADR 0067 says those content-shape gates should not control agent-authored create mode. For agent-authored runs, the canonical trust marker is `state/<key>/project-memory.json`: `ProjectMemoryAgentStateV2.content_quality` is written as `not_evaluated` with reason `agent_authored_documentation_has_no_schema_quality_gate`. If an operational run artifact such as `curator-run-result.json` reports `content_quality_status: "trusted"` for the same agent-authored run, treat it as a compatibility summary, not as an evaluated content-quality verdict.

## Retrieval after apply

After canonical promotion, `DefaultProjectMemoryPostApplyRetrievalLifecycle` in `src/project/project-memory-curator-service.ts` refreshes serving state from markdown. It extracts markdown sections through `src/project/project-memory-markdown-sections.ts`, writes `project-memory-retrieval-sections.json`, optionally generates semantic hints through `src/project/project-memory-hint-generator.ts`, and indexes Project Memory retrieval rows through `ProjectMemoryRetrievalIndexService`.

Retrieval readiness is separate from content publication. If indexing completes, the final run status is `completed` and `project-memory.json.retrieval_readiness.status` becomes `ready`. If hint generation, vector indexing, or pending retrieval rows remain, the run may finish as `completed_with_pending_index` and the state records retrieval readiness as `pending`. Canonical markdown remains the trusted Project Memory source; retrieval rows are derived serving state.

## Run artifacts and state

A useful `project learn` run leaves an auditable artifact set under `runs/<key>/project-learn/<run-id>/`. The active agent-authored artifacts include:

- `input-packet.json`
- `source-consumption-reconciliation.json`
- `runtime-inbox-intake.json`
- `documentation-create-result.json` for create runs
- `documentation-maintenance-result.json`
- `reports/documentation-subject-manifest.json`
- `reports/documentation-planner-report.json`
- per-subject `agents/subject-<id>/reports/subject-report.json`
- `reports/documentation-maintenance-report.json`
- `pre-maintenance-wiki/` for create runs
- per-agent `file-authoring-agent-result.json`
- `project-memory-apply-journal.json`
- `project-memory-apply-result.json`
- `project-memory-changeset.json`
- retrieval section, hint-generation, and index-result artifacts
- `curator-run-result.json`
- `summary.md`

Canonical state after promotion is under `state/<key>/`. `project-memory.json` records schema version 2, curated/degraded/failed status, source run dir, provider mode, `curation_kind: agent_authored`, run kind, create/maintenance summaries, retrieval readiness, and the compatibility `content_quality.not_evaluated` marker. `project-memory-source-consumptions.json` records consumed project candidates and handoffs with terminal decisions and output refs.

A degraded latest maintenance result does not erase a usable curated baseline. `src/status/project-memory-inspector.ts` treats a readable canonical wiki with `project-memory.json.status: "curated" | "degraded"` as curated; when the latest maintenance result is degraded or failed, status reports `curated_with_degraded_maintenance` and an attention warning instead of forcing create mode. `tests/status/status-service.test.ts` covers this legacy degraded-state recovery contract.

## Tests that define the contract

The most useful verification surfaces for this subject are:

- `tests/project/project-memory-curator-service.test.ts` for create-plus-maintenance composition, maintenance-only candidate processing, review mode, and v2 state fields.
- `tests/project/project-memory-draft-promotion.test.ts` for draft markdown promotion, required `index.md`, nested markdown paths, and stale canonical markdown removal in create mode.
- `tests/runtime/file-authoring-agent.test.ts` for file-authoring sandbox, stub metadata, output-root escape checks, and stray write rejection.
- `tests/project/project-memory-agent-contracts.test.ts` and `tests/project/project-memory-curator-contracts.test.ts` for shared report/state and legacy contract expectations.
- `tests/project/project-memory-source-consumption-reconciler.test.ts` and `tests/project/project-memory-candidate-intake-service.test.ts` for the lead intake and retirement lifecycle around Project Memory maintenance.

## Practical guidance

When changing Project Memory creation or curation, start from `src/project/project-memory-curator-service.ts` because it composes the lifecycle. Use `src/project/project-memory-agent-create-service.ts` and `src/project/project-memory-agent-maintenance-service.ts` for active authoring behavior, `src/runtime/file-authoring-agent.ts` for provider execution boundaries, and `src/project/project-memory-draft-promotion.ts` plus `src/project/project-memory-markdown-applier.ts` for canonical write safety.

Do not reintroduce structured content-quality gates into create mode without revisiting ADR 0067. Do not let file-authoring agents write canonical project files directly. Do not treat candidates or Session Memory as truth; maintenance must verify them against repo evidence or existing documentation and then record a terminal disposition.
