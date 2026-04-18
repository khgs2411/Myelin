# llm-wiki v1 Spec

## Goal

Define the v1 filesystem, workflow, and validation contract for a local-first project wiki system.

## In Scope

- centralized vault layout
- project scaffolding
- staged bootstrap
- raw and project-local ingestion
- page and state contracts
- freshness and provenance tracking
- validation and reconciliation

## Out Of Scope

- embeddings
- vector search
- cloud sync
- multi-user workflows
- editor lock-in
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

- holds unclassified input only
- nothing here is canonical knowledge
- each file must end in `processed`, `rejected`, or `pending-review`

### `raw/processed/`

- preserves original files that were successfully classified
- originals are not rewritten in place

### `raw/rejected/`

- preserves rejected files plus rejection trace

### `projects/<project-key>/`

- exactly one `index.md`
- exactly one append-only `changelog.md`
- wiki content under `wiki/`
- preserved project sources under `sources/`
- machine state under `state/`

## Project State Contracts

### `state/project.json`

Operator-owned configuration.

Must not be freely rewritten by model passes.

Locked fields:

- `key`
- `name`
- `repo_paths`
- `tags`
- `entry_pages`
- `bootstrap_focuses`
- `related_concepts`
- `ignored_paths`

### `state/bootstrap-state.json`

Tracks bootstrap orchestration state.

Required fields:

- `project`
- `latest_run_dir`
- `last_completed_stage`
- `latest_validation_report`
- `latest_validation_findings`
- `reconciliation_required`
- `stages`

### `state/pages.json`

Tracks maintained pages.

Required shape per page entry:

- `path`
- `type`
- `summary`
- `linked_sources`
- `linked_topics`
- `last_reviewed_at`
- `freshness_status`

### `state/sources.json`

Tracks raw and repo-derived sources.

Required shape per source entry:

- `source_id`
- `original_path`
- `source_kind`
- `project_key`
- `status`
- `derived_pages`
- `ingested_at`
- optional `rejection_reason`

### `state/relationships.json`

Tracks cross-page and page-to-source relationships.

Required shape per relationship entry:

- `from`
- `to`
- `relationship_type`
- `confidence`

### `state/freshness.json`

Tracks repo alignment and stale risk.

Required fields:

- `last_seen_commit`
- `changed_paths`
- `impacted_pages`
- `status`
- `updated_at`

## Page Contracts

### `index.md`

Primary human and agent landing page.

Required sections:

- project summary
- start here
- current priorities
- architecture
- systems and modules
- integrations
- decisions
- runbooks
- known risky or stale areas
- recent sessions

Priority rule:

- `Current Priorities` must come from source materials
- if no real priorities are documented, write exactly:
  - `No verified project priorities are documented in source materials yet.`

### `changelog.md`

Append-only chronology of meaningful events.

Allowed entry types:

- bootstrap
- ingest
- sync
- lint
- session
- query artifact

### `wiki/sessions/*`

Durable session memory.

Each session note must include:

- task summary
- key findings
- pages updated
- source inputs used
- unresolved follow-ups

## Source Classification Contract

Every incoming source must be classified before integration.

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

Classification must determine:

- source type
- ownership
- destination
- update targets
- action

## Ingestion Contracts

### Global intake

For files in `raw/inbox/`:

1. read
2. classify
3. assign ownership or review state
4. preserve original
5. update wiki
6. update state
7. append changelog
8. move to terminal inbox state

### Project-local intake

For files in `projects/<project-key>/inbox/`:

1. assume project ownership unless contradicted
2. classify
3. preserve under `sources/`
4. update wiki
5. update state
6. append changelog
7. clear inbox state

## Bootstrap Contract

Bootstrap is a staged compiler pipeline.

Stage packaging rule:

- every bootstrap stage lives in its own folder under `agents/bootstrap/`
- each stage folder owns `instructions.md`, `agent.json`, and `run.sh`
- shared bootstrap mechanics live under `agents/bootstrap/_shared/`

### Stage 1: broad orientation

Must produce:

- `index.md`
- a top-level architecture page whose filename is chosen from repo evidence and placed under `wiki/architecture/`
- initial state updates
- a durable bootstrap session note

### Stage 2: knowledge compiler

Must expand broad orientation into durable subsystem, feature, runtime, tech-stack, and decision-candidate pages when justified by source evidence.

Create a dedicated page when at least two are true:

- stable folder, module, or domain exists
- multiple files or docs support it
- likely direct query target
- conceptually distinct from siblings
- without it another page becomes too broad

### Stage 3: query expander

Must expand major-domain pages into direct lookup pages for stable, high-value concepts that future agents are likely to ask about.

Examples of the kind of query-target expansion this stage is meant to produce:

- subsystem internals
- registries
- schedulers
- feature-specific runtime paths
- attribute or affix surfaces
- explicit operating flows that are still buried inside broader pages

### Stage 4: validation

Must reject:

- broad-only output on repos that clearly support deeper durable coverage
- domain-only output on repos that clearly support a query-target layer
- fake priorities

### Stage 5: reconciliation

Must:

- fix validation findings
- avoid restarting bootstrap from scratch
- converge the wiki into a validated state

## Validation Success Condition

Bootstrap succeeds only when:

- validation passes
- the landing page is usable
- the project has both orientation pages and a real deep-dive layer
- likely project questions can be answered from dedicated wiki pages instead of broad repo rereads
