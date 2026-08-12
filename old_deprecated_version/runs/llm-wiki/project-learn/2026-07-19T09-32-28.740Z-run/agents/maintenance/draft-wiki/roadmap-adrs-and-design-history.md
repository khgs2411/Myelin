# Roadmap, ADRs, and Design History

Myelin's roadmap, ADRs, and design docs form a layered decision record: read the current canonical docs first, use ADRs for append-only decisions, use active design folders for implementation detail, and treat archives as historical evidence unless a current doc explicitly revives them.

## Canonical Reading Path

Start with `docs/README.md`. It names the current reading order and is the best entry point when returning to the repository:

1. `README.md` for operator quick start, commands, runtime, and repo layout.
2. `docs/CLI.md` for exhaustive command behavior.
3. `MYELIN.md` for the canonical product design and north star.
4. `CONTEXT.md` for product vocabulary and resolved naming or shape ambiguities.
5. `docs/IMPLEMENTATION_ALIGNMENT.md` for a snapshot of how the current codebase maps to the V2 product model.
6. `docs/ROADMAP.md` for the canonical implementation checklist, current built status, known gaps, and next step.

`MYELIN.md` is the design authority when product intent conflicts with other prose, except that `docs/adr/*` contains append-only decisions that it summarizes but does not override. `docs/ROADMAP.md` is not the product design; it is the progress tracker against that design. `docs/IMPLEMENTATION_ALIGNMENT.md` is useful orientation, but it is a dated snapshot: when it conflicts with newer roadmap entries or newer dated design docs, prefer the newer evidence and preserve the conflict rather than smoothing it away.

## Roadmap Status Model

`docs/ROADMAP.md` is the single active implementation tracker. Do not create a parallel TODO, DONE, or roadmap file.

Roadmap items use four labels:

- `done`: built and verified.
- `next`: the single active implementation task.
- `open`: known future work that is not active yet.
- `retired`: removed from active direction.

The operational rule is simple: read from top to bottom, and the first unchecked `next` item is the next implementation task. When a `next` item is completed, it should become `done`, and the next smallest item should be promoted to `next`. Non-blocking follow-up work should move into a later step instead of remaining behind in a completed step.

Project Memory should not copy the current active roadmap item into durable documentation. The roadmap is fast-moving working state: use this page to understand the roadmap contract, then open `docs/ROADMAP.md` for the current `next` item and completed/open status. If Project Memory and `docs/ROADMAP.md` disagree about active work, treat `docs/ROADMAP.md` as authoritative and the Project Memory section as stale orientation.

The `Always-On Guardrails` at the end of `docs/ROADMAP.md` are durable constraints: hooks stay fast and fail-open, provider-backed work stays detached and bounded, auto-maintenance must not recursively capture its own provider sessions, SQLite remains serving/recall state rather than curated truth, markdown Project/Practice/Personal memory remains human-reviewable, detached MCP must not import root `src/`, and the live dogfood queue is not something to manually drain as proof of progress.

## ADR Decision Boundaries

ADRs live in `docs/adr/` and are append-only. Newer ADRs may supersede older ones; agents should not edit older records to make them look current. Use `MYELIN.md` section 13 as the thematic decision index, then open the specific ADRs that govern the work.

The currently important decision families are:

