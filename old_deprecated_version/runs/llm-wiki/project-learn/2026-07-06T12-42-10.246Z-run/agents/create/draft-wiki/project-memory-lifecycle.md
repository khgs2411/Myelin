# Project Memory Lifecycle

Project Memory lifecycle is the `project learn` flow that turns repository evidence, runtime inbox items, and pending memory leads into canonical markdown wiki pages plus derived retrieval state.

## Lifecycle Overview

`ProjectMemoryCuratorService.runProjectLearn` in `src/project/project-memory-curator-service.ts` is the lifecycle coordinator. Each run creates a timestamped `projects/<key>/runs/project-learn/<run-id>/` directory, repairs the project shell for non-dry runs, verifies or rebuilds schema context, reconciles previously recorded source consumptions, performs runtime inbox intake, builds an input packet, runs create or maintenance mode, promotes draft markdown, reconciles consumed sources again, and refreshes retrieval indexes.

The mode decision is state-driven. If `projects/<key>/state/project-memory.json` has `status: "curated"`, the run is maintenance mode. If that state is absent or not curated, the run is create mode. The explicit `recreate` input forces create mode and records run kind `recreate`, but ordinary first runs record `create_then_maintenance` because create is followed by a maintenance pass.

The current implementation keeps old curator result vocabulary for compatibility artifacts such as `curator-validation.json` and `curator-run-result.json`, but the live lifecycle is agent-authored markdown. Successful state is schema version 2, `curation_kind: "agent_authored"`, and `content_quality.status: "not_evaluated"` with reason `agent_authored_documentation_has_no_schema_quality_gate` as defined in `src/project/project-memory-agent-contracts.ts`.

## Project Memory Packets

`src/project/project-memory-packet.ts` builds the packet consumed by lifecycle orchestration. The packet is not the documentation output shape; it is the run input summary. It includes:

- project metadata and repo paths from project config
- current bootstrap, Project Memory, freshness, and pages state
- existing wiki page and markdown section summaries
- pending project handoffs and project candidates from `state/memory.db`
- selected Session Memory rows for context
- lookup queries and lookup results for pending handoffs, candidates, and selected Session Memory
- degradation reasons when expected state such as `state/memory.db` or wiki markdown is unavailable

Packets use `mode: "create"` when Project Memory is not curated and `mode: "maintain"` once the state is curated. Tests in `tests/project/project-memory-packet.test.ts` verify that packet construction is bounded, includes pending project inputs, performs deterministic fallback lookup against the full markdown corpus, and does not create a memory database merely by reading packet inputs.

## Runtime Inbox Intake

Runtime inbox intake runs before packet construction through `ProjectMemoryCandidateIntakeService` in `src/project/project-memory-candidate-intake-service.ts`. It reads JSON files under the project runtime inbox, validates filenames and item shape, and converts project-layer items into `memory_candidates` rows with:

- `scope: "project"`
- `status: "needs_review"`
- `candidate_type: "project.inbox"`
- source refs like `inbox:<item-id>`
- the original inbox body, rationale, evidence refs, target hint, creator, confidence, risk, tags, and creation time preserved in candidate evidence and proposed payload

Intake is idempotent. Existing pending or needs-review candidates are reported as existing; already processed or rejected candidates are terminal duplicates. Malformed files and unsupported target layers degrade the intake summary without blocking valid items. Unknown projects are blocking because there is no safe project scope to attach the candidate to. These contracts are covered by `tests/project/project-memory-candidate-intake-service.test.ts`.

## Create Mode

Create mode is direct documentation authoring, not schema-shaped page generation. The design in `docs/design/2026-07-06-project-memory-agent-authored-documentation/spec.md` and the implementation in `src/project/project-memory-agent-create-service.ts` split create into a planner/index phase and per-subject writer phase.

