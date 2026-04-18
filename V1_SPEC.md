# llm-wiki v1 Spec

## Goal

Define the v1 filesystem and execution contract for compiling durable, provenance-safe wiki memory for software repositories.

## Scope

- software repositories only (services, apps, libraries, SDKs, tools, games, infra)
- not in scope: journaling, non-code research vaults, book/trip/general PKM workflows
- cross-project non-repo concepts are allowed under `concepts/`

## In Scope

- centralized vault layout
- project scaffolding
- staged bootstrap
- raw and project-local ingestion
- page and state contracts
- freshness and provenance tracking
- structural + semantic validation
- reconciliation and post-ingest linting

## Out Of Scope

- embeddings
- vector search
- cloud sync
- multi-user workflows
- autonomous unrestricted rewriting

## Root Layout

```text
llm-wiki/
  raw/
    inbox/
    processed/
    rejected/
  projects/
    <project-key>/
      index.md
      changelog.md
      inbox/
      sources/
      wiki/
        architecture/
        systems/
        modules/
        integrations/
        decisions/
        runbooks/
        sessions/
        glossary/
        open-questions/
      state/
        bootstrap-state.json
        project.json
        pages.json
        sources.json
        relationships.json
        freshness.json
  concepts/
  agents/
    bootstrap/
      _shared/
      01-orient/
      02-domain-compiler/
      03-query-expander/
      04-validate/
      05-reconcile/
  templates/
  schemas/
  artifacts/
  README.md
  AGENTS.md
```

## Root Contracts

### `raw/inbox/`

- unclassified intake only
- nothing here is canonical knowledge
- each file must end in `processed`, `rejected`, or `pending-review`

### `raw/processed/`

- preserves originals for successfully classified sources

### `raw/rejected/`

- preserves rejected files plus rejection trace

### `projects/<project-key>/`

- exactly one `index.md`
- exactly one append-only `changelog.md`
- durable wiki content under `wiki/`
- preserved project sources under `sources/`
- machine state under `state/`

## Project State Contracts

### `state/project.json`

Operator-owned configuration; these fields are locked:

- `key`
- `name`
- `repo_paths`
- `tags`
- `entry_pages`
- `bootstrap_focuses`
- `related_concepts`
- `ignored_paths`

### `state/bootstrap-state.json`

Required fields:

- `project`
- `latest_run_dir`
- `last_completed_stage`
- `latest_validation_report`
- `latest_validation_findings`
- `latest_lint_findings`
- `latest_ingest_findings`
- `reconciliation_required`
- `stages`

### `state/pages.json`

Required per-page fields:

- `path`
- `type`
- `summary`
- `linked_sources`
- `linked_topics`
- `last_reviewed_at`
- `freshness_status`

### `state/sources.json`

Required per-source fields:

- `source_id`
- `original_path`
- `source_kind`
- `project_key`
- `status`
- `derived_pages`
- `ingested_at`
- optional `rejection_reason`

### `state/relationships.json`

Required per-relationship fields:

- `from`
- `to`
- `relationship_type`
- `confidence`

### `state/freshness.json`

Required fields:

- `last_seen_commit`
- `changed_paths`
- `impacted_pages`
- `status`
- `updated_at`

## Source Classification Contract

Every incoming source must emit:

- `source_kind`
- `ownership`
- `destination`
- `update_targets`
- `action`

Allowed `source_kind` values:

- `spec`
- `design`
- `plan`
- `implementation-note`
- `api-doc`
- `reference`
- `session-note`
- `decision-candidate`
- `troubleshooting`
- `unknown`

Allowed `ownership` values:

- `project:<project-key>`
- `concept:<concept-key>`
- `review-required`
- `reject`

Allowed `action` values:

- `update-existing-pages`
- `create-new-page-and-update-index`
- `log-only`
- `reject`
- `needs-review`

## Ingestion Contract

One source per ingest run.

### Proposal Pass (`make ingest`)

1. read and classify source
2. decompose into logical units
3. map each unit to `update` or `create` target pages
4. write artifacts under `artifacts/runs/<timestamp>-ingest-<target>/`:
- `classification.json`
- `units.json`
- `mapping.json`
- `proposal.json`
- `proposal.md`
5. do not mutate wiki/state/source files in proposal mode

### Apply Pass (`make ingest-apply`)

1. apply approved `proposal.json`
2. preserve the source under project `sources/` (or `raw/processed/` for global intake)
3. update page/source/relationship state with provenance links
4. append changelog entries for touched pages
5. run post-ingest lint
6. store lint result under `latest_ingest_findings`

### Approval Gate

- default requires explicit apply via `make ingest-apply PROJECT=<key> RUN=<artifacts/runs/...>`
- trusted fast path: `make ingest PROJECT=<key> AUTO=1` (`--auto` passthrough)
- auto mode must print a visible summary of touched/created/updated pages

## Bootstrap Contract

Bootstrap is a five-stage compiler pipeline.

### Stage 1: broad orientation

Must produce:

- `index.md`
- one architecture page under `wiki/architecture/` with repo-evidence filename
- initial state updates
- a durable session note

### Stage 2: knowledge compiler

Must create durable subsystem/module/integration/decision/runbook coverage from evidence.

Create a dedicated page when at least two are true:

- stable folder/module/domain exists
- multiple files/docs support it
- likely direct query target
- conceptually distinct from siblings
- without it another page becomes too broad

### Stage 3: query expander

Must split overloaded broad pages into direct lookup pages for stable concepts.

### Stage 4: validation

Two validators must run and both must pass:

- Structural validator (`scripts/validate.sh`)
- Semantic validator (`agents/bootstrap/04-validate`)

### Stage 5: reconciliation

Must fix stage-4 findings without restarting bootstrap from scratch.

## Structural Validation Contract

Structural validation fails on any of:

- unregistered `wiki/**/*.md` pages in `pages.json`
- `pages.json` entries pointing to missing files
- source entries with no preserved source file
- unresolved `derived_pages` references
- unresolved `index.md` links
- unresolved `relationships.json` endpoints
- page over 150 lines without `oversize_reason`
- missing bootstrap changelog coverage for latest bootstrap run
- unparseable required state JSON files

## Semantic Validation Contract

Semantic validator emits JSON findings at `<run-dir>/semantic-findings.json`.

Categories:

- `orphan_page`
- `dead_citation`
- `redundant_pages`
- `overloaded_page`
- `coverage_gap`
- `contradiction`
- `stale_claim`

Pass criterion: zero `blocker` findings.

Thresholds and severity overrides live in `agents/bootstrap/04-validate/config.json`.

## Standalone Lint

`make lint PROJECT=<key>` runs structural + semantic validation outside bootstrap and stores results under `latest_lint_findings`.

Lint is report-only; fixes are explicit follow-up work.
