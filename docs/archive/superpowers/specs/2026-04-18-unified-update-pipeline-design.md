# Unified Update Pipeline — Design Spec

**Date:** 2026-04-18
**Status:** Ready for development (revision 4, audit passed)
**Supersedes:** `2026-04-17-bootstrap-ingest-redesign-design.md`

---

## 1. Purpose

Replace the current split bootstrap/ingest pipelines with a single unified `make update` operation whose one job is to maintain a token-efficient routing layer for future LLM coding sessions.

The wiki is not a human-readable encyclopedia. It is a compiled navigation layer: start at `index.md`, follow ≤2 hops to a domain page, land on `file_path:line-line` pointers, begin work with narrow scope. Every design decision downstream is judged against this goal.

## 2. Goals and Non-Goals

### Goals

- Collapse Layer 1 (bootstrap) and Layer 2 (ingest) into one symmetric operation. First run is the empty-state case; subsequent runs are incremental.
- Target: ≥30% token reduction in a future LLM coding session's bootstrap phase for the same task, vs. no-wiki baseline.
- Agentic workflow with a framework: LLM agents have freedom to explore and create within sharp contracts, not rigid scripts.
- Preserve provenance: every page claim grounds in a `file_path:line_number` citation or is explicitly marked as inferred.
- Preserve source classification provenance from the prior ingest design (source_kind, ownership, destination, update_targets, action) — this metadata is retained, relocated to a new home; not dropped.
- Honest coverage: wiki acknowledges gaps, stale areas, and uncertainty rather than inventing confident prose.

### Non-Goals

- Layer 3 (query operations, MCP surface, agent-facing retrieval tools) is deferred.
- Cross-project consistency or shared concepts library is deferred.
- Automatic LLM host integration for live token measurement is deferred; v1 uses proxy metrics and a concretely-defined harness described in Section 9.
- Support for non-software-repo projects. Scope remains software repositories only.

## 3. Background

The prior redesign (`2026-04-17-bootstrap-ingest-redesign-design.md`) separated bootstrap and ingest cleanly, stripped domain vocabulary from contracts, added semantic validation, and landed a functional proposal → approval → apply flow for ingest. It shipped successfully.

Three latent problems surfaced when the `rpg_game` project was rebootstrapped under that contract:

1. **Inverted flow.** The pipeline auto-discovers "what matters" via heuristics, with no anchor on what a future LLM session actually needs. Each rebootstrap produced a differently-incomplete wiki — MVP loop pages in one run, backend domain pages in another, never both.
2. **Layer 1 ≠ Layer 2 in code, despite being the same operation conceptually.** Two separate entry points, two stage lineups, two sets of scripts. Divergence is built in.
3. **Coverage validation absent.** Structural validation passes with glaring domain gaps (no auth page, no ATB scheduling page in the most recent rebootstrap). Validation catches lint issues but not "the wiki is missing load-bearing content."

This spec addresses all three while preserving the provenance guarantees of the prior design.

## 4. Architecture

### 4.1 The unified operation

One command: `make update PROJECT=<key>`. No `bootstrap`, no `ingest`. The operation is symmetric across first-run and incremental modes — the only difference is the size of the diff the sense stage produces.

`make update` with no arguments processes every registered project in sequence. Batch semantics: a per-project failure is recorded and batch continues to next project (fail-soft across the batch; fail-hard within a single project). Summary of all projects is written at end.

### 4.2 Pipeline: seven stages, sharp contracts

| # | Stage | Type | Responsibility | Consumes | Produces |
|---|---|---|---|---|---|
| 1 | sense | Script + **mechanical** LLM classifier | Enumerate inputs; classify each **source file** by `source_kind` (spec/design/plan/...); no ranking; no domain reasoning | project state, repo, inbox, git | `sense-report.json` |
| 2 | impact | LLM agent (two sub-tasks) | **Sub-task 1 (Ranking):** read repo meta-docs + entry points + sense classifications; produce ranked domain list (Signals A+B+C). **Sub-task 2 (Delta):** identify affected pages, new domains, stale pages given sense input + ranking | sense-report, current wiki, state, repo | `ranking-snapshot.json` + `impact-report.json` |
| 3 | propose | LLM agent | Draft full changeset: create/update/delete/rename units + index edits. Every unit cites the `ranking-snapshot.json` in its justification. Honor `max_new_pages` cap | impact-report, ranking-snapshot, wiki, repo | `proposal.json` + `proposal.md` |
| 4 | approve | Operator (skippable via `AUTO=1` with conditions) | Review proposal; reject/edit units; approve | proposal | approved proposal (may be split by safety ladder) |
| 5 | apply | Script | Mechanically write changes; update `pages.json`; regenerate index; write `last_seen_commit_pending` (see 4.6). Destructive changes split to pending-approvals when AUTO=1 | approved proposal | updated wiki + intermediate state |
| 6 | validate | Script (structural) + LLM agent (semantic) | Check contract compliance + access-pattern coverage. On pass, commit `last_seen_commit_pending` → `last_seen_commit` | updated wiki | `validation-findings.json` |
| 7 | reconcile | LLM agent (gated) | If validation fails: propose fixes; loops back to apply at most once (see 4.5). Reconcile proposals go through the same approval gate by default | findings + wiki + original proposal | `reconcile-proposal.json` |

**Rules:**
- Scripts handle mechanical work (file writes, git diffs, JSON schema validation).
- Agents handle semantic judgment.
- No agent writes wiki files directly — agents produce structured proposals; scripts apply them.
- Every agent stage has a configurable token budget ceiling (`agents/update/<stage>/config.json`). Over-budget = clean failure, not silent truncation.

### 4.3 Access-pattern ranking (owned by impact stage, sub-task 1)

The **impact stage** owns ranking computation. This is a single, authoritative point — no other stage produces a ranking.

Impact's Sub-task 1 receives as input:
- `sense-report.json` (sources + classifications + changed paths)
- Repo meta-docs: `README*`, `docs/`, `pyproject.toml`/`package.json`/`Cargo.toml`/equivalent
- Entry-point signals: top-level executables, service definitions, routed paths (identified by file-pattern conventions listed in `agents/update/02-impact/config.json`)
- Current wiki pages and their `pages.json` entries (for incremental runs)

Impact's Sub-task 1 produces `ranking-snapshot.json`:

```json
{
  "run_id": "<ts>-update-<key>",
  "cutoff": 20,
  "cutoff_config_source": "agents/update/02-impact/config.json:ranking_cutoff",
  "signal_a_sources": ["README.md", "docs/design/..."],
  "signal_b_entry_points": ["server/Reducers/*.cs", "..."],
  "ranked_domains": [
    {
      "rank": 1,
      "domain": "authentication",
      "score": 0.87,
      "signals": ["A","B","C"],
      "signal_a_evidence": ["README.md:14-22", "docs/auth-design.md"],
      "signal_b_evidence": ["server/Helpers/Auth/AuthHelpers.cs", "server/Handlers/Auth/"],
      "signal_c_reasoning": "Appears across three backend layers (Helpers/Handlers/Tables). Load-bearing for 'how do I add a new permission' queries."
    }
  ]
}
```

**Signal C contract (the LLM sub-task that does the final ranking):**

Input prompt to the ranking agent:
- A+B signal evidence (as above)
- Current wiki page set (if any)
- Cutoff N (from config)
- Required output schema: ranked array with `signal_c_reasoning` required for top-N and any domain not ranked from A+B alone

