# AGENTS.md

## Purpose

This file is the execution contract for agents operating inside `llm-wiki`.

The goal is to make agent behavior predictable, reusable, and safe enough that project knowledge improves over time instead of drifting.

If any instruction here conflicts with ad hoc conversation phrasing, prefer this file unless the user explicitly overrides it for the current task.

## Developer Quick Start

```bash
# Scaffold a new project
make init PROJECT=<key> NAME="<Display>" PATH=/abs/path/to/repo

# Full recompile of the project brain (sense -> impact -> propose -> apply -> validate -> [reconcile] -> acceptance -> commit)
make compile PROJECT=<key> AUTO=1

# Incremental inbox drain (08-ingest -> apply -> validate -> [reconcile] -> terminal-state -> commit)
make update PROJECT=<key> AUTO=1

# Re-run validate against the latest run without re-running earlier stages
make lint PROJECT=<key>

# Score the wiki against acceptance-questions.md (second-brain quality signal)
make measure PROJECT=<key>

# Resume after a gated approval
make compile-continue PROJECT=<key>
make update-continue PROJECT=<key>

# Tests (pre-existing failures: test_plan_{a,b}_acceptance, test_state_migration
# depend on a projects/sample/ fixture not present in every working tree)
.venv/bin/pytest tests/ -q
```

### Environment variables

| Var | Effect |
|-----|--------|
| `MODEL=codex` / `codex/<id>` / `claude` / `claude/<id>` | LLM backend + model selector (default: codex) |
| `AUTO=1` | Propose writes `approved=true`, destructive units defer to `pending-approvals/` |
| `CONTINUE=1` | Resume from latest run's `proposal.json` (used by `make compile-continue` and `make update-continue`) |
| `NO_EMIT=1` | suppress gap-note emission in `make measure` |
| `LLM_STUB_RESPONSES_DIR=<path>` | Use canned responses instead of live LLM (stub tests) |
| `LLM_WIKI_AUTO_UPDATE=1` | auto-run `make update` after `enrich_gap` MCP calls (detached background subprocess) |
| `UPDATE_PROJECTS_ROOT` / `UPDATE_ARTIFACTS_ROOT` / `UPDATE_STAGES_ROOT` | Override roots (tests) |
| `RANKING_CUTOFF=<n>` | Override ranking snapshot cutoff |
| `CODEX_BIN` / `CLAUDE_BIN` | Override CLI binary path |

## Repo Layout

- `agents/update/<stage>/` - each pipeline stage as `{config.json, instructions.md, run.sh}`. Stages: `01-sense`, `02-impact`, `03-propose`, `04-apply`, `05-acceptance`, `06-validate`, `07-reconcile`, `08-ingest`, `measure`.
- `agents/update/_shared/` - `llm_client.py` (codex/claude wrapper), `state.py`, `config.py`.
- `scripts/` - orchestration (`compile.sh`, `update.sh`, `measure.sh`, `apply_commit.sh`, `init_project.sh`, `validate_stage_configs.py`, `stable_products.py`).
- `projects/<project-key>/` - per-project knowledge: `index.md`, `wiki/{architecture,systems,modules,integrations,decisions,runbooks,sessions,glossary,open-questions}/`, `state/{project.json,pages.json,freshness.json,sources.json,relationships.json,update-state.json,latest/}`, `inbox/`, `acceptance-questions.md`, `changelog.md`.
- `artifacts/<project-key>/runs/<ts>-update/` - per-run pipeline output: `sense-report.json`, `ranking-snapshot.json`, `impact-report.json`, `proposal.{json,md}`, `validation-findings.json`, `reconcile-proposal.json`.
- `raw/` - global unclassified intake (`inbox/`, `processed/`, `rejected/`).
- `concepts/` - cross-project knowledge pages.
- `tests/` - pytest suite; run via `.venv/bin/pytest`.

## Pipeline Development Gotchas

When touching stage code or LLM-stage instructions, these pitfalls have each burned the pipeline at least once:

