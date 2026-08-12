# Bootstrap and Ingest Layer Redesign

Date: 2026-04-17
Status: Approved (brainstorm phase), ready for implementation planning

## Context

`llm-wiki` is a local-first second-brain system for the user's software repositories. The goal is to cut agent session bootstrap cost (currently ~100k tokens of codebase exploration per session) by at least 20-30% via durable compiled project memory that future sessions read instead of re-exploring.

This design addresses the **bootstrap and ingest layers only**. Query operations are explicitly deferred until the foundation is stable.

The current implementation has been iterated on for 16 bootstrap runs against a single test project (`rpg_game`) and has converged on a 5-stage compiler pipeline (orient → compile → expand → validate → reconcile). Four structural problems were identified during review:

1. No semantic lint / health-check operation beyond structural validation.
2. Domain-specific vocabulary from `rpg_game` has leaked into the global agent contract (`AGENTS.md`, `V1_SPEC.md`), polluting what should be a repo-type-agnostic system.
3. Scope drift is implicit — the broader "LLM Wiki" reference pattern covers personal/research/book use cases, but this implementation is deliberately codebase-only and that is not documented.
4. Query op deferred (non-issue for this redesign).

Problem 1 (query op) is intentionally out of scope. Problems 2, 3, and scope declaration are addressed here, along with a formal ingest contract that did not previously exist.

## Goals

- Make the global agent contract domain-neutral so any software repository can be wiki'd without fighting RPG-shaped rules.
- Replace structural-only validation with validation that actually judges wiki quality (orphans, dead citations, coverage gaps, redundancy, contradictions, stale claims).
- Formalize the day-to-day ingest flow with explicit fragmentation, provenance, and a human approval gate.
- Declare scope explicitly so future agents and users understand what this system is and is not.
- Preserve the existing 5-stage bootstrap pipeline, directory layout, state file shapes, and inbox workflow — the structural foundation is sound.

## Non-Goals

- Query operations, artifact-to-wiki promotion, MCP surface.
- Embedding / vector search for similarity detection (LLM judgment is sufficient at current scale).
- Automatic contradiction resolution or auto-reconcile on lint findings.
- Multi-source batched ingest (one source per ingest run keeps provenance clean).
- Migration of the existing `rpg_game` wiki. It will be wiped and rebootstrapped under the new contract as the cold test.
- Cross-repo consistency guarantees. Two projects can legitimately produce different wiki shapes.

## Design

### 1. Contract Surface Split: Discipline vs Taxonomy

The global contract (`AGENTS.md`, `V1_SPEC.md`) is restructured so it contains only invariants that hold across any software project. All domain vocabulary and prescribed page names are removed.

**Kept in the contract (discipline):**

- Four-layer mental model: `repo` / `raw` / `wiki` / `state` / `projects`.
- Provenance rules: every durable claim cites `file_path:line` or a preserved source; no invention; contradictions preserved with both sources visible.
- Inbox workflow: global `raw/inbox/` vs project-local inbox, mandatory classification before integration, terminal states (`processed` / `rejected` / `pending-review`).
- Source classification vocabulary: `spec | design | plan | implementation-note | api-doc | reference | session-note | decision-candidate | troubleshooting | unknown`.
- State file shapes: `project.json` (operator-owned with locked fields), `pages.json`, `sources.json`, `relationships.json`, `freshness.json`, `bootstrap-state.json`.
- Page-creation policy: durable, non-redundant, linked from `index.md`, registered in `pages.json`.
- Writing style rules: no meta-narration, no `## Review Provenance` blocks, no `## Purpose` heading leads, no frontmatter in wiki bodies, target around 60 lines per page.
- Changelog and session-memory contracts.
- Escalation rules for high-impact actions.

**Removed from the contract (taxonomy and domain):**

- All named canonical page prescriptions: `system-overview.md`, `runtime-topology.md`, `server-module.md`.
- Architecture page role rules ("owns gameplay loop", "must not become home for auth...").
- The "Server-First Project Contract" section.
- The "Client Coverage Split Contract" including the `character / abilities / overworld / dungeon / battle / quests / inventory / chat` enumeration.
- Any vocabulary referencing gameplay, subscription, multiplayer, or non-player runtime processes as default concepts.

