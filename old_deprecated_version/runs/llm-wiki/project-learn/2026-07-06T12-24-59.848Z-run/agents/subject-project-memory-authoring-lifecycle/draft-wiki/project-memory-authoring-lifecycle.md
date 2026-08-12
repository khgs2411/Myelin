# Project Memory Authoring Lifecycle

Project Memory authoring is the `project learn` lifecycle that turns repository evidence, pending project leads, and run-local agent drafts into canonical wiki markdown and state.

## Current Boundary

ADR 0067 makes the current product boundary explicit: Project Memory create mode is agent-authored markdown documentation, not structured JSON page curation. Myelin owns orchestration, run artifacts, write boundaries, candidate lifecycle, atomic promotion, and derived retrieval state; agents own draft documentation text inside run-local output roots (`docs/adr/0067-use-agent-authored-project-memory-documentation.md`, `docs/design/2026-07-06-project-memory-agent-authored-documentation/spec.md`).

The repository still contains legacy structured-curator modules such as `src/project/project-memory-curator-validator.ts`, `src/project/project-memory-curator-output-schema.ts`, and legacy methods on `src/project/project-memory-markdown-applier.ts`. Those are historical or compatibility surfaces for the older JSON proposal flow. The active `project learn` orchestration path in `src/project/project-memory-curator-service.ts` calls the agent-authored create and maintenance services, then promotes a draft wiki tree.

## Mode Selection

`src/project/project-memory-packet.ts` builds the Project Memory packet and determines whether the run is `create` or `maintain`. A project is treated as maintenance-ready when `state/project-memory.json` or bootstrap state has `status: "curated"`; otherwise the packet mode is `create`.

`ProjectMemoryCuratorService.runProjectLearn` adds operational steps around that packet:

- recovers incomplete apply journals before starting new work;
- repairs the project shell for non-dry runs;
- ensures schema context freshness;
- reconciles any existing source-consumption state before reading new pending inputs;
- ingests runtime inbox items into project candidates;
- writes `input-packet.json`;
- runs create-then-maintenance for first curated Project Memory, or maintenance-only for later runs.

The first-run kind recorded in v2 state is `create_then_maintenance`; later ordinary runs record `maintenance`. A requested recreate uses create mode but records run kind `recreate` (`src/project/project-memory-curator-service.ts`).

## File-Authoring Runner

Agent-authored documentation uses `src/runtime/file-authoring-agent.ts`, not the JSON-only `invokeLlm` path. The runner creates a run-local workspace, snapshots the target repository under `target-repo/`, invokes Codex with `--sandbox workspace-write`, and allows writes only under declared output roots such as `draft-wiki/` and `reports/`.

After the agent exits, the runner snapshots the workspace and fails the stage if any changed file escapes the allowed roots. It records `file-authoring-agent-result.json` with provider mode, model, sandbox, cwd, target repo snapshot path, allowed output roots, discovered outputs, and status. Tests in `tests/runtime/file-authoring-agent.test.ts` cover stub output copying, live runner command shape, escaped output roots, and stray writes.

## Create Mode

Create mode is implemented in `src/project/project-memory-agent-create-service.ts`. It creates `agents/create/draft-wiki`, invokes a create planner, validates the planner manifest mechanically, copies planner reports to the run root, runs subject writers, and snapshots the completed create output to `pre-maintenance-wiki/`.

The planner owns documentation shape. Its prompt tells the agent to inspect `target-repo/`, choose the wiki subjects, write `draft-wiki/index.md`, create one placeholder markdown file per subject, and write:

- `reports/documentation-subject-manifest.json`
- `reports/documentation-planner-report.json`

The manifest is orchestration metadata only. Myelin validates `schema_version`, `project_key`, non-empty unique subject ids, markdown `wiki_path` values, and path safety. It does not enforce required page names, sections, coverage scores, or citation counts.

Subject writers run one per manifest subject with bounded concurrency. The default concurrency is 4 and the implementation clamps overrides to the range 1 through 8. Each writer receives the current `index.md`, the assigned subject metadata, suggested repo paths, and instructions to write only its assigned markdown file plus `reports/subject-report.json`. A mechanical failure gets one retry. Subject reports are validated for schema version, project key, subject id, wiki path, and `status: "completed"`; they are not a content-quality gate.

## Maintenance Mode

Maintenance mode is implemented in `src/project/project-memory-agent-maintenance-service.ts`. It copies the base wiki into `agents/maintenance/draft-wiki` and either no-ops when there are no pending sources or invokes a maintenance file-authoring agent.

On first Project Memory creation, the base wiki is the create-mode draft. On later runs, the base wiki is canonical `projects/<key>/wiki`. Pending sources come from the packet's project candidates and project handoffs. The maintenance prompt tells the agent to read the existing docs first, inspect repo files as needed, update `draft-wiki` markdown only for durable project understanding, and give every pending source exactly one disposition in `reports/documentation-maintenance-report.json`.

The canonical disposition vocabulary lives in `src/project/project-memory-agent-contracts.ts`:

- `applied_to_project_memory`
- `already_covered`
- `insufficient_evidence`
- `not_durable`
- `belongs_to_other_layer`
- `deferred_unsafe_change`
- `blocked_by_runner_failure`