- **Codex must run with `--sandbox read-only`.** `agents/update/_shared/llm_client.py` sets this. Without it, codex helpfully writes the expected JSON artifact to disk and returns a markdown status message that the JSON parser can't decode. Symptom: `json.decoder.JSONDecodeError: Expecting value: line 1 column 1` with stdout starting `"Wrote [foo.json](/abs/path)"`.
- **LLM-stage instructions must say "Return ONLY this JSON object on stdout" - never "Write `<run-dir>/foo.json`".** Even with sandbox lockdown, "Write" phrasing shifts the model into describe-what-I-wrote mode. All LLM stages (`02-impact`, `03-propose`, `05-acceptance`, `06-validate` semantic sub-task, `07-reconcile`) follow this rule. `llm_client._recover_from_referenced_file` is a defense-in-depth fallback only.
- **`04-apply/run.sh` must refresh `pages.json` when `index.md` is rewritten**, not only when additive wiki units are applied. Skipping this causes metadata drift that corrupts `02-impact`'s stale-reasoning on the next run.
- **Validator rules live in `agents/update/06-validate/structural.py`**, are registered in `06-validate/config.json::stage_specific.structural_rules`, AND must be wired into `06-validate/run.sh`'s finding loop. Missing any one of the three = silent skip.
- **`INGEST_MODE=1` relaxes only `ranked_domain_coverage` and `domain_collapse_check`.** `make update` sets this for `06-validate`; all other structural and semantic rules still run. If an ingest run unexpectedly passes or fails, check whether those two compile-only rules were intentionally skipped.
- **RTK hook only rewrites Bash tool calls.** `Read`, `Grep`, `Glob` bypass RTK. For token-heavy file reads or greps, shell out (`rtk read`, `rtk grep`, `rtk find`) or use the Bash tool.
- **Auto-update lockfiles can strand on hard kills.** `enrich_gap` auto-update uses `projects/<key>/state/.update.lock`; the wrapper clears it on normal exit, but `SIGKILL` leaves it behind and the operator must remove it manually. Detached update logs live under `projects/<key>/logs/auto-update-<timestamp>.log`.
- **`projects/sample/` fixture is not always present.** `test_plan_{a,b}_acceptance.py` and `test_state_migration.py::test_sample_project_registered` will fail without it - these are pre-existing, not regressions.

## System Model

Scope: software repositories only. Do not attempt to ingest non-repo content dropped into the inbox — classify as `unknown` and route to `needs-review`.

Treat `llm-wiki` as four layers:

- `repo/`: implementation truth
- `raw/`: incoming source material and preserved originals
- `wiki/`: compiled markdown understanding
- `state/`: machine-readable metadata, routing, provenance, and freshness

Default read priority:

1. `state/`
2. `index.md`
3. `changelog.md`
4. relevant `wiki/` pages
5. preserved raw sources
6. repo files

Do not start with a broad repo scan if the wiki already contains enough context to orient the task.

## Non-Negotiable Rules

Always do these:

- preserve provenance for every meaningful update
- prefer updating canonical pages over creating new pages
- keep source material separate from synthesized knowledge
- mark uncertainty when knowledge is incomplete or stale
- leave behind reusable session memory after meaningful work

Never do these:

- treat conversation history as canonical project knowledge
- silently discard inbox items
- rewrite or delete preserved source files during ingestion
- present stale wiki content as verified fact
- create speculative architecture claims without a source or explicit inference label
- create new durable pages when an existing canonical page should be updated instead

## Canonical Session Startup

When starting work in or about a repo, follow this order exactly:

1. Resolve the project from the current working path.
2. Read `projects/<project-key>/state/project.json`.
3. Read `projects/<project-key>/index.md`.
4. Read recent entries from `projects/<project-key>/changelog.md`.
5. Read freshness metadata from `projects/<project-key>/state/freshness.json`.
6. Read the smallest relevant set of wiki pages for the task.
7. Read raw sources only if the wiki is missing, stale, ambiguous, or clearly insufficient.
8. Read repo files only where verification or implementation requires it.

Do not skip directly to repo exploration unless:

- the project is not registered
- the wiki is missing
- freshness metadata indicates likely invalidation
- the task is implementation-specific and requires direct code verification

## Pipeline Operations

`make compile PROJECT=<project-key>` is the canonical compiler pipeline for project knowledge.