Output requirements:
- Must emit exactly `cutoff` entries unless fewer than `cutoff` valid domains exist
- `signal_c_reasoning` field must contain at least one concrete justification citing A or B evidence, OR explicitly state "no A/B signal; promoted on structural fan-in"
- Emit structured JSON only. Free-form prose reasoning outside the JSON schema fails the stage.

**Validation:** the validator re-reads `ranking-snapshot.json` and checks: (1) JSON schema conformance, (2) every domain the `propose` stage cites in `justification_signals` appears in `ranking-snapshot.json.ranked_domains`. A proposal that references a domain absent from the snapshot fails validation.

**Cutoff N:** default 20, configurable per project in `project.json.ranking_cutoff`. Operator override for large or tiny repos.

### 4.4 Destructive change safety ladder

Each proposal unit is classified `additive` (create, update) or `destructive` (delete, rename, major restructure). "Major restructure" = a unit whose index_changes block would move more than 2 existing entries between categories.

Under `AUTO=1`:
- Additive + low-uncertainty: apply immediately
- Destructive OR uncertainty: high: split to `projects/<key>/state/pending-approvals/<proposal-id>/`
- Apply writes the split marker to the artifact dir and increments a counter; status command surfaces "N approvals pending"

Under gated mode (default), the operator reviews the entire proposal; no split.

**Pending-approvals schema:**
`projects/<key>/state/pending-approvals/<proposal-id>/`:
- `proposal-slice.json` — subset of original `proposal.json.units` containing only deferred units. Full schema in Section 5.6.
- `proposal-slice.md` — human render
- `created_at` in JSON; `origin_run_id` in JSON
- Lives until `make apply-pending` confirms or `make reject-pending PROPOSAL=<id>` rejects

### 4.5 Reconcile semantics

Triggered only when validate reports `status: fail`.

**Inputs to reconcile agent:**
- `validation-findings.json`
- Current wiki state (after failed apply)
- `ranking-snapshot.json` (same file the failing proposal cited; ranking is not re-computed)
- Original `proposal.json` (for context on intent)

**Output:** `reconcile-proposal.json` in identical schema to `proposal.json`.

**Approval model for reconcile:** same gating as the original proposal. If original was AUTO, reconcile is AUTO (with same safety-ladder split). If original was gated, reconcile is gated. Operator is never surprised.

**Loop:**
- reconcile → apply → validate (second pass)
- If second validation passes: success
- If second validation fails: status = `fail`; run halts; operator intervention required
- If reconcile-proposal itself fails schema validation at any point (missing `ranking-snapshot.json` reference, empty units, ungrounded justification_signals): status = `fail`; run halts; operator intervention required. No third loop.

**Token budget:** reconcile agent has explicit `token_budget` in `agents/update/07-reconcile/config.json` (default 40000 input). Over budget = clean failure.

### 4.6 Commit pointer advancement

Advancement of `freshness.json.last_seen_commit` is atomic-at-end-of-run and gated on validation success.

- `apply` writes `freshness.json.last_seen_commit_pending` = current HEAD SHA
- `validate` runs
- On `status: pass` (either first-pass or post-reconcile): `scripts/apply_commit.sh` moves `_pending` → `last_seen_commit`, clears `_pending` field
- On `status: fail`: `_pending` stays; next run's `sense` re-computes diff from the older `last_seen_commit`

This prevents "commit pointer poisoning" — a failed run cannot silently advance state past its own failure.

**`scripts/apply_commit.sh` details:**
- Input: `PROJECT=<key>` and path to the validation-findings.json from the current run
- Behavior: reads `freshness.json`, if `last_seen_commit_pending` is non-null and validation status is `pass`, atomically moves pending → committed via a temp-file-and-rename pattern. Clears `_pending` field. Logs entry in `changelog.md`.
- Called by: `scripts/update.sh` at the end of a successful run (after validate or after reconcile second-pass success)
- Not called for `make apply-pending` — pending-slice application does not advance commit pointer (Section 5.6).
- Delivered in: Plan B (with the apply stage).
- Tested in: `tests/test_commit_pointer.py` (Plan A or B; see Section 11.2).

### 4.7 Git awareness

The `sense` stage:
- Always runs `git diff <last_seen_commit>..HEAD --name-only` for mechanical change-path → affected-page mapping (via `state/pages.json`).
- Reads commit messages selectively: only when an inbox source explicitly references a commit/PR (`fix(auth): see commit abc123`), or when a file-level diff is ambiguous (e.g., only whitespace or formatting changes across many files). The "ambiguous" case is detected by a simple heuristic script; no LLM involved in that detection.
- First run (no `last_seen_commit`): treats the whole repo as the diff; mode = `first-run`.
- Repos without git: `sense` degrades to inbox-only reactive mode; first run scans the whole repo once. Mode = `no-git`.

## 5. Contracts

### 5.1 Page contract

Every wiki page has three **required** sections in this order, with exact headings:

```markdown
<One-sentence summary. First line of the page. No heading prefix.>

## Repo pointers

- `path/to/file.ext:start-end` — one-line purpose
- `path/to/other.ext:start-end` — one-line purpose

<Flexible body. Any number of sections, any shape that serves the page's purpose.>

## Related

- [page-title](../category/page.md) — one-line why-you-would-follow-this-link
- Known gaps: <concrete list or "none known">
```

**Rules:**
- Summary is the first line, no heading prefix.
- `## Repo pointers` comes second, before body prose.
- Every repo pointer has `file:line-line` and a one-line purpose. No naked paths.
- Body flexes to page purpose — no prescribed sub-sections.
- `## Related` closes with cross-refs + honest gap list.
- Target ~60 lines; up to ~80 when warranted. Split when coherence demands; never to hit a count.
- No YAML frontmatter (existing CLAUDE.md rule).
- No `## Status` / `## Review Provenance` / `Verified:` / `Inferred:` structural decorators **on wiki pages under `wiki/`**.

### 5.2 Index contract

`projects/<key>/index.md`:

```markdown
<One-paragraph project summary — what it is, what it does, at a glance.>

## Start here

- [page-title](wiki/category/page.md) — when to start here (task pattern)
- <3 to 5 entries, the highest-traffic access paths>

## Routing

### Architecture
- [page-title](wiki/architecture/page.md) — one-line what-it-covers

### Systems
- [page-title](wiki/systems/page.md) — one-line what-it-covers

### <Category> (show only categories with pages)

## Gaps and deferred

- <honest list of domains not yet covered or deliberately deferred, with reason>

## Status

- Last update: <ISO timestamp> at commit `<short-sha>`
- Freshness: see `state/latest/validation-report.md`
- Measurement: see `state/latest/measurement-report.md`
```

**Carve-out vs. CLAUDE.md writing rules:** CLAUDE.md bans `## Status` sections that "narrate the wiki's own construction" on wiki pages. `index.md`'s `## Status` block is **exempt** — it points at machine-readable state files, not at pipeline narration. This spec formalizes the exemption. The CLAUDE.md section on writing rules will be updated in M2 to note the carve-out.

**Rules:**
- Every line earns its place by helping an LLM route faster.
- Empty categories are omitted.
- `Status` block points at `state/latest/`, never at `artifacts/`.

### 5.3 Proposal contract

The `propose` agent emits two paired artifacts.

**`proposal.json`:**