The planner agent runs in `agents/create/` with a run-local `draft-wiki/` and `reports/` output roots. It inspects the target repository snapshot from `target-repo/`, writes `draft-wiki/index.md`, creates one placeholder markdown file per documentation subject, and writes `reports/documentation-subject-manifest.json` plus `reports/documentation-planner-report.json`. The manifest has `schema_version`, `project_key`, and subject entries containing `subject_id`, `wiki_path`, `title`, `purpose`, and `suggested_repo_paths`. Myelin validates path safety, markdown paths, uniqueness, and that `index.md` and each subject file exist; it does not validate required sections or content coverage.

Subject writer agents then run with bounded concurrency. The default concurrency is 4, normalized to at least 1, and each writer gets one retry after a mechanical failure. A writer receives the subject assignment, current `index.md`, and the target repository snapshot, then writes only its assigned markdown file and `reports/subject-report.json`. Myelin copies the writer's assigned file back into the create draft wiki and normalizes the subject report. Missing or malformed subject reports do not discard the markdown; they become known gaps in a fallback completed report. Failed writers fail create mode after retry.

When all subject writers complete, create mode snapshots the authored draft wiki to `pre-maintenance-wiki/`. That snapshot is operational evidence for the create output before candidate-guided maintenance is applied.

## Maintenance Mode

Maintenance mode is candidate-guided direct markdown editing implemented by `src/project/project-memory-agent-maintenance-service.ts`. It starts by copying the base wiki into `agents/maintenance/draft-wiki/`. On first create runs the base wiki is the create draft; on later runs it is the canonical `projects/<key>/wiki/`.

If there are no pending sources, maintenance writes an empty completed report and returns `noop`. Otherwise it invokes one file-authoring agent with the copied draft wiki, target repository snapshot, and pending project candidates and handoffs. The agent must update draft markdown only when a source improves durable project understanding, and it must write `reports/documentation-maintenance-report.json`.

Every pending source must receive exactly one disposition:

- `applied_to_project_memory`
- `already_covered`
- `insufficient_evidence`
- `not_durable`
- `belongs_to_other_layer`
- `deferred_unsafe_change`
- `blocked_by_runner_failure`

`already_trusted` is accepted as a legacy alias for `already_covered`; `blocked_by_quality` is intentionally not accepted in the new vocabulary. `tests/project/project-memory-agent-contracts.test.ts` covers this migration boundary. The maintenance report validator requires schema version 1, matching project key, a completed/degraded/failed status, dispositions for only known pending sources, and a disposition for every pending source.

Maintenance dispositions are converted into `ProjectMemorySourceConsumptionRecord` values by `sourceConsumptionsFromMaintenanceReport`. These records preserve source kind, source ref, run dir, consumed timestamp, terminal decision, and output refs.

## Source Consumption Reconciliation

Source consumption state is stored in `projects/<key>/state/project-memory-source-consumptions.json`. `ProjectMemorySourceConsumptionReconciler` in `src/project/project-memory-source-consumption-reconciler.ts` reads that state before each run and again after promotion. It marks referenced project candidates and project handoffs processed in `state/memory.db` when their terminal decision is supported.

Supported terminal decisions are `applied_to_project_memory`, `already_covered`, `not_durable`, `belongs_to_other_layer`, and `insufficient_evidence`, with legacy `already_trusted` normalized to `already_covered`. Missing sources are reported but do not make reconciliation blocking. Malformed source-consumption state fails closed with a blocking degraded result so the lifecycle does not process queues from untrusted state. `tests/project/project-memory-source-consumption-reconciler.test.ts` verifies processed candidates and handoffs, supported no-op dispositions, ignored obsolete dispositions, absence of state, and malformed state.

## Direct Markdown Authoring Boundary

File-authoring agents run through `runFileAuthoringAgent` in `src/runtime/file-authoring-agent.ts`, called via `invokeFileAuthoringAgent` from `src/runtime/project-run-infrastructure.ts`. This is separate from the JSON-only `invokeLlm` path.

For each stage, Myelin creates a run-local workspace, copies the target repository into a `target-repo/` snapshot, creates explicit output roots, runs Codex with `--sandbox workspace-write`, and discovers filesystem outputs after the process exits. It records `file-authoring-agent-result.json` with provider, model, provider mode, sandbox, cwd, target repo snapshot, allowed output roots, discovered outputs, and status. Fixture-backed tests use `FILE_AUTHORING_STUB_OUTPUTS_DIR`.