**Kept as the only structural prescription:** the nine category shelves under `wiki/`:

```
wiki/architecture/
wiki/systems/
wiki/modules/
wiki/integrations/
wiki/decisions/
wiki/runbooks/
wiki/sessions/
wiki/glossary/
wiki/open-questions/
```

Every durable page must land in one. The agent chooses filenames and page counts per shelf based on repo evidence. Empty shelves are acceptable.

### 2. Bootstrap Stages, Domain-Neutral

The 5-stage pipeline and its orchestrator (`agents/bootstrap/run.sh`) are preserved. Each stage's `instructions.md` is rewritten to be domain-neutral.

**Stage 1 — Orient.** Produces the minimal shell: `index.md`, one architecture page describing repo shape (what the project is, entry points, main surfaces, tech stack), and initial state files. The architecture page name is agent-chosen from repo evidence — not fixed by the contract. Stage 1 no longer produces `runtime-topology.md` or a "backend landing page" by default; if the repo has a runtime or backend story worth a dedicated page, Stage 2 or 3 will create it under the appropriate name.

**Stage 2 — Compile.** Walk the repo surface and produce durable pages for stable subsystems, modules, and integrations. Instructions describe *when* to create a page (at least two of: stable folder / multiple supporting sources / likely direct query target / conceptually distinct / would otherwise overload another page) but not *which* pages. Page count and granularity are evidence-driven.

**Stage 3 — Expand.** Split pages from Stage 2 that carry multiple stable concepts deserving direct lookup. Generic criteria only; no gameplay or domain examples in the instructions.

**Stage 4 — Validate.** See Section 3.

**Stage 5 — Reconcile.** Unchanged in spirit: fix validation findings without restarting bootstrap. Splits, merges, missing pages, state repair.

**Instruction files may consult `project.json` hints** (`tags`, `bootstrap_focuses`, `entry_pages`) as optional steering. Stage behavior must work correctly against a project with an empty hints section.

**Cold test:** the existing `rpg_game` wiki is wiped and rebootstrapped under the new contract. This validates the pipeline from scratch rather than inheriting old shape.

### 3. Validation With Teeth

Stage 4 is split into two validators. Both must pass for bootstrap to succeed. The same pair is exposed as a standalone `make lint PROJECT=<key>` command for post-bootstrap and post-ingest use.

#### 3a. Structural Validator

Deterministic, script-based (Python / shell), no LLM. Replaces and extends the current `scripts/validate.sh`.

Checks:

- Every `wiki/**/*.md` file is registered in `pages.json`.
- Every `pages.json` entry points to an existing file.
- Every source in `sources.json` has a preserved file under `sources/` or `raw/processed/`.
- Every `derived_pages` reference in `sources.json` resolves to a real page.
- Every link in `index.md` resolves to a real page or a real external path.
- Every endpoint in `relationships.json` exists.
- No wiki page exceeds 150 lines without an explicit reason flag in `pages.json`.
- `changelog.md` has an entry corresponding to the latest bootstrap run.
- `freshness.json` is present and parseable.

Exits non-zero on any failure.

#### 3b. Semantic Validator

LLM-driven, bounded scope. Output is a JSON findings report, not free prose. Findings are written to `state/bootstrap-state.json` under `latest_validation_findings` (bootstrap context) or a new `latest_lint_findings` field (standalone `make lint` context).

Finding categories:

- **Orphan pages** — durable pages not referenced from `index.md` or any other wiki page.
- **Dead citations** — `file_path:line` citations whose target file or line no longer exists (verified via ripgrep against the repo).
- **Redundant pages** — pages whose summaries substantially overlap another page, judged by reading the page summaries from `pages.json`.
- **Overloaded pages** — pages covering multiple stable concepts that should split (heuristic: page exceeds line target and has many distinct H2 sections representing distinct subsystems).
- **Coverage gaps** — top-level repo surfaces (major folders, major features inferred from entry points and build manifests) with no corresponding durable page.
- **Contradictions** — pages making opposing claims about the same entity.
- **Stale claims** — pages whose cited files have changed since the page's `last_reviewed_at`.