The stages are:

1. sense
2. impact
3. propose
4. apply
5. validate
6. reconcile when validate fails
7. acceptance (auto-generates `acceptance-questions.md` by dogfooding the fresh wiki if the file is still at the scaffold default; operator edits are sticky)
8. apply commit only after validate passes

Treat validate as the gate. A run is not complete until validation passes and the commit pointer advances.

Validate's structural layer enforces `index_not_wiki_meta` (blocks wiki-meta narration on `index.md`), `ranked_domain_coverage` (every ranked domain needs a dedicated page or a deferred-with-reason entry), and `domain_collapse_check` (blocker when 3+ ranked domains collapse into one destination page). See `agents/update/06-validate/structural.py` for the full rule set.

Reconcile is bounded to one loop iteration. If validate still fails after reconcile, stop and surface the findings instead of improvising further changes.

`make update PROJECT=<project-key>` is the incremental ingest pipeline for queued gap-notes.

The stages are:

1. ingest (`08-ingest`)
2. apply
3. validate with `INGEST_MODE=1`
4. reconcile when validate fails
5. self-correct when validate passes with residual semantic warnings
6. terminal-state handling (`processed/` or `needs-review/`)
7. apply commit only after validate passes

`make update` is demand-driven and cheaper than `make compile`: it batches inbox items by `target_hint`, patches existing pages when possible, deliberately relaxes only `ranked_domain_coverage` and `domain_collapse_check`, and gets one bounded repo-grounded self-correction pass before falling back to manual review.

## Operator-Owned Project Config

Treat `projects/<project-key>/state/project.json` as operator-owned configuration.

Do not freely rewrite:

- `key`
- `name`
- `repo_paths`
- `tags`
- `entry_pages`
- `related_concepts`
- `ignored_paths`

Model-generated findings belong in other state files, wiki pages, and session summaries.

## Project Resolution Rules

Every task must resolve into one of these outcomes:

- known project
- cross-project concept
- unclassified and requires review

If a current working directory matches a registered repo path, treat that project as active by default.

If a source clearly applies across multiple projects and not mainly to one codebase, route it to `concepts/` and link relevant projects later.

If ownership is ambiguous and materially affects destination, do not guess silently. Mark for review or ask for confirmation.

## Inbox Handling Rules

There are two inbox types:

- global inbox: `raw/inbox/`
- project-local inbox: `projects/<project-key>/inbox/`

Rules for global inbox:

- files are unowned until classified
- do not treat any file in this folder as canonical knowledge
- preserve original source files
- every file must end in exactly one of: processed, rejected, or pending-review

Rules for project-local inbox:

- assume project ownership unless evidence contradicts it
- still classify source type before integration
- preserve the original source under the project after processing
- consumed items end in a terminal state under `projects/<project-key>/inbox/processed/` or `projects/<project-key>/inbox/needs-review/`
- `needs-review` items carry a sibling `<id>.reason.md` file explaining why ingest could not close them

For the raw intake area specifically:

- treat `raw/inbox/` as unclassified intake only
- move each processed file to a terminal state under `raw/processed/`, `raw/rejected/`, or an explicit pending-review location

Inbox item producers:

- `mcp-auto`: `query_wiki` emits a gap-note automatically when confidence is below `0.66`
- `agent-enriched`: `enrich_gap` appends operator or agent notes to an existing low-confidence MCP gap-note
- `agent-flagged`: an agent calls `flag_stale_answer` after reading a confidently-wrong `query_wiki` response; the correction is written directly into `enriched_notes` and a new gap-note is created rather than appended to an existing one
- `validate-auto`: validate emits curated non-blocking semantic warnings (`redundancy`, `stale`, `contradiction`) as pending maintenance items when the finding includes a usable `suggested_action`; these queue work for a later manual `make update`, they do not trigger another update pass automatically, and update-run validate calls suppress this emission until the bounded self-correction pass is exhausted
- `measure-auto`: `make measure` emits gap-notes for any question that scores below full marks unless `NO_EMIT=1`
- `manual`: operators may write the same schema by hand when they want to seed future ingest work

### Auto-Update On Enrich