```json
{
  "project": "<key>",
  "run_id": "<ts>-update-<key>",
  "summary": "<one-paragraph plain-text summary>",
  "ranking_snapshot_path": "projects/<key>/state/latest/ranking-snapshot.json",
  "max_new_pages": 25,
  "max_new_pages_config_source": "agents/update/03-propose/config.json:max_new_pages",
  "new_pages_count": 17,
  "deferred_domains": [
    {
      "rank": 21,
      "domain": "logging-infrastructure",
      "reason": "Below cutoff; revisit when cutoff raised or domain gains entry-point presence"
    }
  ],
  "units": [
    {
      "id": "u1",
      "action": "create | update | delete | rename",
      "page_path": "wiki/systems/auth.md",
      "rename_from": null,
      "destructive": false,
      "uncertainty": "low | medium | high",
      "justification": "Top-ranked domain per ranking-snapshot.json (rank 1). Referenced by 3 design docs (A), 4 entry points (B), LLM flagged load-bearing (C).",
      "justification_signals": ["A", "B", "C"],
      "referenced_ranking_domains": ["authentication"],
      "source_classification": {
        "source_kind": "spec | design | plan | implementation-note | api-doc | reference | session-note | decision-candidate | troubleshooting",
        "ownership": "project:<key>",
        "destination": "wiki/systems/auth.md",
        "update_targets": ["wiki/systems/auth.md"],
        "action": "create-new-page-and-update-index"
      },
      "content": "<full new page content, or null for delete>",
      "affected_cross_refs": ["wiki/integrations/web-admin-client.md"],
      "source_citations": ["server/Helpers/Auth/AuthHelpers.cs:5-18"]
    }
  ],
  "index_changes": {
    "action": "update",
    "destructive": false,
    "content": "<full new index.md content>",
    "categories_reshuffled": 0
  },
  "state_changes_intent": {
    "last_seen_commit_pending": "<sha>",
    "last_update_at_pending": "<iso>"
  }
}
```

**`proposal.md`:** human-readable render, grouped by action, destructive units visibly separated at top, deferred domains listed in a trailing section.

**Rules (mechanically enforced by structural validator):**
- `destructive: true` on any unit OR `index_changes.destructive: true` forces approval even under AUTO=1.
- `uncertainty: high` on any unit forces approval even under AUTO=1.
- `justification_signals` must include at least one of `A|B|C`. Every listed signal must correspond to a non-empty field in the ranking snapshot for the referenced domain.
- `referenced_ranking_domains` must all exist in `ranking-snapshot.json.ranked_domains`.
- `new_pages_count ≤ max_new_pages`. Excess goes to `deferred_domains` with reasons.
- `source_citations` must resolve (file exists, line range valid). Checked by `apply` pre-flight.
- `source_classification` fields inherit allowed values from the prior ingest contract (preserved, not dropped).

### 5.4 Stage report contracts

**`sense-report.json`:**
```json
{
  "project": "<key>",
  "run_id": "<ts>-update-<key>",
  "mode": "first-run | incremental | no-git",
  "last_seen_commit": "<sha or null>",
  "current_head": "<sha or null>",
  "inbox_sources": [
    {
      "path": "projects/<key>/inbox/source.md",
      "source_kind_hint": "spec | design | plan | ...",
      "classification_confidence": "low | medium | high",
      "classification_reasoning": "one-line mechanical justification"
    }
  ],
  "changed_paths": [
    {"path": "server/Auth.cs", "change_type": "modified | added | deleted | renamed"}
  ],
  "commit_messages_read": [
    {"sha": "abc123", "subject": "...", "body_excerpt": "...", "reason_for_reading": "ambiguous-diff | source-references-commit"}
  ]
}
```

Notes:
- `inbox_sources[].source_kind_hint` is mechanical (filename/pattern-based). Impact may override if semantic reasoning disagrees.
- `classification_reasoning` must be single-line, non-semantic ("matches pattern X", "extension Y"). Any semantic classification is done by impact, not sense.

**`ranking-snapshot.json`:** defined in Section 4.3.

**`impact-report.json`:**
```json
{
  "run_id": "<ts>-update-<key>",
  "affected_pages": [
    {"path": "wiki/systems/auth.md", "reason": "server/Helpers/Auth/AuthHelpers.cs modified", "source": "git diff"}
  ],
  "new_domains": [
    {
      "name": "rate-limiting",
      "evidence": ["server/Middleware/RateLimit.cs:1-80"],
      "signal_sources": ["B"],
      "ranking_inclusion": "top-20 | below-cutoff"
    }
  ],
  "stale_pages": [
    {"path": "wiki/modules/legacy-atb.md", "reason": "ATB system replaced by scheduler v2 per `server/Systems/SchedulerV2.cs:12-45`"}
  ],
  "ranking_snapshot_ref": "projects/<key>/state/latest/ranking-snapshot.json"
}
```

**`validation-findings.json`:**
```json
{
  "run_id": "<ts>-update-<key>",
  "status": "pass | fail",
  "pass_count": {"structural": 34, "semantic": 12},
  "structural": [{"page": "wiki/...", "issue": "...", "severity": "blocker | warn", "rule_id": "page.required-section.missing"}],
  "semantic": [{"category": "coverage_gap | redundancy | contradiction | index_routing | stale | ungrounded_unit", "severity": "blocker | warn", "pages": ["..."], "evidence": "...", "suggested_action": "..."}]
}
```

**`reconcile-proposal.json`:** identical schema to `proposal.json`. Validator runs the same checks.

All stage outputs are also copied to their stable paths under `projects/<key>/state/latest/`:
- `sense-report.json`, `ranking-snapshot.json`, `impact-report.json`, `proposal.json`, `proposal.md`, `validation-findings.json`, `validation-report.md`, `reconcile-proposal.json` (if any), `measurement-report.json`/`md` (from `make measure`)

Full audit trail under `artifacts/<project>/runs/<ts>-update/`.

**Stable product renderers — existing and new subcommands of `scripts/stable_products.py`:**

The existing `stable_products.py` (inherited from the 2026-04-17 redesign) has `render-lint`, `render-validation`, and `render-ingest` subcommands. The new pipeline extends it. Each subcommand takes JSON input, renders paired markdown output, and writes both to `state/latest/`.

| Subcommand | Input | Output | Plan | Notes |
|---|---|---|---|---|
| `render-lint` (existing) | `lint-findings.json` | `state/latest/lint-findings.{json,md}` | unchanged | carried forward as-is |
| `render-validation` (existing, extended) | `validation-findings.json` | `state/latest/validation-findings.{json,md}` + `validation-report.md` | Plan C | gains handling for new `rule_id` and `pass_count` fields; same input-output path |
| `render-ingest` (existing, deprecated at M5) | `ingest-findings.json` | `state/latest/ingest-findings.{json,md}` | unchanged; removed at M5 | retained for backward-compat during migration; pre-existing products archived at M5 per Section 12 |
| `render-measurement` (new) | `measurement-findings.json` (produced by `make measure`) | `state/latest/measurement-report.{json,md}` | Plan C | CLI: `render-measurement --input <path> --project-dir <path>`. Renders markdown with sections: `## Acceptance question scores`, `## Token calibration`, `## History`. When `token_calibration` is present but `acceptance_scores` is null, omits the scores section and prints "acceptance not yet measured" under it. When acceptance_scores is present but `token_calibration` is null, omits the calibration section. |
| `render-ranking` (new) | `ranking-snapshot.json` (produced by impact stage) | `state/latest/ranking-snapshot.{json,md}` | Plan A | CLI: `render-ranking --input <path> --project-dir <path>`. Renders markdown with sections: `## Cutoff` (cites config source), `## Ranked domains` (table of rank/domain/score/signals/reasoning), `## Signal A evidence`, `## Signal B evidence`. Machine JSON is copied verbatim as `.json`; markdown is the human view. |