Each finding has: `severity` (blocker | warning | info), `page(s)`, `evidence`, `suggested_action`.

**Pass criterion:** zero blocker-severity findings. Warnings and info do not fail the run.

**Default severity mapping:**

- Orphan page → warning (blocker if it is a top-level architecture page).
- Dead citation → blocker if more than a configurable threshold of citations on a page are dead; warning otherwise.
- Redundant pages → warning.
- Overloaded pages → warning.
- Coverage gaps → blocker if the missing surface is a top-level repo directory at the architecture tier; warning otherwise.
- Contradictions → blocker.
- Stale claims → warning.

Thresholds live in `agents/bootstrap/04-validate/config.json` and are adjustable without rewriting the validator.

#### 3c. Standalone Lint

`make lint PROJECT=<key>` runs both validators against an existing wiki outside the bootstrap context. It does not mutate the wiki. Findings are written to the state files and summarized on stdout. Fixing is an explicit separate action (ultimately its own command in a later iteration).

### 4. Ingest Contract

The day-to-day ingest flow is formalized. The input is a single source file; the output is N existing-page updates plus M new pages, each with traced provenance back to the source.

#### Flow

1. **Read and classify.** Agent reads the source and produces the classification outputs already defined in the contract: `source_kind`, `ownership`, `destination`, `update_targets`, `action`.
2. **Decompose.** Agent parses the source into a **unit list** — distinct logical pieces that map to different wiki destinations. For example, a session note covering "worked on 3 systems + 1 new feature" decomposes into 4 units.
3. **Map each unit.** For each unit, the agent either targets an existing page by path or proposes a new page with a path and shelf. The page-creation policy from the contract applies unchanged.
4. **Emit change proposal.** A single file `artifacts/runs/<timestamp>-ingest-<project>/proposal.md` lists every unit, its target (update or create), an edit summary, and the provenance back to the source. No wiki files are modified at this point.
5. **Human approval gate.** The user reviews the proposal in Obsidian or an editor. Approval is explicit: `make ingest-apply PROJECT=<key> RUN=<run-id>`. The user may edit the proposal to reject or modify individual units before applying.
6. **Apply.** Agent executes the approved proposal: edits existing pages, creates new pages, preserves the original source under `projects/<key>/sources/` (or `raw/processed/` for global intake), updates `pages.json` / `sources.json` / `relationships.json`, and appends one changelog entry per touched page.
7. **Post-ingest lint.** `make lint` runs automatically after apply. Findings are written to `state/bootstrap-state.json` under `latest_ingest_findings`. Lint failure does not revert the ingest; the findings surface drift for the next session.

#### Provenance Invariant

Every page touched in step 6 has its `linked_sources` in `pages.json` extended with the source id. Every new page is registered as a `derived_page` for the source in `sources.json`. This guarantees "where did this claim come from" is answerable after ingest.

#### Approval Gate Policy

Default: human approval required. Trusted-source fast path available:

```
make ingest PROJECT=<key> --auto
```

`--auto` skips the proposal gate and applies immediately, reserved for sources the user has already vetted (typically their own session notes). External sources should always go through the gate.

The `--auto` flag must emit a bold confirmation line at apply time listing the number of pages touched and any new pages created, so an inattentive auto-ingest still produces a visible summary.

#### Ingest Non-Goals

- No merging of multiple inbox sources in one run. Process sequentially.
- No auto-reconcile on post-ingest lint findings. Lint is advisory; fixing is separate.
- No deduplication across overlapping session notes. Lint's redundancy detection catches this after the fact.

### 5. Scope Declaration

Documentation-only changes. No code changes.

**`SYSTEM_DESIGN.md`** gains a `## Scope` section near the top with four points:

- `llm-wiki` targets software repositories: services, applications, libraries, games, SDKs, CLI tools, infrastructure.
- Not targeted: personal journaling, research over non-code sources, book companions, trip planning, general-purpose knowledge management.
- The reference "LLM Wiki" pattern covers a broader space; this implementation narrows to repos deliberately, because that is where token savings compound for the primary user.
- Cross-project knowledge that is non-repo (e.g., notes about LLM architecture patterns that apply across projects) is allowed under `concepts/`.

