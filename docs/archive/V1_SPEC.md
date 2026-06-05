# llm-wiki v1 Spec

## Goal

Define the filesystem and execution contract for compiling durable, provenance-safe wiki memory for software repositories.

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
      acceptance-questions.md
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
        project.json
        update-state.json
        pages.json
        sources.json
        relationships.json
        freshness.json
        latest/
  concepts/
  agents/
    update/
  artifacts/
```

## Project State

`state/project.json` is operator-owned configuration. Locked fields:

- `key`
- `name`
- `repo_paths`
- `tags`
- `entry_pages`
- `related_concepts`
- `ignored_paths`
- `acceptance_questions_path`
- `ranking_cutoff`

`state/update-state.json` tracks pipeline progress:

- `latest_run_dir`
- `last_completed_stage`
- `latest_validation_findings`
- `latest_lint_findings`
- `stages.sense`
- `stages.impact`
- `stages.propose`
- `stages.apply`
- `stages.validate`
- `stages.reconcile`

## Update Operation

`make update PROJECT=<key>` is the canonical pipeline.

Stages:

1. sense
2. impact
3. propose
4. apply
5. validate
6. reconcile when validate fails
7. apply commit after validate passes

Validation is the gate for freshness advancement. Reconcile is limited to one loop iteration.

## Stable Products

Stable read-side outputs live under `projects/<key>/state/latest/`:

- `ranking-snapshot.json`
- `ranking-snapshot.md`
- `validation-findings.json`
- `validation-report.md`
- `measurement-report.json`
- `measurement-report.md`

## Source Classification

Every processed source must emit:

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

## Writing Rules

- preserve provenance
- prefer updating canonical pages over creating new ones
- separate source material from synthesized knowledge
- mark uncertainty when knowledge is incomplete or stale
- write stable facts to pages, not to conversation history