Legacy `already_trusted` is normalized to `already_covered`; obsolete `blocked_by_quality` is intentionally not accepted by the new contract. Maintenance can return `completed`, `degraded`, or `failed`. A failed maintenance stage blocks promotion in the current implementation.

## Candidate And Inbox Intake

Runtime inbox files become Project Memory candidates before packet construction through `src/project/project-memory-candidate-intake-service.ts`. Project-scoped inbox items are normalized into `memory_candidates` rows with status `needs_review`, candidate type `project.inbox`, preserved source refs, evidence, proposed payload, confidence, risk, and rationale. Intake is idempotent for existing pending or terminal candidates.

Malformed or unsupported inbox files degrade the intake summary without blocking valid items. Unknown projects block intake. Tests in `tests/project/project-memory-candidate-intake-service.test.ts` cover normalization, idempotency, degraded-but-nonblocking invalid files, unsupported layers, and unknown-project blocking.

## Draft Promotion

Promotion is implemented by `src/project/project-memory-draft-promotion.ts`. It recursively collects markdown files from the selected draft wiki, requires at least `index.md`, stages every markdown file to `projects/<key>/wiki/<relative-path>`, writes v2 `state/project-memory.json`, and writes `state/project-memory-source-consumptions.json`.

The actual write is delegated to `ProjectMemoryMarkdownApplier.promoteStagedWrites` in `src/project/project-memory-markdown-applier.ts`. That applier writes staged files under the run directory, creates `project-memory-apply-journal.json`, promotes to canonical project paths in order, and writes `project-memory-apply-result.json` plus `project-memory-changeset.json`. This preserves the ADR 0060 journal-backed promotion and recovery behavior while replacing the old structured draft content source with markdown files authored by agents.

The v2 Project Memory state records `curation_kind: "agent_authored"`, provider mode (`live`, `stub`, or `test`), run kind, create metadata, maintenance metadata, retrieval readiness, and `content_quality.status: "not_evaluated"` with reason `agent_authored_documentation_has_no_schema_quality_gate`.

## Source Consumption

Maintenance reports are converted into `ProjectMemorySourceConsumptionRecord` values by `sourceConsumptionsFromMaintenanceReport` in `src/project/project-memory-agent-maintenance-service.ts`. Promotion persists the combined previous and new consumption records in `state/project-memory-source-consumptions.json`.

`src/project/project-memory-source-consumption-reconciler.ts` runs before and after authoring. It reads source-consumption state and marks matching project candidates or project handoffs as processed in `state/memory.db`. Only terminal dispositions are processed: `applied_to_project_memory`, `already_covered`, `not_durable`, `belongs_to_other_layer`, and `insufficient_evidence`. `deferred_unsafe_change` and `blocked_by_runner_failure` are deliberately not terminalized, so those sources can remain visible for future work.

The reconciler fails closed on malformed source-consumption state, degrades non-blockingly when `state/memory.db` is missing, deduplicates records by source kind and ref, and reports missing or already-terminal refs. Tests in `tests/project/project-memory-source-consumption-reconciler.test.ts` cover processed candidates and handoffs, legacy alias handling, ignored obsolete dispositions, missing state, and malformed state.

## Retrieval After Promotion

After promotion, `ProjectMemoryCuratorService` runs the post-apply retrieval lifecycle. The default path extracts markdown sections, generates Project Memory hints, and indexes Project Memory retrieval rows via `ProjectMemoryRetrievalIndexService`. If retrieval completes, `state/project-memory.json` is updated to `retrieval_readiness.status: "ready"`; if it remains pending, the run can still complete as `completed_with_pending_index`.

## Operational Artifacts

A successful agent-authored run may produce these run artifacts:

- `runtime-inbox-intake.json`
- `input-packet.json`
- `documentation-create-result.json` for create runs
- `reports/documentation-subject-manifest.json`
- `reports/documentation-planner-report.json`
- `agents/create/file-authoring-agent-result.json`
- `agents/subject-<id>/file-authoring-agent-result.json`
- `agents/subject-<id>/reports/subject-report.json`
- `pre-maintenance-wiki/` for create runs
- `documentation-maintenance-result.json`
- `reports/documentation-maintenance-report.json`
- `agents/maintenance/file-authoring-agent-result.json`
- `project-memory-apply-journal.json`
- `project-memory-apply-result.json`
- `project-memory-changeset.json`
- `source-consumption-reconciliation.json`
- `post-apply-source-consumption-reconciliation.json`
- retrieval section, hint, and index artifacts when post-apply retrieval runs

Review mode and dry-run mode still execute the authoring stages but stop before canonical promotion. Service tests in `tests/project/project-memory-curator-service.test.ts` verify create-then-maintenance publication, maintenance-only updates and source processing, and review-mode stopping before canonical wiki writes.

## Known Gaps

- The active service names still use "curator" language even though ADR 0067 changes the product boundary to agent-authored documentation.
- Legacy structured-curator validators, schemas, and quality diagnostics remain in the tree. They should not be treated as the current create-mode documentation contract unless a caller explicitly uses the legacy methods.
- The design spec allows a future fallback where create output might be promoted if follow-up maintenance fails for non-destructive candidate-specific reasons, but the current implementation blocks promotion whenever maintenance returns `failed`.