The runner snapshots workspace files before and after execution and fails if any changed file is outside the allowed output roots. It also rejects output root paths that resolve outside the workspace. Agents can write draft artifacts in their workspace, but canonical `projects/<key>/wiki/` and `projects/<key>/state/` writes remain owned by Myelin promotion code. `tests/runtime/file-authoring-agent.test.ts` covers run-local cwd, workspace-write sandbox, output-root escape rejection, and stray write rejection.

## Draft Promotion

`src/project/project-memory-draft-promotion.ts` promotes draft markdown through the existing `ProjectMemoryMarkdownApplier.promoteStagedWrites` journal path. Promotion recursively collects `*.md` files from the draft wiki, requires at least `index.md`, stages each markdown file to `projects/<key>/wiki/<relative-path>`, and stages:

- `projects/<key>/state/project-memory.json`
- `projects/<key>/state/project-memory-source-consumptions.json`

The state write records agent-authored lifecycle metadata, including create and maintenance report refs, subject counts, maintenance disposition counts, provider mode, run kind, retrieval readiness, and no schema quality gate. Promotion writes `project-memory-apply-result.json` and `project-memory-changeset.json` in the run directory. Tests in `tests/project/project-memory-draft-promotion.test.ts` verify journal-backed markdown promotion, v2 state writing, missing-index rejection, and nested markdown paths.

Dry-run and review mode stop before promotion. Review mode still runs agents and records artifacts, but `stopped_before_writes` remains true and canonical wiki files are not written, as tested in `tests/project/project-memory-curator-service.test.ts`.

## Post-Apply Retrieval

After promotion, the default post-apply lifecycle in `ProjectMemoryCuratorService` extracts markdown sections, writes `project-memory-retrieval-sections.json`, generates Project Memory hints when pages or items changed, writes `project-memory-hint-generation-result.json`, and runs `ProjectMemoryRetrievalIndexService.indexProject` with a limit of 500 and batch size 50. The index result is written to `project-memory-retrieval-index-result.json`.

If hint generation, indexing, or pending index rows leave a degraded reason, the run returns `completed_with_pending_index`; otherwise it returns `completed`. `project-memory.json.retrieval_readiness` is then updated from `pending` to `ready` or remains pending with the reason. This preserves the design contract from `docs/design/2026-07-06-project-memory-agent-authored-documentation/plan.md`: retrieval is derived from promoted markdown and may be pending after otherwise successful promotion.

## Reset And Recreate

Clean rebootstrap is a separate operator action implemented by `src/project/project-reset-service.ts`. It deletes the project shell under `projects/<key>/`, bootstraps it again from the configured repo path, and verifies root `state/memory.db` is preserved. This is different from ordinary maintenance and from explicit `project learn --recreate`: reset removes the existing wiki and project state shell, while recreate is a Project Memory learn run kind. `tests/project/project-reset-service.test.ts` verifies that clean rebootstrap removes old wiki and Project Memory state while preserving the root memory database.

## Current Gaps And Edges

The lifecycle still carries compatibility names such as `curator-validation.json`, `curator_output`, and `content_quality_status: "trusted"` in run-result surfaces even though agent-authored state says content quality is not evaluated by schema gates. Future cleanup should keep compatibility only where external callers need it.

The design allows candidate-specific maintenance failure fallback to promote the create snapshot in some cases, but the current `runCreateThenMaintenance` implementation fails the whole run when maintenance returns `failed`. That is a stricter behavior than the design text and should be treated as the current code contract unless changed deliberately.

`FileAuthoringAgentResult` has a `provider_mode: "test"` type, and `ProjectMemoryCuratorService` records state provider mode as `test` when a custom runner is injected, but `runFileAuthoringAgent` currently reports only `stub` or `live` in its own result depending on `FILE_AUTHORING_STUB_OUTPUTS_DIR`. This is a small observability mismatch in test-mode metadata, not a markdown lifecycle blocker.