Both new subcommands follow the existing `--project-dir` convention used by `render-lint`, `render-validation`, and `render-ingest` (takes a path to the project directory, not a key). This preserves parser consistency in `stable_products.py`. Both are idempotent (overwrite on each run).

**`render-validation` extension milestone:** the extension to handle new `rule_id` and `pass_count` fields is a Plan C deliverable, landing with the validate stage that produces those fields. Until Plan C lands, `render-validation` continues to render the narrower schema from the prior redesign.

The `validate` stage invokes `render-validation`. `make measure` invokes `render-measurement`. The `impact` stage invokes `render-ranking` at the end of its run.

### 5.5 Agent stage config contract

Every agent stage under `agents/update/<stage>/` has a `config.json` with the same top-level schema, validated by `scripts/validate_stage_configs.py` (Plan A deliverable).

**Common schema:**
```json
{
  "stage": "sense | impact | propose | validate | reconcile | measure",
  "agent_kind": "script-only | script+classifier | llm-agent",
  "token_budget_input": 40000,
  "token_budget_output": 8000,
  "on_over_budget": "fail-clean",
  "stage_specific": { }
}
```

**`stage_specific` keys by stage:**

| Stage | `stage_specific` keys |
|---|---|
| sense | `inbox_filename_patterns` (map of regex → source_kind_hint); `commit_message_ambiguity_heuristic` (config for when to read commit messages) |
| impact | `ranking_cutoff` (int, overridable by `project.json.ranking_cutoff`); `entry_point_patterns` (list of globs identifying Signal B sources) |
| propose | `max_new_pages` (int, default 25); `max_units_per_proposal` (int, default 50) |
| validate | `severity_thresholds` (map of rule_id → pass-threshold); `semantic_rules_enabled` (list of semantic check names) |
| reconcile | `max_loop_iterations` (int, fixed at 1 per Section 4.5; config present for future use) |
| measure | `llm_endpoint`, `per_question_token_cap`, `total_budget`, `variance_runs` |

**Precedence:** `project.json` per-project overrides beat `config.json` defaults. Environment variables (`TOKEN_BUDGET=`, etc.) beat both. Precedence is enforced by a shared helper in `agents/update/_shared/config.py`.

**Discovery:** Any agent or script needing a config value references it by a string path (e.g., `"agents/update/02-impact/config.json:ranking_cutoff"`) in its output artifacts. This path is both human-readable and greppable — critical for debugging failed runs.

**Validation call site:** `scripts/update.sh` calls `scripts/validate_stage_configs.py` exactly once at pipeline entry, before invoking any stage. A config validation failure aborts the run with a clear error naming the offending stage and field; no stage is started. Rationale: config errors are orthogonal to stage work — cheap to check up-front, and failing fast prevents half-complete runs.

### 5.6 Proposal-slice contract (pending-approvals)

When `AUTO=1` splits a proposal at the safety ladder (Section 4.4), the deferred units are written to `projects/<key>/state/pending-approvals/<proposal-id>/proposal-slice.json`:

```json
{
  "origin_run_id": "<ts>-update-<key>",
  "origin_proposal_path": "artifacts/<project>/runs/<ts>-update/proposal.json",
  "project": "<key>",
  "summary": "<copied from origin proposal>",
  "ranking_snapshot_path": "<copied>",
  "max_new_pages": 25,
  "created_at": "<ISO timestamp>",
  "slice_reason": "destructive | high-uncertainty | mixed",
  "units": [ /* deferred units, same schema as proposal.json.units */ ],
  "index_changes": null,
  "state_changes_intent": {
    "last_seen_commit_pending": null,
    "last_update_at_pending": null,
    "note": "Commit pointer advancement was handled by the origin run's applied portion. Applying this slice does not advance the pointer. A fresh make update run is required."
  }
}
```

Notes:
- Slice carries enough metadata (`project`, `ranking_snapshot_path`, `origin_*`) that `make apply-pending` can operate without reading the origin `proposal.json`.
- `index_changes` is carried only if the deferred units materially affect index content; otherwise null (index is regenerated during slice apply from current page state).
- Corresponding `proposal-slice.md` is a human render produced by the same renderer as the origin proposal.md.

`make apply-pending` and `make reject-pending` scripts:
- `scripts/apply_pending.sh PROJECT=<key> PROPOSAL=<id>` — re-validates citations, runs apply on slice units, runs validate post-hoc, does NOT touch `last_seen_commit`. If validation fails, reconcile is triggered against the slice.
- `scripts/reject_pending.sh PROJECT=<key> PROPOSAL=<id>` — archives slice to `artifacts/<project>/rejected/<proposal-id>/`, logs entry in `changelog.md`, removes from `pending-approvals/`.

### 5.7 Acceptance-questions contract

`projects/<key>/acceptance-questions.md`:

```markdown
# Acceptance Questions — <project>

Questions a cold LLM session should be able to answer from the wiki alone.

<!-- version: <semver-like-string, operator-bumped when question set changes meaningfully> -->

1. [discipline] What is <project>, what are its major surfaces, and where would I start reading?
2. <...>

## Scoring

- 2: full answer with citations from wiki alone
- 1: directional but incomplete or uncited
- 0: can't answer; wrong; wiki contradicts itself

## Acceptance bar

- Total ≥ 16/20
- No zero on [discipline]-tagged questions
```

**Versioning:**
- HTML comment `<!-- version: X.Y -->` near top of file
- Operator bumps when questions change materially
- `make measure` records `question_set_version` in `measurement-report.json`
- A measurement's comparability with prior runs is only valid when version matches

## 6. State Model

### 6.1 Changes to existing state

- `projects/<key>/state/freshness.json` — gains `last_seen_commit`, `last_seen_commit_pending`, `last_update_at`. Updated atomically by `apply` (pending) and `apply-commit` post-validate (pending → committed).
- `projects/<key>/state/bootstrap-state.json` — **renamed** to `projects/<key>/state/update-state.json` with schema change. Migration is a one-way transform handled by `scripts/migrate_state_v1_to_v2.sh` (M1 deliverable); see Section 12 for details.
- `projects/<key>/state/latest/` — unchanged for pre-existing products (`validation-findings.json`, `validation-report.md`, `lint-findings.json`, `lint-findings.md`, `ingest-findings.json`, `ingest-report.md`, `bootstrap-summary.md`). Gains new products: `sense-report.json`, `ranking-snapshot.json`, `impact-report.json`, `proposal.json`, `proposal.md`, `measurement-report.json`, `measurement-report.md`, `reconcile-proposal.json` (when applicable). The new pipeline's validation output overwrites the pre-existing `validation-findings.json` with an expanded schema (superset of old schema; readers tolerant to extra fields are unaffected).

### 6.2 Operator-owned fields in `project.json`

Preserved: `key`, `name`, `repo_paths`, `tags`, `entry_pages`, `ignored_paths`, `related_concepts`.

**Added:**
- `acceptance_questions_path` (default: `acceptance-questions.md`)
- `ranking_cutoff` (default: 20)

