# Source Evidence, Inbox, and Candidate Boundaries

Source evidence, inbox items, and candidates are Myelin's queueing boundary between raw observations and canonical Project Memory.

## Boundary Model

Myelin keeps source material separate from synthesized memory. The repository contract in `AGENTS.md` defines the active layers as `repo/`, preserved source evidence under `sources/`, curated `wiki/` pages, and generated `state/`. New source material should be classified, preserved, reconciled into the smallest canonical wiki surface, and left with terminal status instead of being silently discarded.

There are two inbox-shaped surfaces with different jobs:

- `projects/<key>/inbox/*.json` is the older gap/repair inbox documented by `docs/inbox-item-schema.md` and implemented by `src/inbox/items.ts`. It records low-confidence answers, stale or wrong answers, validation warnings, measurement failures, and manual notes as structured JSON for later classification.
- `sources/<key>/inbox/*.json` is the V2 runtime durable-memory proposal inbox implemented by `src/inbox/runtime-inbox-items.ts`. These files are preserved source material, not canonical memory, and are the source for deterministic Project Memory candidate intake.

Do not treat either inbox as a wiki write path. Inbox records are leads. The curator still has to verify evidence, decide disposition, and write bounded Project Memory changes through the apply pipeline.

## Source Classification

Every ingested source resolves the classification fields in `schema/rules/source-classification.json`: `source_kind`, `ownership`, `destination`, `update_targets`, and `action`. The allowed `source_kind` values include `spec`, `design`, `plan`, `implementation-note`, `api-doc`, `reference`, `session-note`, `decision-candidate`, `troubleshooting`, and `unknown`; actions are `update-existing-pages`, `create-new-page-and-update-index`, `log-only`, `reject`, and `needs-review`.

That rule is intentionally contextual. `destination` and `update_targets` are page paths or scopes, not fixed enums. The important invariant is that meaningful updates preserve provenance and choose the smallest reusable canonical surface.

## Gap and Repair Inbox

`docs/inbox-item-schema.md` defines the JSON contract for `projects/<key>/inbox/<id>.json`. Required fields include `id`, `schema_version`, `source`, `emitted_at`, `project_key`, `question`, and `target_hint`; all optional source-specific fields are still present with `null` when not applicable. `src/inbox/items.ts` enforces schema version `1`, filesystem-safe IDs, filename/id equality, and source values `mcp-auto`, `agent-enriched`, `agent-flagged`, `validate-auto`, `measure-auto`, and `manual`.

The low-confidence gap path uses `lowConfidenceThreshold = 0.66`. `emitLowConfidenceGap` writes an `mcp-auto` item only when confidence is below that threshold, while confident query results are side-effect free. `agent-flagged` is for confidently wrong or stale wiki answers found by source verification, `validate-auto` queues curated non-blocking semantic warnings, `measure-auto` records evaluation failures, and `manual` is operator-supplied.

`tests/inbox/inbox.test.ts` verifies the important contract details: IDs are timestamp-plus-hex filename stems, every schema key is written, target hints prefer read/cited pages for gap notes, and the auto-update lock prevents duplicate detached ingest loops. The lock and log helpers in `src/inbox/auto-update.ts` use `state/<key>/.update.lock` and `runs/<key>/logs/auto-update-<timestamp>.log`.

## Runtime Inbox Source Proposals

`src/inbox/runtime-inbox-items.ts` defines `RuntimeInboxItem` for intentional durable-memory proposals. The current schema requires `schema_version`, `id`, `project_key`, `created_at`, `creator`, `target_layer`, `target_scope`, `title`, `body`, `rationale`, `evidence_refs`, `target_hint`, `confidence`, `risk`, and `tags`.

The contract is layer-shaped (`project`, `practice`, `personal`) but the implemented slice only accepts `target_layer: "project"`. Unsupported Practice or Personal proposals return `unsupported_layer` instead of creating dead queues. `docs/adr/0061-use-layer-shaped-runtime-inbox-with-implemented-consumers.md` records that decision: keep the shared durable-memory shape, but enable each layer only when it has a real consumer.

Creation is deliberately conservative:

- `createRuntimeInboxItem` first rejects unsupported layers, invalid fields, unknown projects, and duplicate IDs before unsafe writes.
- Valid items are written as immutable pretty JSON under `sources/<key>/inbox/<id>.json`.
- `sources/<key>/index.md` and `sources/<key>/inbox/index.md` are created lazily as source indexes.
- The returned source reference is `inbox:<id>`.
- Creation does not create `memory_candidates`; operators run `myelin memory inbox intake <project-key>` or let `myelin project learn <project-key>` perform intake before packet construction.

`tests/inbox/runtime-inbox-items.test.ts` covers source preservation, duplicate-write protection, unsupported-layer rejection, invalid metadata rejection, and unknown-project blocking.

## Candidates Are Leads

Project runtime inbox intake is deterministic and provider-free. `ProjectMemoryCandidateIntakeService` in `src/project/project-memory-candidate-intake-service.ts` reads sorted JSON files from `sources/<key>/inbox`, validates each runtime inbox item, and normalizes valid project-scoped items into root SQLite `memory_candidates` rows.

For each valid runtime inbox source, the service creates exactly one candidate:

- `id`: `project_inbox:<project-key>:<runtime-inbox-id>`
- `scope`: `project`
- `candidate_type`: `project.inbox`
- `status`: `needs_review`
- `source_event_refs`: `["inbox:<runtime-inbox-id>"]`
- `evidence`: source ref, evidence refs, target hint, creation time, and creator
- `proposed_payload`: body, rationale, confidence, risk, tags, target hint, and source metadata

