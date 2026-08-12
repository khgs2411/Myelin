# Project Memory Lifecycle

Project Memory is created and maintained by `myelin project learn <key>` as curated markdown in `projects/<key>/wiki/`, with Myelin-owned state, provenance, source-consumption, promotion, and retrieval-refresh mechanics around the agent-authored documentation.

## Lifecycle Entry Point

The CLI surface is `myelin project learn <project-key> [--dry-run] [--review] [--recreate] [--provider codex|claude] [--model <model>] [--json]`, implemented through `src/commands/project.ts` and `src/project/project-service.ts`. `ProjectService.runProjectLearn()` delegates to `ProjectMemoryCuratorService.runProjectLearn()`, so the active lifecycle is centralized in `src/project/project-memory-curator-service.ts`.

Each run starts by locating the project, choosing the target repo path from project config, checking for incomplete apply journals, creating a timestamped `projects/<key>/runs/project-learn/<run>/` directory, and ensuring schema context freshness via `ensureProjectLearnSchemaContext()` in `src/runtime/project-run-infrastructure.ts`. If an incomplete journal exists, the service attempts journal recovery before starting a new curation run.

`project learn` is also the Project Memory runtime-inbox intake boundary. The older `project ingest` vocabulary is not active for Project Memory; top-level `ingest <key>` belongs to Experience Log to Session Memory processing.

## Mode Selection

`ProjectMemoryCuratorService` builds an input packet with `buildProjectMemoryPacket()` after reconciliation and runtime inbox intake. The packet includes project state, wiki pages and extracted sections, pending project candidates and handoffs, recent Session Memory, and markdown lookup results from `src/project/project-memory-packet.ts`.

Mode is selected from state:

- If `--recreate` is present, the run uses create mode and records run kind `recreate`.
- If `state.project_memory.status` is `curated`, ordinary runs use maintenance mode and run kind `maintenance`.
- Otherwise the first successful run uses create mode followed by maintenance mode and records run kind `create_then_maintenance`.

ADR 0067 (`docs/adr/0067-use-agent-authored-project-memory-documentation.md`) is the current product decision: create mode is agent-authored markdown documentation, not structured JSON page curation. This supersedes the create/apply/validation parts of older structured-curator ADRs, while preserving markdown truth, journal-backed promotion, and retrieval derived from markdown.

## Create Mode

Create mode is implemented in `src/project/project-memory-agent-create-service.ts`. It creates `agents/create/draft-wiki/` under the run directory, invokes a planner/index file-authoring agent, normalizes `reports/documentation-subject-manifest.json`, verifies the planner produced `index.md` and one placeholder file per subject, then invokes one subject writer per manifest entry with bounded concurrency.

The planner owns documentation shape. Myelin requires a navigable `index.md` and safe markdown paths, but it does not require fixed files such as `architecture.md`, answer-domain sections, citation counts, or schema-shaped page payloads. Subject writers replace their assigned placeholder files and write `reports/subject-report.json`; the JSON reports are operational metadata, not the documentation contract.

After all subject writers complete, create mode snapshots the draft wiki to `pre-maintenance-wiki/`. On a first run, Myelin then immediately runs maintenance mode against pending project candidates and handoffs using the created draft wiki as the base. This lets existing leads be applied or terminally classified without feeding candidates into the planner.

## Maintenance Mode

Maintenance mode is implemented in `src/project/project-memory-agent-maintenance-service.ts`. It copies the base wiki into `agents/maintenance/draft-wiki/`, invokes a maintenance file-authoring agent when pending sources exist, and requires `reports/documentation-maintenance-report.json`.

Every pending source receives one disposition from `src/project/project-memory-agent-contracts.ts`:

- `applied_to_project_memory`
- `already_covered`
- `insufficient_evidence`
- `not_durable`
- `belongs_to_other_layer`
- `deferred_unsafe_change`
- `blocked_by_runner_failure`

The service validates that every pending project candidate or project handoff has exactly one known disposition. It also normalizes legacy `already_trusted` to `already_covered`; tests in `tests/project/project-memory-agent-contracts.test.ts` lock that vocabulary.

When no pending sources exist, maintenance returns `noop` with an empty report. When the report is valid, dispositions are converted to source-consumption records so candidate and handoff lifecycle can be reconciled after promotion.

## Source Intake And Reconciliation

Before packet construction, `ProjectMemorySourceConsumptionReconciler` in `src/project/project-memory-source-consumption-reconciler.ts` reads `projects/<key>/state/project-memory-source-consumptions.json` and marks consumed `memory_candidates` and project handoffs processed in root SQLite. Malformed source-consumption state is blocking; a missing `state/memory.db` is degraded but non-blocking.