**`README.md`** gains a one-sentence scope line at the top of the introduction.

**`AGENTS.md`** gains a one-line scope preamble in the "System Model" section so agents reading the contract do not default to wiki'ing arbitrary content dropped into `raw/inbox/`.

## File-Level Change Map

| Path | Change |
| ---- | ------ |
| `AGENTS.md` | Remove domain-specific sections (server-first contract, client coverage split, architecture page roles, named pages). Add scope preamble. Keep discipline sections and nine-shelf layout. |
| `V1_SPEC.md` | Same structural edits as `AGENTS.md`. Keep root layout, state file shapes, ingestion contracts, classification contracts. |
| `SYSTEM_DESIGN.md` | Add `## Scope` section. Rewrite stage descriptions to remove domain examples. |
| `README.md` | Add scope line at top. Update any references to removed contract sections. |
| `agents/bootstrap/01-orient/instructions.md` | Rewrite domain-neutral. Remove `runtime-topology.md` and `server-module.md` as default outputs. |
| `agents/bootstrap/02-domain-compiler/instructions.md` | Rewrite domain-neutral. |
| `agents/bootstrap/03-query-expander/instructions.md` | Rewrite domain-neutral. Remove domain-specific expansion examples. |
| `agents/bootstrap/04-validate/instructions.md` | Rewrite as the semantic-validator prompt producing structured JSON findings. |
| `agents/bootstrap/04-validate/config.json` | New file. Severity thresholds for semantic findings. |
| `agents/bootstrap/04-validate/run.sh` | Wire structural validator + semantic validator. Pass requires both. |
| `agents/bootstrap/05-reconcile/instructions.md` | Minor update to consume the new findings shape. |
| `scripts/validate.sh` | Expand to full structural-validator checklist. |
| `scripts/lint.sh` | New file. Runs structural + semantic validators standalone. |
| `scripts/ingest.sh` | Rewrite to implement the classify → decompose → map → proposal flow. Stops before write. |
| `scripts/ingest_apply.sh` | New file. Applies an approved proposal. |
| `Makefile` | Add `lint`, `ingest-apply` targets. Add `--auto` passthrough on `ingest`. |
| `projects/rpg_game/` | Wipe `wiki/` and `state/` (keep `project.json`, `inbox/`, `sources/`). Rebootstrap under new contract. |
| `templates/pages/` | Remove any domain-specific page templates. Keep only generic skeletons per shelf. |
| `templates/state/` | Update if the new severity-threshold config or lint findings fields change shapes. |

## Success Criteria

The redesign is complete when all of the following hold:

- `AGENTS.md` and `V1_SPEC.md` contain zero references to gameplay, abilities, dungeon, battle, quests, inventory, chat, subscription, multiplayer, or server-first framing as default concepts.
- A cold `make init` + `make bootstrap` on `rpg_game` produces a wiki that passes the new structural + semantic validators with no blockers.
- Running `make bootstrap` against a non-game repo (e.g., a backend service or CLI tool the user picks) produces a structurally valid, domain-appropriate wiki without any contract edits between runs.
- `make lint PROJECT=<key>` runs standalone against an existing wiki and writes findings to `state/bootstrap-state.json`.
- `make ingest PROJECT=<key>` on a session note produces a proposal file, does not mutate the wiki, and `make ingest-apply` applies the approved proposal with full provenance tracked in `pages.json` and `sources.json`.
- `make ingest --auto` skips the gate and produces a visible summary at apply time.
- `SYSTEM_DESIGN.md`, `README.md`, and `AGENTS.md` declare the software-repo scope explicitly.

## Open Questions

None blocking implementation. The following are deferred intentionally:

- Concrete token-reduction measurement methodology (requires the query op to be in place to measure A/B).
- Auto-fix commands for lint findings (future iteration).
- MCP surface for wiki access (future iteration).
- Embedding-based similarity for redundancy detection (revisit if LLM judgment proves insufficient at scale).