**Removed:** `bootstrap_focuses`.

Migration for `bootstrap_focuses`: migration script (`scripts/migrate_state_v1_to_v2.sh`) reads existing `bootstrap_focuses` values and:
- Writes them as hint lines into a new `projects/<key>/.migration-hints/bootstrap-focuses-archive.md` under the operator's acceptance-questions file path with a comment: "Prior `bootstrap_focuses` — consider re-expressing as acceptance questions."
- Does not auto-translate into acceptance questions (that requires operator semantic judgment).
- Prints warning: "N bootstrap_focuses entries archived; review `<path>` and port to acceptance-questions.md as needed."

### 6.3 Concurrency

Lockfile at `projects/<key>/state/update.lock` (per-project). Second `make update` on same project errors with lock holder info (pid + start time + run_id).

Batch mode (`make update` no args): acquires lock per-project serially; if a lock is held, skips that project with a warning and continues to next.

### 6.4 Resume semantics

Each stage writes completion marker to `update-state.json`. A run that crashes mid-pipeline can be resumed from the last successful stage via `make update PROJECT=<key> RESUME=1`. Resume valid only if the `run_id` under resume matches the one in state. Running without `RESUME=1` on a state with an incomplete prior run prints a warning and starts fresh.

## 7. Operator Workflow

### 7.1 First-time project setup

```bash
make init PROJECT=myproj
# operator edits projects/myproj/state/project.json (repo_paths, tags, ignored_paths, ranking_cutoff)
# operator writes projects/myproj/acceptance-questions.md (questions they care about)
make update PROJECT=myproj
# sense → impact → propose → [review proposal] → approve → apply → validate → [reconcile if needed]
```

### 7.2 Daily use

```bash
# operator drops source.md into projects/myproj/inbox/ and/or commits code
make update PROJECT=myproj
```

### 7.3 Trusted fast path

```bash
make update PROJECT=myproj AUTO=1
# additive + low-uncertainty apply immediately
# destructive + high-uncertainty queued at state/pending-approvals/
make apply-pending PROJECT=myproj PROPOSAL=<proposal-id>
make reject-pending PROJECT=myproj PROPOSAL=<proposal-id>
```