When `enrich_gap` runs with `auto_update=True`, or with `LLM_WIKI_AUTO_UPDATE=1` and no per-call override, the MCP server spawns a detached `make update PROJECT=<key> AUTO=1` subprocess immediately after the enriched gap-note is written. The MCP call returns without waiting, so the next session can benefit once the pipeline drains the inbox.

Only one auto-update runs per project at a time. The MCP side acquires `projects/<project-key>/state/.update.lock` atomically before spawning; if the lock already exists, the tool returns `auto_update_status: "skipped:already-running"` and leaves the enriched item in the inbox for the next run. Logs for detached runs live under `projects/<project-key>/logs/auto-update-<iso-timestamp-z>.log`.

The uniform JSON contract and filename convention live in [docs/inbox-item-schema.md](/Users/liadgoren/Repositories/llm-wiki/docs/inbox-item-schema.md).

Measure note:

- `NO_EMIT=1 make measure PROJECT=<key>` suppresses gap-note emission entirely

## Inbox Item Contract

Inbox files under `projects/<project-key>/inbox/` use the schema in `docs/inbox-item-schema.md`.

Required fields:

- `id`
- `schema_version`
- `source`
- `emitted_at`
- `project_key`
- `question`
- `target_hint`

Allowed `source` values:

- `mcp-auto`
- `agent-enriched`
- `agent-flagged`
- `validate-auto`
- `measure-auto`
- `manual`

Filename convention:

- `<iso-timestamp-z>_<6-char-random-hex>.json`
- the timestamp is UTC with `:` replaced by `-`
- the `id` field must equal the filename stem

Schema rule:

- all top-level keys are always present
- fields that do not apply to a given source are written as `null`, never omitted

## Mandatory Source Classification Output

Before integrating any new source, produce these decisions:

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

Do not process a source without making these decisions explicit in metadata or the changeset.

## Destination Rules By Source Type

Use these defaults unless the content strongly suggests a better destination.

- `spec` -> update `wiki/architecture/`, `wiki/systems/`, or `wiki/modules/`
- `design` -> update `wiki/architecture/`, `wiki/integrations/`, or create a focused design page if durable
- `plan` -> update `index.md`, `wiki/open-questions/`, or `wiki/sessions/` unless it deserves a durable roadmap page later
- `implementation-note` -> update `wiki/modules/`, `wiki/systems/`, or `wiki/runbooks/`
- `api-doc` -> update `wiki/integrations/` or `concepts/`
- `reference` -> preserve source and link it from existing pages; create a new page only if the reference is strategically important
- `session-note` -> summarize into `wiki/sessions/`
- `decision-candidate` -> update `wiki/decisions/` only after confirming the decision is real and durable
- `troubleshooting` -> update `wiki/runbooks/`
- `unknown` -> do not create durable wiki pages until classification improves

## Page Creation Policy

Prefer updating existing pages.

Create a new page only if all of the following are true:

- the content is durable beyond the current session
- there is no obvious canonical page to update
- the new page has a clear stable purpose
- the page can be linked from `index.md` or another canonical page

Do not create pages for:

- one-off thoughts
- temporary implementation noise
- redundant summaries of existing pages
- ambiguous concepts with no clear long-term value

If a new page is created, also do all of the following:

- add it to `index.md`
- add backlinks or related links where relevant
- register it in `state/pages.json`
- link the source in `state/sources.json` or equivalent metadata

## Source Processing Contract

`make compile` and `make update` own project-local source processing. When a source is consumed from either inbox:

1. read and classify the source
2. decide ownership and destination
3. preserve the original source
4. update existing canonical pages or create a new page only when policy allows it
5. update `state/` metadata
6. append a `changelog.md` entry
7. leave a terminal source status (`processed`, `rejected`, or `needs-review`)

Do not leave partially processed sources with no status trail.

## Wiki Writing Rules

When updating wiki content:

- separate sourced facts from inferred synthesis
- keep summaries compact and reusable
- prefer concrete statements over vague prose
- preserve important contradictions instead of smoothing them away
- update the smallest number of pages that yields a coherent result