- Storage and truth boundary: ADR 0001 keeps one repo-root SQLite DB, ADR 0002 starts Session Memory in SQLite, and ADR 0021 keeps curated Project Memory in markdown plus metadata JSON rather than SQLite.
- Runtime and integration boundary: ADR 0009 adopts Bun/TypeScript, ADR 0011 keeps MCP detached as the agent interface, ADR 0047 quarantines V1 and rewrites the core clean, ADR 0048 makes core own query while MCP consumes stable contracts, and ADR 0051 preserves the BYO multi-provider runner abstraction.
- Product vocabulary and command shape: ADRs 0015-0017 prioritize V2 vocabulary and the `learn`, `ingest`, `query`, and `session` command split; ADR 0050 adopts the Myelin product name while preserving `LLM_WIKI_*` and `mcp__llm-wiki__*` compatibility contracts.
- Project Memory write safety: ADR 0018 allows `project learn` to read the live repo, ADR 0019 makes routine low-risk learn updates auto-apply by default, and ADR 0020 gates risky learn changes.
- Schema and query safety: ADRs 0023-0049 define the global/project schema direction, typed JSON rule approach, schema CLI, schema-context freshness, fail-closed query behavior, and Phase-0 thin global-only schema.
- Current Project Memory documentation direction: ADR 0067 is the latest create-mode decision. It says Project Memory create mode should be agent-authored markdown documentation, not structured JSON page curation.

ADR 0067 is especially important because it supersedes active-looking prior decisions. It supersedes the create/apply/validation portions of ADR 0059, ADR 0063, ADR 0064, and ADR 0065, and partially supersedes ADR 0058. In practical terms: the active create-mode direction is now a planner/index agent plus bounded per-subject writer agents that write markdown in a run-local `draft-wiki/`; Myelin owns orchestration, safe promotion, state metadata, candidate lifecycle, and retrieval indexing. The still-live boundaries are ADR 0021 for markdown truth, ADR 0060 for journal-backed staged promotion and recovery, ADR 0062 for retrieval derived from canonical markdown, and ADR 0066 for explicit clean project-shell rebootstrap while preserving root SQLite memory.

## Active Design Docs

`docs/design/` contains dated specs, agendas, plans, and dogfood records. These files are not all equal. Prefer the latest applicable design plus any ADR that formalized it.

The active design thread for Project Memory creation is `docs/design/2026-07-06-project-memory-agent-authored-documentation/`. Its `spec.md`, `agenda.md`, and `plan.md` are the current implementation design for agent-authored Project Memory documentation. The design says:

- Create mode should document the whole repo and ignore memory candidates.
- First run should compose create mode followed by maintenance mode.
- Later runs should use maintenance mode only.
- The planner agent owns the documentation shape and only `index.md` plus a small subject manifest are required for orchestration.
- Subject writer agents write assigned markdown files directly under the run-local draft wiki and produce `reports/subject-report.json`.
- Myelin must enforce output-root safety, artifact auditability, candidate lifecycle, journal-backed promotion, and derived retrieval indexing, but it must not reintroduce section-count, body-length, citation-count, role-coverage, or answer-domain gates as documentation-shape constraints.

## Step 12 External-Dogfood Identity Conflict

Roadmap Step 12 is the next external-product dogfood gate: rebootstrap continuity-rich Class Kit, then bootstrap a genuinely clean Droplet Bot cohort and exercise the installed create, query, maintenance, and auto-maintenance loop. The two paths intentionally test different state: Class Kit should preserve its existing project-scoped SQLite continuity, while the clean cohort must not inherit it.

The current guidance has an unresolved naming conflict. `docs/ROADMAP.md` says Droplet Bot should be a distinct Myelin project identity rather than reuse the existing `wizepal` SQLite continuity, but `docs/CLI.md` still gives `myelin bootstrap wizepal --repo /Users/liadgoren/Wizepal/droplet-bot` as its bootstrap example. Do not silently treat either wording as the settled clean-cohort key. Resolve the key before the public dogfood run, then update the roadmap and CLI example together.

The sanitized checkout evidence in `repository-identity.json` is also authoritative for this maintenance run: the `llm-wiki` checkout is available on `master` at `afa43fe26e113ee4f0195eb3c474a077a2b1b17e` and has `origin` pointing to `https://github.com/khgs2411/Myelin.git`. Any older statement that this repository has no remote is stale and contradicted by that evidence.