Intake is idempotent. Existing `pending` or `needs_review` candidates are reported as existing, terminal `processed` or `rejected` candidates are reported as terminal duplicates, and malformed or unsupported source files degrade intake without blocking valid files or rewriting preserved source material. Unknown projects are blocking.

`src/memory/candidates.ts` owns candidate lifecycle primitives. Candidate statuses normalize hyphenated aliases into `pending`, `needs_review`, `processed`, and `rejected`. Listing and showing candidates is exposed through `MemoryCandidateService` in `src/memory/memory-candidate-service.ts` and documented in `docs/CLI.md` as `myelin memory candidates` and `myelin memory candidate show`.

Candidates are not trusted memory. `src/project/project-memory-packet.ts` includes pending and needs-review project candidates in curator packet input, and `src/project/project-memory-producer-boundary.ts` marks runtime-inbox-derived leads by recognizing `project_inbox:` and `inbox:` refs. High-confidence project candidates and handoffs receive high priority unless risk is high, but priority only affects ordering; it is not acceptance.

Ingest-provider candidates carry evidence-bearing leads: `src/ingest/worker.ts` accepts only candidates with at least one `evidence.observed_facts` entry and at least one `proposed_payload.durable_facts` entry. It also requires array-valued `relevant_paths`, `uncertainties`, `suggested_subjects`, and `verification_needed`, which may be empty. Those requirements are enforced while parsing provider output, not retroactively by Project Memory maintenance: old candidates, runtime-inbox candidates, and handoffs may have empty stored structures. Their metadata routes review but does not prove the claim; maintenance verifies the current repository, tests, and existing canonical pages before accepting, declining, or deferring the lead.

## Project Learn Flow

`docs/CLI.md` states that `myelin project learn <project-key>` runs deterministic runtime inbox intake before packet construction. The roadmap records the same implemented behavior: source-consumption reconciliation runs first, then runtime inbox intake, then packet construction. This matters because already-consumed leads should not keep reappearing, and newly preserved runtime inbox proposals should become candidate leads before the curator packet is built.

The active command split is:

- `myelin memory inbox create ...` writes immutable runtime source JSON and lazy source indexes.
- `myelin memory inbox intake <project-key>` creates or reuses `needs_review` `project.inbox` candidates without invoking a provider or curator.
- `myelin project learn <project-key>` runs intake as part of Project Memory curation and may then write canonical wiki/state through the validated apply path.
- There is no active `myelin project ingest <project-key>` command; top-level `myelin ingest <project-key>` is the Experience Log to Session Memory pipeline.

## Source Consumption Reconciliation

Curator output must account for candidate and handoff leads it consumes. `ProjectMemorySourceConsumptionRecord` in `src/project/project-memory-apply-contracts.ts` stores `source_kind` (`project_candidate` or `project_handoff`), `source_ref`, `project_key`, `consumed_by_run`, `consumed_at`, `terminal_decision`, and `output_refs`.

The markdown applier writes these records to `state/<key>/project-memory-source-consumptions.json`. Maintenance reports use the same shape through `sourceConsumptionsFromMaintenanceReport` in `src/project/project-memory-agent-maintenance-service.ts`, and the applier appends new records to any existing state instead of replacing the whole list.

`ProjectMemorySourceConsumptionReconciler` in `src/project/project-memory-source-consumption-reconciler.ts` reads that state and retires queue rows in root SQLite without making the apply layer mutate candidate or handoff tables directly. It validates schema version `1`, matching `project_key`, and supported records, deduplicates by `source_kind:source_ref`, and skips reconciliation when `state/memory/memory.db` is missing.

Only terminal decisions retire leads:

- `applied_to_project_memory`
- `already_covered`
- `not_durable`
- `belongs_to_other_layer`
- `insufficient_evidence`

The disposition enum also includes `deferred_unsafe_change` and `blocked_by_runner_failure`, but the reconciler does not process those as terminal consumption decisions. That preserves unresolved work for future runs. `tests/project/project-memory-source-consumption-reconciler.test.ts` verifies processing of consumed candidates and handoffs, legacy `already_trusted` normalization to `already_covered`, missing-ref reporting, absent-state no-op behavior, and fail-closed behavior for malformed state.

## Provenance and Repair Rules

The practical rule is: preserve source first, synthesize second, reconcile last.

Runtime inbox items keep explicit `evidence_refs`, creator, rationale, confidence, risk, and target hints. Gap inbox items keep question text, read pages, model metadata, validation notes, measurement metadata, and operator notes. Curator proposals must carry provenance or explicit inference labels before markdown apply can make canonical changes; the roadmap's apply acceptance evidence says malformed, unsupported, out-of-scope, too-broad, or provenance-free output stops before touching markdown.

For stale or gap repair, prefer the narrowest durable update:

1. Preserve the original source or gap note.
2. Classify it with the source-classification rule.
3. Route runtime source proposals through candidate intake, or handle gap inbox items as repair inputs.
4. Let Project Memory curation verify evidence and update existing canonical pages where possible.
5. Record source-consumption state for accepted or terminally resolved candidates/handoffs.
6. Reconcile processed leads so future packets do not keep re-feeding completed work.

## Current Gaps and Cautions

The source-classification rule is present as schema JSON, but classification of arbitrary preserved source material remains a contextual workflow rather than a single centralized TypeScript service in the files reviewed here.

The legacy gap inbox and the V2 runtime source inbox are both active concepts. Future agents should name the path they mean (`projects/<key>/inbox` versus `sources/<key>/inbox`) and avoid using "inbox" as a generic synonym for candidates.

Practice and Personal runtime inbox layers are intentionally not accepted in this slice. Enabling them should add real consumers to the existing runtime inbox boundary rather than creating a parallel proposal path.
