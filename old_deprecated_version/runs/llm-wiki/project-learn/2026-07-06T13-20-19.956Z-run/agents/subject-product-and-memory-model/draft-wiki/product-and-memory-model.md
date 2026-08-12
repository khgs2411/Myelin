# Product and Memory Model

Myelin is a local-first project memory system for software repositories: it turns real project work into durable, human-readable memory that future coding agents can query instead of rediscovering the repository from scratch.

## Product Purpose

The canonical product design is `MYELIN.md`. It defines Myelin as a project-rooted memory system for coding agents, built on the LLM Wiki Pattern: raw sources, a maintained markdown wiki, and a schema/instruction layer that teaches agents how to maintain the wiki. The root `README.md` gives the operator-facing summary: Myelin keeps durable project knowledge close to the repo as curated wiki pages, source provenance, freshness state, inbox items, and queryable status.

The product is not a generic RAG system, a code summarizer, or a SQLite session tracker. `MYELIN.md` and `docs/IMPLEMENTATION_ALIGNMENT.md` both draw the same boundary: Myelin should capture what code does not cheaply reveal, such as product behavior, feature intent, operating workflows, decisions, setup gotchas, current state, provenance, and uncertainty. Repo code remains the implementation truth; Project Memory explains the knowledge around that implementation.

`MY_VISION.md` sharpens the product target from the user's perspective. A new agent should begin with recent Session Memory, know that Myelin exists, and query Project Memory when it needs durable project understanding. The example question is concrete: "where is the SQLite database stored in Myelin for a project session memory?" The intended answer should come from living Project Memory documentation and its retrieval index, not from a fresh repo-wide search.

## Memory Layer Hierarchy

Myelin has five memory types, with Project Memory as the root of lived truth:

| Layer | Role | Canonical or serving home |
| --- | --- | --- |
| Project Memory | Curated repo-specific knowledge: behavior, decisions, runbooks, current state, provenance, contradictions, and durable docs | Markdown wiki plus project state metadata |
| Session Memory | Project-scoped continuity: recent work, findings, blockers, next actions, verification, and "do not redo this" notes | Root SQLite `session_memories` and related session state |
| Practice Memory | Cross-project guidance for recurring work, promoted from repeated or selected project evidence | Markdown in target design |
| Personal Memory | Durable guidance about Liad's preferences and collaboration expectations | Markdown in target design |
| Experience Log | Raw captured agent activity used as evidence | Root SQLite event log |

`CONTEXT.md` is the terminology source for these layers. It explicitly says Experience Log is evidence, not truth; Memory Candidates are leads for one target scope, not canonical memory; and Session Memory belongs under a project by default. `schema/rules/memory-scopes.json` mirrors this hierarchy for query results with scopes such as `project_wiki`, `project_session`, `project_state`, `practice`, `personal`, `mixed`, and `none`.

The operating rule from `MYELIN.md` and `docs/IMPLEMENTATION_ALIGNMENT.md` is:

```text
Capture cheaply. Reason rarely. Promote with judgment.
```

Hooks and capture paths should append raw evidence or create candidates. They should not call LLMs directly, mutate curated memory, or turn conversation history into truth.

## Source Of Truth Model

Myelin separates truth, evidence, synthesis, and serving state instead of blending them:

1. `repo/` is implementation truth. Agents still inspect code when verification requires it.
2. `sources/` and Experience Log rows preserve source evidence. Ingest should not rewrite or delete preserved sources as a side effect of synthesis.
3. `wiki/` is synthesized Project Memory: human-readable curated truth, written as markdown.
4. `state/` and root SQLite are machine-readable serving state: routing, freshness, provenance, retrieval indexes, session rows, candidates, handoffs, and queues.

The central invariant is "markdown is curated truth; SQLite is serving state." `MYELIN.md`, `README.md`, `schema/global.md`, and ADR 0067 all preserve that boundary. SQLite can hold trusted Session Memory rows and derived Project Memory retrieval rows, but Project Memory retrieval rows are not themselves Project Memory. They point back to canonical markdown sections and can be rebuilt when stale or missing.