Ground claims primarily through concrete `file_path:line_number` citations. Do not use `Verified:`, `Inferred:`, or `Stale risk:` as structural section decorators or default sentence prefixes. Reserve those labels for the narrow case where a specific sentence is genuinely about source ambiguity, and keep them inline.

If a new source contradicts existing content:

- update the affected page
- note that the old understanding was revised
- preserve provenance for both the old and new basis when useful

## Writing Style For Wiki Pages

These constraints apply to every page under `projects/<project-key>/wiki/`. Violating them produces meta-narration and provenance-block pollution that makes pages harder to read.

- Do not include a `## Review Provenance` block or any HTML comment markers of that shape.
- Do not include a `## Status` section that narrates the wiki's own construction. Banned phrases include "broad bootstrap," "focused follow-up pass," "baseline established," and "baseline pass."
- Do not describe the llm-wiki system, the ingestion process, the agent's own work, or the project's relationship to llm-wiki. Write as if the reader has never heard of this wiki.
- Do not use `Verified:`, `Inferred:`, or `Stale risk:` as structural section decorators or default sentence prefixes. Use them only inline, and only where a specific sentence is genuinely about source ambiguity. Default to grounding claims with concrete `file_path:line_number` citations.
- Do not add YAML frontmatter to wiki page bodies. Provenance and freshness metadata belong in `state/` JSON files only.
- Do not add sentences whose sole content is meta-description (e.g., "This page holds the maintained knowledge layer for X"). Describe the subject directly.
- Target around 60 lines per page; up to roughly 80 lines is acceptable when the material demands it. Do not split pages purely to hit a line count — coherence and DRY win.
- Open with a single-sentence intro that answers "what is this." Do not lead with a `## Purpose` heading. A later heading such as `## Purpose And Boundary` is allowed when it adds real subject structure.
- Include "Open Questions" or "Related" sections only when real items exist.
- `index.md` carve-out: the project's `index.md` MAY include a `## Status` block as the final section. This block points at machine-readable state files, includes the last update timestamp plus the source commit SHA, and is not wiki-construction narration. See `docs/superpowers/specs/2026-04-18-unified-update-pipeline-design.md` §5.2.

## Freshness Contract

When repo changes are detected:

1. inspect the change scope
2. map changed paths to known pages or systems
3. mark impacted pages as stale if confidence is not high enough to auto-reconcile
4. do not present stale pages as current fact without verification
5. propose updates after reviewing the relevant area

Use stale markers when:

- a changed path maps directly to a canonical page
- a subsystem changed and related summaries are likely outdated
- a runbook depends on commands or files that changed

Do not clear stale status until the affected area has been re-reviewed.

## Session Memory Contract

At the end of meaningful work, create or update a session summary under `wiki/sessions/`.

A meaningful session is one that did at least one of:

- changed understanding of the system
- ingested a new source
- updated canonical wiki pages
- identified a fresh risk or unresolved question

Every session summary must include:

- task summary
- key findings
- pages updated
- source inputs used
- unresolved follow-ups

Also append a matching entry to `changelog.md`.

## Logging Contract

Every ingest, sync, or meaningful session update must create a changelog entry.

Each changelog entry should record:

- date
- operation type
- project or concept target
- source identifiers when relevant
- pages updated
- short outcome summary

Do not perform durable wiki maintenance without leaving a changelog trail.

## Escalation Rules

Proceed without confirmation for:

- reads and searches
- source classification
- preserving original source files
- updating metadata
- marking stale areas
- drafting changesets
- appending routine session summaries

Ask for confirmation before:

- high-impact multi-page rewrites
- changing or superseding decision records
- assigning an ambiguous source to a project when misclassification would matter
- rejecting a source that may contain useful material
- deleting any previously preserved source
- reorganizing canonical page structure

When in doubt, prefer `needs-review` over silent invention.

## Quality Gate Before Writing

Before making a durable wiki change, check:

1. Does this reduce future repeated reading?
2. Is the destination page clearly the best home?
3. Is the content durable enough for the wiki?
4. Is the source traceable later?
5. Does the update improve the project's maintained understanding?

If at least three answers are not clearly yes, do not create a new durable page.

## Success Condition

A good agent run leaves the project easier to understand in the next session than it was before this session started.