Older design folders remain useful for why the system moved this way. `docs/design/2026-06-23-project-memory-markdown-apply/` records the structured apply and journal-backed write safety work; use it for promotion and recovery intent, but not for the superseded structured page-payload create model. `docs/design/2026-06-28-project-memory-retrieval-quality/` remains relevant for the derived retrieval index, fallback lookup quality, and the rule that SQLite/vector rows point back to canonical markdown. `docs/design/2026-06-30-project-memory-shape-creation-maintenance/dogfood-validation.md` is the key failure record: the 2026-06-30 dogfood was mechanically successful but product-quality failed because the generated wiki was too shallow. `docs/design/2026-07-05-project-memory-rendered-create-contract/` tried to solve that with rendered-section and usefulness gates, but ADR 0067 now supersedes that structured validation direction in favor of agent-authored documentation.

## Archive Boundaries

`docs/archive/` is historical. `docs/archive/README.md` says nothing there is canonical or current. It contains V1 Python/Bash implementation docs, early V2 plans, and superseded designs that were replaced by the TypeScript rewrite and later product decisions.

Archive material is still useful for recovering intent. `docs/archive/V2_SPEC.md` is the raw brainstorming source for the project-rooted memory model, and several archived V1 designs contain ideas that carry forward, such as route repair, query planning, validation warnings, richer MCP metadata, and Obsidian projection. But archived implementation details should not be treated as live code truth. For current truth, return to `docs/README.md`, `MYELIN.md`, `CONTEXT.md`, `docs/IMPLEMENTATION_ALIGNMENT.md`, `docs/ROADMAP.md`, and `docs/adr/`.

## Conflict Resolution Rules

When documentation conflicts, prefer the most authoritative, applicable, current, and verified source:

- Product intent: `MYELIN.md`, with ADRs overriding only through explicit append-only decisions.
- Current implementation task: `docs/ROADMAP.md`.
- Current terminology: `CONTEXT.md`.
- Current documentation map: `docs/README.md`.
- Implementation snapshot: `docs/IMPLEMENTATION_ALIGNMENT.md`, but verify against newer roadmap/design/code because it may be stale.
- Detailed implementation design: the newest applicable `docs/design/<date>-*/` folder, especially when backed by a newer ADR.
- Historical context: `docs/archive/`, only as source material.

Do not average contradictory designs into a third pattern. A concrete example in this snapshot is the Project Memory create-mode contract: older docs describe structured Project Memory apply payloads, answer-domain documentation maps, two-pass evidence workflows, and independent usefulness critique. ADR 0067 explicitly supersedes those create/apply/validation portions, so future work should follow the agent-authored documentation design unless a newer ADR changes it again.

Another example is `docs/IMPLEMENTATION_ALIGNMENT.md`: it says the Project Memory Curator slice stops before meaningful markdown mutation. Later roadmap entries and design validation records show markdown apply, source consumption, retrieval indexing, rendered create-contract work, and then ADR 0067's replacement design. Treat the alignment doc as orientation, not final state, and verify against newer evidence before implementing.

## Practical Orientation For Future Agents

For roadmap or design-history work, start by reading `docs/README.md`, `MYELIN.md`, `CONTEXT.md`, `docs/ROADMAP.md`, ADR 0067, and the 2026-07-06 agent-authored documentation design folder. Then inspect older ADRs and design docs only for the boundary you are touching.

For Project Memory creation work, do not revive the old role-page, answer-domain, or schema-shaped quality gates unless a newer decision explicitly asks for that. The current design wants normal markdown documentation authored in run-local draft files, with Myelin enforcing safety and lifecycle mechanics around that output.

For maintenance or candidate work, remember the division from ADR 0067: create mode ignores candidates and documents the whole repo; maintenance mode owns candidates and runtime inbox intake. Candidate disposition structure is for lifecycle reconciliation, not for shaping documentation content.

For retrieval or query work, keep ADR 0062 in view. Project Memory retrieval rows are derived pointers into canonical markdown, not trusted memory records. Missing, stale, or pending retrieval indexes should degrade serving behavior honestly without moving Project Memory truth out of markdown.