Runtime inbox intake happens next through `ProjectMemoryCandidateIntakeService` in `src/project/project-memory-candidate-intake-service.ts`. It reads preserved JSON source records under `projects/<key>/sources/inbox/*.json`, accepts only `target_layer: "project"`, and creates or reuses `needs_review` `memory_candidates` with `candidate_type: "project.inbox"`. Unsupported or malformed inbox files degrade intake without rewriting source files; an unknown project blocks.

After promotion, the reconciler runs again so the new source-consumption state can retire the sources that the maintenance report terminally handled. The tests in `tests/project/project-memory-source-consumption-reconciler.test.ts` cover processed candidates, processed handoffs, supported no-op dispositions, and fail-closed malformed state.

## Promotion And Recovery

Canonical writes are owned by Myelin, not by the authoring agents. `promoteDraftWiki()` in `src/project/project-memory-draft-promotion.ts` converts every markdown file in the draft wiki into staged writes under `projects/<key>/wiki/`, requires at least `index.md`, and adds state writes for:

- `projects/<key>/state/project-memory.json`
- `projects/<key>/state/project-memory-source-consumptions.json`

The actual write mechanism is `ProjectMemoryMarkdownApplier.promoteStagedWrites()` in `src/project/project-memory-markdown-applier.ts`. It writes staged outputs, records `project-memory-apply-journal.json`, verifies canonical before-hashes, promotes staged files by temp-file rename, and records observed promotions. State writes are ordered after wiki writes, with `project_state` last.

Journal recovery is fail-closed. A later `project learn` first calls `findIncompleteApplyJournals()`; recovery only completes if apply result and changeset artifacts exist and canonical files have not drifted from recorded hashes. ADR 0060 (`docs/adr/0060-use-apply-journal-for-project-memory-writes.md`) records why Project Memory writes use this journal-backed staged promotion boundary.

Dry-run and review mode stop before promotion. In those modes `ProjectMemoryCuratorService.promoteAndFinish()` records terminal artifacts but `stopped_before_writes` remains true.

## State And Run Artifacts

Agent-authored Project Memory state uses schema version 2 from `ProjectMemoryAgentStateV2` in `src/project/project-memory-agent-contracts.ts`. It records:

- `status`: `curated`, `degraded`, or `failed`
- `source_run_dir`, `updated_at`, `provider_mode`, `curation_kind`, and `run_kind`
- create planner/writer status, subject count, concurrency, retry count, and report references
- maintenance status, disposition counts, applied/already-covered counts, and degraded reasons
- retrieval readiness
- `content_quality.status: "not_evaluated"` with reason `agent_authored_documentation_has_no_schema_quality_gate`

Run artifacts include `input-packet.json`, `runtime-inbox-intake.json`, `source-consumption-reconciliation.json`, create and maintenance result files, planner and subject reports, apply journal/result/changeset, retrieval artifacts, `curator-run-result.json`, and `summary.md`.

## Retrieval Refresh

Project Memory retrieval is derived from canonical markdown, not a second source of truth. ADR 0062 (`docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`) keeps structural metadata, hints, and vector rows rebuildable from wiki markdown.

After promotion, `DefaultProjectMemoryPostApplyRetrievalLifecycle` in `src/project/project-memory-curator-service.ts`:

1. Extracts markdown sections with `extractProjectMemorySections()` from `src/project/project-memory-markdown-sections.ts` and writes `project-memory-retrieval-sections.json`.
2. Generates semantic hints with `generateProjectMemoryHints()` from `src/project/project-memory-hint-generator.ts` when pages or items changed.
3. Calls `ProjectMemoryRetrievalIndexService.indexProject()` from `src/memory/project-memory-retrieval-index-service.ts`, which delegates to `indexProjectMemoryRetrieval()` in `src/memory/project-memory-retrieval-indexer.ts`.

The indexer writes the section manifest, validates hint freshness, ensures pending retrieval embedding rows, marks stale or orphaned rows, and attempts SQLite vector indexing with the active embedding contract. If hints or indexing degrade, `project learn` can still report successful canonical writes as `completed_with_pending_index`; `projects/<key>/state/project-memory.json` is then updated with `retrieval_readiness.status: "pending"`.

Fallback markdown lookup in `src/project/project-memory-lookup.ts` remains a bootstrap and diagnostic path. It reports `lookup_quality: "fallback"` and a degraded reason rather than pretending a vector index was used.

## Current Boundary To Remember

There are still older structured apply helpers in `src/project/project-memory-markdown-applier.ts` for `ProjectMemoryCreationDraft` and `ProjectMemoryMaintenanceProposal`. They are useful historical and compatibility surfaces, but ADR 0067 makes the active create/maintenance product path agent-authored draft markdown plus small operational reports. Future changes should not infer required documentation shape from the old structured contracts unless the current service path starts using them again.