This matters for promotion and reset behavior. ADR 0066 allows an explicit clean Project Memory shell rebootstrap for untrusted dogfood or first-create reset: project shell files under `projects/<key>/` may be deleted and recreated, but the root `state/memory.db` continuity layer is preserved unless the operator asks for a memory wipe. That keeps Session Memory, candidates, handoffs, Experience Log rows, and embeddings available as leads without treating failed wiki output as trusted documentation.

## Promotion Flow

The product-level promotion path is directed:

```text
Experience Log
  -> Session Memory
  -> Project Memory candidates and handoffs
  -> curated Project Memory markdown
  -> Practice / Personal candidates
  -> canonical Practice / Personal Memory
```

Session Memory is recent, project-scoped continuity derived from captured work. It can create higher-layer leads, but it does not directly edit Project Memory. Project Memory candidates are priority signals for `project learn`; they are not write authority. `docs/ROADMAP.md` Step 4 states the boundary plainly: Project Memory is living repo documentation, and candidates are leads that `project learn` must investigate inside the target repo, ground with repo evidence, and turn into canonical markdown only when useful to a future agent.

The current Project Memory creation direction has changed over time. Earlier Step 5 and Step 6 work added sectioned payloads, answer-domain evidence maps, deterministic quality checks, and independent critique. ADR 0067 now supersedes the create/apply/validation parts of that structured JSON approach. Current create mode should use agent-authored draft wiki documentation: a planner/index agent inspects the repo and assigns subjects, bounded subject writer agents write draft markdown files, and Myelin owns orchestration, reports, write boundaries, promotion, state, candidate lifecycle, and derived retrieval.

The non-negotiable promotion boundary remains the same: file-authoring agents may write only run-local draft outputs. They must not write canonical wiki or state directly. Myelin promotes accepted draft outputs atomically and keeps retrieval indexes derived from the promoted markdown.

## Project Memory Quality Bar

The current roadmap warns that mechanical correctness is not enough. Step 6.5 is the active next item: define a vision-quality first-create gate so a foundation-valid wiki is not treated as product-satisfactory Project Memory. The gate should be driven by representative questions from `MY_VISION.md`, precise citations for repo-groundable claims, real provider dogfood, and explicit failure wording when output is only foundation-valid.

This is a product boundary, not only a testing detail. Project Memory exists to save future agents from rediscovering the repo. A page count, heading count, valid JSON report, or successful retrieval index does not prove that the memory is useful. Trusted Project Memory should answer real product and implementation-orientation questions from canonical markdown or markdown-backed query results.

## Current Implementation State

The root runtime is a Bun/TypeScript CLI exposed as `myelin`, with commands described in `README.md` and `docs/ROADMAP.md`. The built foundation includes project shells, provider-backed Experience Log ingest into Session Memory, Session Memory embedding/indexing, Project Memory candidate intake, markdown apply mechanics, source-consumption reconciliation, and derived Project Memory retrieval indexing.

The important current gap is not the existence of plumbing. The roadmap says the latest dogfood showed Project Memory still needs a vision-quality gate and live proof before candidate-driven maintenance resumes. Until that gate passes, current Project Memory output should be treated cautiously: it may be structured and queryable without yet being trusted living repo documentation.

## Evidence

- `MYELIN.md` defines the canonical north star, memory model, four-layer source-of-truth model, capture/promotion policy, and non-goals.
- `CONTEXT.md` defines product language for Project, Session, Practice, Personal Memory, Experience Log, Memory Candidates, runtime inbox, and Project Memory quality concepts.
- `README.md` summarizes the CLI, repository layout, runtime, compatibility contracts, and local-first product status.
- `docs/IMPLEMENTATION_ALIGNMENT.md` maps the implementation to the product hierarchy and notes which surfaces are foundation, partial, legacy-shaped, or risky to extend blindly.
- `docs/ROADMAP.md` is the current progress tracker; Steps 4 through 6.5 are the most current source for Project Memory quality and vision-gate state.
- `MY_VISION.md` records the intended day-to-day product behavior and concrete query scenarios that Project Memory must satisfy.
- `schema/global.md` and `schema/rules/*.json` define schema guidance, memory scopes, page taxonomy, source classification, and provenance expectations.
- `docs/adr/0066-allow-clean-project-shell-rebootstrap-reset.md` and `docs/adr/0067-use-agent-authored-project-memory-documentation.md` record current decisions for reset boundaries and agent-authored Project Memory creation.