**Commit pointer timing under AUTO=1 split:** the `last_seen_commit_pending` field is set by `apply` only for the portion that lands. When pending approvals are later applied, they do not advance commit pointer (their source was the same run's sense snapshot). A subsequent `make update` is required to advance the commit pointer past changes introduced after the original run.

### 7.4 Standalone checks

```bash
make lint PROJECT=myproj        # validate-only; no state mutation; writes to state/latest/lint-*
make status PROJECT=myproj       # print state/latest/* summary
make measure PROJECT=myproj      # acceptance-question run (see Section 9)
make measure-tokens PROJECT=myproj TASK="implement <brief>"  # calibration (see Section 9)
make prune                       # artifact retention (existing)
```

### 7.5 Cross-project

```bash
make update           # update every registered project; fail-soft across batch; write state/update-batch-summary.md
make status-all       # one-line dashboard
```

## 8. Edge Cases

| Case | Handling |
|---|---|
| First run (empty wiki) | `sense` treats whole repo as diff; `propose` emits `create` units for initial set + `index.md`; ranking honors cutoff; excess domains go to `deferred_domains` |
| Repo has no git | `sense` mode = `no-git`; full-repo scan on first run; inbox-only reactive afterwards; `changed_paths` empty; commit pointer fields null |
| Operator rejects entire proposal | Run aborts; no state mutation; `proposal.rejected` marker; `last_seen_commit_pending` cleared |
| Operator rejects some units | `apply` processes only approved units; rejected units logged in `changelog.md` |
| Validation fails first pass | `reconcile` triggered; up to one re-loop; on second fail: status = `fail`, run halts, commit pointer not advanced |
| Reconcile-proposal fails schema validation | status = `fail`; no third loop; operator intervention required; failed reconcile artifact preserved for debugging |
| Source contradicts existing page | `propose` drafts update preserving contradiction inline with both source citations; marks `uncertainty: high` |
| Destructive change under AUTO=1 | Split to pending-approvals; non-destructive applies; `make apply-pending` finalizes destructive units later |
| Concurrent `make update` same project | Lockfile prevents; second call errors |
| Concurrent batch mode with per-project lock held | Skipped with warning; continues to next project |
| Agent-stage error (API timeout, over-budget) | Stage writes partial artifacts + error marker; `update-state.json` records failure; next run or `RESUME=1` continues |
| Repo paths moved/renamed | Operator updates `project.json.repo_paths`; next run's `sense` detects mismatch; `propose` emits citation-path updates across pages |
| Measurement run with no wiki | `make measure` errors with "no wiki present; run `make update` first" |
| Commit pointer would advance past a failed run | Prevented by pending/committed split (Section 4.6) |
| Reconcile agent over-budget | Clean failure; status = `fail`; operator intervention |
| Batch fail on project N of M | Error recorded in `state/update-batch-summary.md`; processing continues with project N+1 |
| Large repo, ranking N=20 insufficient | Operator bumps `project.json.ranking_cutoff`; next run picks up new cutoff |

## 9. Measurement

Two passes, different purposes, neither a release gate. Measurement is a **dashboard, not an automated quality bar for CI**.

### 9.1 `make measure PROJECT=<key>` — cheap regression

Method:
1. Read `projects/<key>/acceptance-questions.md` and capture its version string.
2. For each question, dispatch a scripted subprocess call to a configured LLM (default: same model used by the pipeline) with exactly this prompt structure:
   - System: "You are answering a question about a software project using only the provided wiki. Do not claim facts you can't cite. Do not request additional files."
   - User: "WIKI: <concatenation of index.md + all files under wiki/ up to 50K chars; if larger, truncate deterministically by alphabetical path order and note truncation>. QUESTION: <question>. RESPONSE FORMAT: JSON with fields {score: 0|1|2, answer: string, citations: [string], reasoning: string}"
3. Capture per-question JSON result.
4. Aggregate: sum scores, compare to acceptance bar, produce `measurement-report.md` (human) + `.json` (machine).

Harness details:
- LLM endpoint configured via `agents/update/measure/config.json`
- Per-question token cap: 8000 input + 2000 output
- Total run token budget: configurable; default 120000
- Output written to `state/latest/measurement-report.{md,json}`
- `question_set_version` recorded for cross-run comparability

### 9.2 `make measure-tokens PROJECT=<key> TASK=<brief>` — calibration

Method:
1. Read user-provided TASK (a short brief like "implement rate limiting middleware").
2. Dispatch two scripted subprocess calls to the same LLM:
   - **Session A (with wiki):** system + user prompt that includes the full wiki as context; instructs LLM to "produce a scoping outline listing affected files, proposed changes, and open questions. Stop when ready to start writing code."
   - **Session B (without wiki):** same user prompt; system prompt instructs the LLM to "explore the repo at `/path` via `ls` and `cat` tool calls you emit in structured format; produce a scoping outline on the same stopping criterion."
3. Both sessions emit a structured `scoping-ready` JSON marker as their first token past the setup phase. The marker is the stopping criterion. Token accounting cuts off at that marker (plus any trailing tokens in the same response).
4. Compare: `tokens_without_wiki / tokens_with_wiki` → ratio. Report as percentage reduction.

Harness details:
- Session B runs against a deterministic repo-exploration simulator (no real filesystem; fed the repo as a zipped directory, with `ls`/`cat` emulated in the subprocess harness) to eliminate variance from real tool calls.
- Both sessions use the same model, same temperature (0 where supported), same system prompt frame.
- Result variance: 3 runs per session, median taken.
- Output written to `state/latest/measurement-report.{md,json}` under a `token_calibration` top-level key; does not overwrite the acceptance-question scores. If no prior `make measure` has produced `measurement-report.json`, `make measure-tokens` creates the file with only the `token_calibration` key; absent acceptance-question data is represented as `"acceptance_scores": null`. `scripts/status.sh` tolerates null acceptance_scores by printing "acceptance not yet measured."

**30% goal verification:** `make measure-tokens` is the verification instrument. The goal is met when calibration runs show ≥30% reduction at stable variance across at least 3 runs on at least 2 distinct task briefs. Until the harness is implemented and produces these numbers, the 30% claim is aspirational, not verified.

**Deferred:** harness implementation is a separate plan (see Section 14). The spec commits to the schema and the method; v1 may ship with `make measure-tokens` stubbed returning "harness not yet implemented."

## 10. Validation Criteria

### 10.1 Structural (deterministic script)

- Every required page section (summary, repo pointers, related) present on every page under `wiki/`
- Every `file_path:line_number` citation resolves (file exists, line range valid)
- No orphan pages (every page linked from index or another page)
- No dead cross-refs
- Every index routing entry resolves to a real page
- `state/pages.json` and filesystem agree
- Every `proposal.json.units[i].justification_signals` includes ≥1 of `A|B|C`
- Every `proposal.json.units[i].referenced_ranking_domains` appears in `ranking-snapshot.json.ranked_domains`
- `proposal.json.new_pages_count ≤ max_new_pages`
- `proposal.json.source_classification` fields present and use allowed values

### 10.2 Semantic (LLM agent)

- Does every page earn its place in the top-N access-predicted domains (per `ranking-snapshot.json`)?
- Do pages overlap redundantly?
- Do pages feel coherent and non-contradictory?
- Does the index surface the highest-ranked access paths, or bury them?
- Are stale/gap areas honestly marked?

Both tiers run on every `make update`; also standalone via `make lint`.

## 11. Testing Strategy

### 11.1 Fixture deliverable

`tests/fixtures/sample_repo/` **must be created** as part of Plan A (Section 14). It does not currently exist. Minimum contents:

- `sample_repo/README.md` — 20-line project overview
- `sample_repo/src/auth.py` — 40 lines, defines login/logout
- `sample_repo/src/db.py` — 30 lines, DB access layer
- `sample_repo/src/main.py` — 15 lines, entry point
- `sample_repo/docs/architecture.md` — 15 lines, describes two layers
- `sample_repo/.git/` — real git history, 3 commits with distinct authorship
- `sample_repo/pyproject.toml` — minimal

**Fixture project state:**
`tests/fixtures/project_state/` — template `state/` directory with `project.json`, empty `pages.json`, etc. that `conftest.py` can clone into `tmp_project`.

`conftest.py` is updated so `tmp_project` can optionally clone `fixtures/sample_repo/` + `fixtures/project_state/` into a `tmp_path`, yielding a realistic test project. The in-memory `tmp_project` fixture remains available for lightweight tests.

### 11.2 Unit tests (pytest)

One test module per script and per agent contract:

- `tests/test_update_sense.py` — script behavior with fixture repo; asserts `sense-report.json` schema, mode detection, classification output format
- `tests/test_update_impact.py` — mock LLM responses; asserts `ranking-snapshot.json` and `impact-report.json` schemas; rejects malformed LLM output
- `tests/test_update_propose.py` — mock LLM responses; asserts `proposal.json` schema, destructive flagging, uncertainty escalation, `max_new_pages` cap enforcement, `referenced_ranking_domains` validation
- `tests/test_update_apply.py` — script-only; asserts pre-flight citation resolution, atomic state transitions, pending-approvals split under AUTO=1
- `tests/test_update_validate.py` — extends existing structural test; adds new rules (justification signals, ranking references, source classification presence)
- `tests/test_update_reconcile.py` — mock LLM; asserts schema validation of reconcile output, second-failure behavior, token budget enforcement
- `tests/test_state_migration.py` — asserts `scripts/migrate_state_v1_to_v2.sh` correctly transforms old state files, handles `bootstrap_focuses` archival
- `tests/test_commit_pointer.py` — asserts `last_seen_commit_pending` semantics, validation-pass commits, validation-fail preserves

### 11.3 Integration tests (pytest, no real LLM)

**Stub harness contract:**

LLM stages are mocked via environment variable `LLM_STUB_RESPONSES_DIR` pointing at a directory with the following layout:

```
<stub-dir>/
├── 01-sense.classifier.json       # mock response for sense's short LLM classifier
├── 02-impact.ranking.json         # mock response for impact Sub-task 1 (ranking)
├── 02-impact.delta.json           # mock response for impact Sub-task 2 (delta)
├── 03-propose.json                # mock response for propose agent
├── 06-validate.semantic.json      # mock response for semantic validator
└── 07-reconcile.json              # mock response for reconcile agent
```

**Stub file schema** — each file contains:
```json
{
  "stage": "<stage-name>",
  "prompt_hash": "<sha256 of expected prompt; optional; if present, consumer asserts match>",
  "response": { /* raw parsed-JSON response as if the LLM had produced it */ },
  "tokens_consumed": {"input": 12345, "output": 678}
}
```

**Consumer contract:**
- Shared helper `agents/update/_shared/llm_client.py` checks for `LLM_STUB_RESPONSES_DIR`. If set, reads the stub file matching the stage's canonical id (`01-sense.classifier`, etc.) and returns the `response` field.
- If `prompt_hash` is present in the stub, the helper verifies it matches the hash of the prompt it was about to send; mismatch = clean failure (prevents tests silently passing with outdated stubs).
- If `LLM_STUB_RESPONSES_DIR` is unset, helper makes a real LLM call.
- Multi-call stages (e.g., measure runs one call per acceptance question) use indexed filenames: `measure.q1.json`, `measure.q2.json`, etc.

**Stub management:**
- `tests/fixtures/stubs/` holds baseline stubs used by the integration test suite. Tests copy these into a tmp dir and mutate per-test.
- New stubs added by test authors should include a comment in the JSON explaining the scenario they represent.

**Scenarios:**

Each scenario below has a concrete test function.

| Test | Given | When | Assert |
|---|---|---|---|
| `test_first_run_empty_wiki` | fresh project, fixture repo, empty wiki | `make update` | 15-25 pages created; index.md has `## Start here` with 3-5 entries; all citations resolve; state files updated |
| `test_incremental_diff_only` | populated wiki from prior run; modify `src/auth.py` | `make update` | 1-3 pages updated; no new pages; commit pointer advances |
| `test_inbox_only_no_git_changes` | populated wiki; drop `inbox/new-feature.md`; no git changes | `make update` | 1-2 pages created or updated; unrelated pages untouched |
| `test_auto_mode_non_destructive` | populated wiki; modify `src/db.py` | `make update AUTO=1` | Applies immediately; no pending-approvals created |
| `test_auto_mode_destructive_split` | populated wiki; mock propose returns a delete unit | `make update AUTO=1` | Non-destructive applied; destructive in `state/pending-approvals/`; apply-pending finalizes |
| `test_validation_fail_reconcile_success` | mock validator fails first pass; reconcile stub succeeds | `make update` | Reconcile → apply → validate second pass passes; status = pass |
| `test_validation_fail_reconcile_fail` | both validation passes fail | `make update` | Status = fail; run halts; commit pointer not advanced |
| `test_resume_after_crash` | mid-run failure at apply stage | `make update RESUME=1` | Resumes from apply; completes |
| `test_batch_fail_soft` | batch of 3 projects; project 2 fails | `make update` (no arg) | Projects 1 and 3 complete; batch summary records project 2 failure |
| `test_ranking_cutoff_override` | project with `ranking_cutoff: 5` | `make update` | At most 5 entries in ranked_domains; excess in deferred_domains |
| `test_ungrounded_unit_rejected` | mock propose returns unit with empty `justification_signals` | `make update` | Validator rejects; reconcile triggered |

### 11.4 Acceptance tests (real LLM, periodic)

- `make measure` against `rpg_game` and `sample`
- Threshold: ≥16/20 for shippable wiki
- Not in CI (LLM-dependent); run on demand
- Token-calibration runs (Section 9.2) when infrastructure is in place

## 12. Migration

**Scope correction from prior revision:** the previous draft claimed `make update-v2` and old commands could operate in parallel. That is not achievable because `bootstrap-state.json` → `update-state.json` is a rename with schema change. This migration plan replaces that with a realistic staged approach.

### M1 — Foundation + state migration tooling

- Build `scripts/migrate_state_v1_to_v2.sh` (and reverse `scripts/migrate_state_v2_to_v1.sh`): transforms `bootstrap-state.json` → `update-state.json`, archives `bootstrap_focuses`, expands `freshness.json` with pending fields.
- Add `tests/fixtures/sample_repo/` and `tests/fixtures/project_state/` per Section 11.1.
- Add `tests/fixtures/stubs/` with baseline LLM stubs per Section 11.3.
- Register a `projects/sample/` project that uses `tests/fixtures/sample_repo/` as its `repo_paths` target, with a minimal `acceptance-questions.md` and `project.json`. This is the canonical test target for `make update-v2` / `make measure` throughout plans A–C.
- Implement `sense` and `impact` stages (including ranking sub-task) under `agents/update/01-sense/` and `agents/update/02-impact/`. Each stage has its own `config.json` per Section 5.5.
- Build `agents/update/_shared/config.py` (config precedence helper) and `agents/update/_shared/llm_client.py` (stub-aware LLM helper per Section 11.3).
- Build `scripts/validate_stage_configs.py` to validate config.json shape at startup.
- Add `scripts/update.sh` supporting only sense and impact for now (propose onward stubs).
- Add `make update-v2` Makefile target wired to `scripts/update.sh`. This target is the acceptance harness for Plans A, B, and C. At M5 it is renamed to `make update`.
- No operator-visible change to existing commands; `make bootstrap` and `make ingest` continue to work as today.
- Deliverable: sense and impact can be invoked standalone for testing; state migration tested on both `rpg_game` and `sample`; `make update-v2 PROJECT=sample` runs sense and impact to completion.

### M2 — Proposal + approval + apply + safety ladder

- Implement `propose`, `approve`, `apply` stages with their `config.json` files per Section 5.5.
- Add `state/pending-approvals/` handling; build `scripts/apply_pending.sh`, `scripts/reject_pending.sh`, and Makefile targets `make apply-pending`, `make reject-pending`.
- Implement commit pointer `last_seen_commit_pending` semantics + `scripts/apply_commit.sh` per Section 4.6.
- Add index.md `## Status` carve-out to the writing rules. `AGENTS.md` is the source file; `CLAUDE.md` and `GEMINI.md` are symlinks to it (verified — `CLAUDE.md → AGENTS.md`, `GEMINI.md → AGENTS.md`). Edit `AGENTS.md` only.
- Update `scripts/init_project.sh` so `make init` produces a `project.json` with the new v2 fields (`acceptance_questions_path`, `ranking_cutoff`) and without `bootstrap_focuses`. Existing init output templates under `templates/state/` are updated accordingly.
- Update `scripts/status.sh` and `scripts/lint.sh` to read `update-state.json` (they currently read `bootstrap-state.json` — see Section 13.2). Mid-migration behavior: both scripts gain a fallback — if `update-state.json` is absent but `bootstrap-state.json` is present, they read the old file with a printed warning "project not yet migrated to v2 state; run scripts/migrate_state_v1_to_v2.sh PROJECT=<key>". This prevents breakage on projects that haven't been migrated.
- `make update-v2` is now functional for a full pipeline except validate/reconcile (stubbed).
- Run `make update-v2` on a temporary copy of `sample` project to verify end-to-end.

### M3 — Validate + reconcile

- Implement `validate` (structural rule extensions + semantic agent) and `reconcile` stages.
- Wire up `make lint` to new validator (replaces old validator invocation path).
- Full pipeline working. `make update-v2` usable on a fresh project.
- **No in-place migration of `rpg_game` yet.** Migration is triggered by operator, not by M3 landing.

### M4 — Pilot migration

- Archive current `rpg_game` wiki (`projects/_archive/rpg_game-pre-unified-<date>/`).
- Run `scripts/migrate_state_v1_to_v2.sh PROJECT=rpg_game`.
- Run `make update-v2 PROJECT=rpg_game` on the (now-empty) wiki. Expect full rebootstrap.
- Iterate `propose` agent brief and ranking config until `make measure PROJECT=rpg_game` scores ≥16/20.
- Also migrate and run on `sample`.

### M5 — Promote and delete

- Rename `make update-v2` → `make update`.
- Delete old entry points: `make bootstrap`, `make ingest`, `make ingest-apply`, `make ingest-v2`, `make bootstrap-reconcile`, etc.
- Delete old stage dirs: `agents/bootstrap/01-orient/` through `05-reconcile/`.
- Delete old scripts: `scripts/ingest.sh`, `scripts/ingest_v2.sh`, `scripts/ingest_apply.sh`, `agents/bootstrap/run.sh`.
- **Pre-existing stable products cleanup:** `projects/<key>/state/latest/ingest-findings.json` and `ingest-report.md` are products of the old `scripts/ingest_apply.sh`. After M5, no stage writes them. Migration script (extension of `migrate_state_v1_to_v2.sh`, triggered by operator explicitly) archives existing ingest-* products to `artifacts/<project>/archived-products/` and removes them from `state/latest/`. Fresh `make update` runs do not recreate them.
- Update V1_SPEC.md, README.md, SYSTEM_DESIGN.md to reflect new pipeline.

### Migration invariants

- No operator data is destroyed without operator action (archival step is manual).
- Every migration step has a rollback: state migration is reversible via `scripts/migrate_state_v2_to_v1.sh` (M1 deliverable).
- No step makes both the old and new pipeline inoperable simultaneously.
- CLAUDE.md / AGENTS.md / GEMINI.md symlinks unchanged across migration.

## 13. What Changes, What Stays

### 13.1 Replaced

- 5-stage bootstrap pipeline under `agents/bootstrap/01-*` through `05-*`
- Separate `ingest.sh` / `ingest_v2.sh` / `ingest_apply.sh` trio
- Stage-specific instruction files embedding structural prescriptions
- `bootstrap-state.json` → `update-state.json` (schema change)

### 13.2 Updated (not merely unchanged)

These items continue to exist but require code changes to remain functional under the new state schema:

- `scripts/status.sh` — reads `update-state.json` with new schema; outputs gain new stable products (ranking, measurement); falls back to old `bootstrap-state.json` with warning for unmigrated projects
- `scripts/lint.sh` — invokes new validator; writes to `update-state.json.latest_lint_findings` with new schema; same fallback behavior as status
- `scripts/init_project.sh` — emits `project.json` with new fields (`acceptance_questions_path`, `ranking_cutoff`) and without `bootstrap_focuses`; scaffolds `acceptance-questions.md`
- `templates/state/project.template.json` + `templates/pages/*.template.md` — updated to reflect new fields and page contract (including `## Repo pointers` section requirement)
- `scripts/stable_products.py` — extended with `render-validation` + `render-measurement` + `render-ranking` subcommands; handles expanded `validation-findings.json` schema
- `make prune` — updated to prune new artifact layout (unchanged in structure, validated to work with new run dir names)
- `scripts/validate.sh` — extended with new rules (justification signals, ranking references, source classification, commit pointer pending semantics)

### 13.3 Unchanged

- Page category shelves (`architecture/`, `systems/`, `modules/`, `integrations/`, `decisions/`, `runbooks/`, `sessions/`, `glossary/`, `open-questions/`)
- Core style rules (no frontmatter, no meta-narration, ~60-line target, inline citations) — with new carve-out for `index.md` `## Status`
- `state/latest/` stable products layout
- Per-project artifact namespacing (`artifacts/<project>/runs/`)
- `AGENTS.md` ↔ `CLAUDE.md` ↔ `GEMINI.md` symlinks
- Source classification value sets (source_kind, ownership, action) — inherited from prior ingest contract

### 13.4 New

- `scripts/update.sh` — unified entry
- `scripts/migrate_state_v1_to_v2.sh` and reverse `scripts/migrate_state_v2_to_v1.sh`
- `scripts/apply_pending.sh`, `scripts/reject_pending.sh`
- `scripts/apply_commit.sh` (commit pointer advancement, Section 4.6)
- `scripts/validate_stage_configs.py` (validates config.json shape, Section 5.5)
- `agents/update/01-sense/` through `agents/update/07-reconcile/`, each with `config.json`, `instructions.md`, `run.sh`
- `agents/update/_shared/config.py` (config precedence helper) and `_shared/llm_client.py` (stub-aware LLM helper)
- `projects/sample/` — registered test project using `tests/fixtures/sample_repo/` as its repo target
- `state/update-state.json`
- `state/freshness.json` fields: `last_seen_commit`, `last_seen_commit_pending`, `last_update_at`
- `state/pending-approvals/<proposal-id>/` per project
- `projects/<key>/acceptance-questions.md`
- `projects/<key>/.migration-hints/` (from state migration)
- Makefile targets: `make update-v2` (M1, promoted to `make update` at M5), `make measure`, `make measure-tokens`, `make apply-pending`, `make reject-pending`
- `tests/fixtures/sample_repo/`, `tests/fixtures/project_state/`, `tests/fixtures/stubs/`

## 14. Implementation Plan Decomposition

The spec's implementation surface is too wide for one plan. It decomposes into three plans that can be audited, built, and tested independently. Plan transitions map to migration steps M1–M5.

### Plan A — Foundation (covers M1)

- Sense stage: script + mechanical classifier
- Impact stage: ranking sub-task + delta sub-task
- State migration scripts (forward and reverse)
- `tests/fixtures/sample_repo/` + `tests/fixtures/project_state/`
- Update `conftest.py`
- Unit tests for sense and impact; state migration tests
- `scripts/update.sh` scaffolded (supports sense + impact only)
- Deliverable: sense and impact runnable in isolation; state migration tested

Acceptance (after all Plan A deliverables land, including the `make update-v2` Makefile target itself): `make update-v2 PROJECT=sample` completes sense + impact; produces well-formed `sense-report.json`, `ranking-snapshot.json`, `impact-report.json`; tests pass. The Makefile target and `scripts/update.sh` scaffolding must be wired as part of M1 before this acceptance criterion can be evaluated — not a post-plan verification step.

### Plan B — Proposal + apply + safety ladder (covers M2)

- Propose stage with `max_new_pages` and source-classification metadata
- Approve stage (operator interaction)
- Apply stage with pending-approvals split and commit-pointer pending semantics
- `make apply-pending`, `make reject-pending`
- Update `scripts/status.sh` and `scripts/lint.sh` for new state schema
- CLAUDE.md carve-out for index.md `## Status`
- Unit + integration tests for propose, apply, pending flows

Acceptance: `make update-v2 PROJECT=sample` runs end-to-end through apply; pending-approvals flows work; existing tests still pass after state schema changes.

### Plan C — Validate + reconcile + measurement (covers M3 + M4 + M5)

- Structural validator extensions
- Semantic validator (LLM agent)
- Reconcile stage with token budgets and approval model
- `make measure` (full implementation)
- `make measure-tokens` (at minimum: harness skeleton + stub; full harness may land in a follow-up spec)
- Pilot migration runs on `rpg_game` and `sample`
- Promote `make update-v2` → `make update`, delete old entry points (M5)
- Full integration test suite

Acceptance: `rpg_game` rebootstrapped with `make update` scores ≥16/20 on `make measure`; old pipeline fully removed; all tests green.

## 15. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `propose` hallucinates page structure inconsistently | Ranking produced in impact; every unit cites `referenced_ranking_domains` + signals; validator checks both. Ungrounded units rejected |
| Propose generates oversized proposals on first run | `max_new_pages` cap enforced by validator; excess in `deferred_domains` |
| AUTO=1 silently applies wrong page | Destructive + high-uncertainty always gate; post-apply validate loudly surfaces issues; worst case is additive content correctable in next run |
| Agent stages spiral token cost | Per-stage token budget ceilings in `agents/update/<stage>/config.json`; over-budget = clean failure |
| Reconcile over budget on large repos | Dedicated budget in `07-reconcile/config.json` (default 40000 input); failure = operator intervention |
| Rebootstrap loses synthesized content | Migration plan (Section 12) includes mandatory archival step before rebootstrap |
| Migration drops working behavior | No parallel-pipeline claim; M1–M5 staged; state migration tested on sample + rpg_game before pilot |
| Commit pointer poisoning | `last_seen_commit_pending` pattern (Section 4.6); advancement only on validation pass |
| Reconcile-proposal itself fails schema | Explicit halt after one loop (Section 4.5); no infinite retry |
| Batch run aborts halfway through projects | Fail-soft with per-project lock; `update-batch-summary.md` records outcomes |
| Question set drift breaks measurement comparability | `question_set_version` tracked per measurement run |
| State migration corrupts operator data | Reverse migration script + archival; tested against sample + rpg_game fixtures |

## 16. Open Questions

- Should `make update` auto-run `make measure` at the end, or strictly on-demand? (Current design: on-demand.)
- Should the LLM propose-agent suggest new acceptance questions when inbox sources surface uncovered concerns, or is `acceptance-questions.md` strictly operator-owned? (Current design: operator-owned; agent may emit a "candidate questions" list in proposal commentary but does not edit the file.)
- Should the semantic validator be allowed to downgrade the status of a proposal that structurally passes but covers low-ranked domains? (Current design: yes; semantic findings can return `status: fail`.)

---

**End of spec.**
