# Project Memory Curator Design

Status: Working draft. Not approved for implementation planning yet.

## Goal

Design the Project Memory layer as the next layer above Session Memory.

Project Memory is the durable, curated understanding of one software repository. It should be created and maintained by an agent running from the target repository, with access to the codebase, existing Project Memory, and the downstream handoff/candidate records produced by Session Memory ingest.

The design should also establish the reusable promotion pattern for Practice Memory and Personal Memory, while keeping those domains out of this implementation slice.

This layer is agent-facing first. Markdown is the canonical format because it is inspectable, auditable, portable, and useful for occasional human confirmation, not because the operator is expected to approve routine memory changes.

Karpathy's LLM Wiki pattern remains the product anchor: immutable sources, an LLM-maintained markdown wiki, and a schema/instruction layer that teaches agents how to maintain it. Myelin should preserve the compounding wiki idea while hardening it for autonomous coding agents, branch applicability, provenance, and machine-safe retrieval.

Research intake in `docs/research/2026-06-18-agentic-memory-landscape.md` sharpens the core model: Project Memory should be governed evidence-backed wiki compilation, not an autonomous free-form wiki gardener.

## Current Context

Project Memory already has a canonical home:

- Markdown pages under `projects/<key>/wiki/`.
- Project metadata, freshness, page catalogs, and routing state under `projects/<key>/state/`.
- Optional preserved project source/evidence under `projects/<key>/sources/` when source material exists.
- Operational run artifacts under `projects/<key>/runs/` and `projects/<key>/log/`.

The current `bootstrap` implementation creates a Project Memory shell only. It creates the project directories, `state/project.json`, a placeholder `wiki/index.md`, and `state/bootstrap-state.json` with `curated_project_memory` marked missing. This matches the glossary boundary that bootstrap creates a shell, not curated Project Memory.

The current Session Memory ingest path is intentionally one hop:

- It processes Experience Log rows into trusted Session Memory.
- It can create `memory_candidates`.
- It can create Project, Practice, and Personal handoff instructions.
- It does not mutate curated wiki pages.

The storage substrate for this next layer already exists in part:

- `memory_candidates` supports `session`, `project`, `practice`, and `personal` scopes.
- `project_handoff_instructions`, `practice_handoff_instructions`, and `personal_handoff_instructions` already exist.
- Candidate and handoff records have status, source references, risk, confidence, reason, and prompt text or proposed payload.

The current `project learn` pipeline is a scaffold, not the finished Project Memory Curator. It runs LLM stages and writes run/freshness artifacts, but the apply stage does not yet perform meaningful focused wiki updates. The next design should not extend that scaffold blindly.

The current `memory query` command is Session Memory vector retrieval only. Older project-wiki query planning exists as a seed for Project Memory lookup, but it is not the full multi-layer query facade.

The agentic-memory landscape review changes this design's center of gravity:

- Keep the product-facing layers as scopes and policies.
- Do not implement Project, Practice, and Personal Memory as independent memory engines.
- Use shared lifecycle, provenance, applicability, authority, taint, assurance, and retrieval semantics underneath.
- Treat markdown pages as canonical subject pages with addressable evidence-backed entries, not unrestricted prose edited directly by a model.

The Karpathy origin pattern adds an important product constraint: do not let the Project Memory layer collapse into generic vector RAG, raw codebase documentation, or opaque SQLite state. The durable wiki is the compiled project brain. The hardening work is about making that wiki safe for agents to maintain and query autonomously, not replacing it.

## Product Boundary

Project Memory is canonical curated truth for one project. SQLite can queue, retrieve, and serve derived state, but it is not the canonical Project Memory record.

The canonical shape should be subject-oriented wiki pages. Architecture should split into architecture subjects, setup into setup subjects, testing into testing subjects, and so on. A durable fact should live where an agent would naturally look for it.

Within those pages, important durable statements should be addressable entries with stable IDs, evidence, applicability, lifecycle, and validation state. These entries are not a second user-facing wiki. They are the machine-checkable structure inside the canonical subject pages.

This intentionally extends the origin LLM Wiki pattern. Free-form agent-maintained pages are valuable for reading, but they are too weak as the only structure for autonomous maintenance because duplicate facts, stale branch-specific statements, and unsupported instructions can merge cleanly at the text level while still corrupting the agent's working context.

Human-readable Project Memory does not imply human-operated Project Memory. Agents are the primary consumers through query, how, status, and curated context loading. The operator may inspect the markdown when desired, but the default maintenance path must be self-maintaining through validation, provenance, and fail-loud degraded states.

Session Memory remains project-scoped continuity:

- recent work
- decisions
- next actions
- blockers
- verification facts
- downstream handoff instructions

The Session Memory agent should not become a Project Memory curator. It may identify that something probably belongs in Project Memory, but the Project Memory Curator owns:

- whether the fact is already documented
- which canonical page should change
- whether evidence is sufficient
- whether the change is routine, risky, stale, conflicting, or requires stronger autonomous assurance
- how page metadata, freshness, and provenance should be updated

The Project Memory Curator should not receive "all SQLite data" as one undifferentiated prompt. It should receive a bounded curator packet assembled from scoped records and stable project context.

The curator should produce typed mutation plans. Trusted runtime code validates, stamps, and publishes those plans. The model must not self-assign source authority, verification status, protected metadata, branch applicability, or publication state.

## User-Facing Behavior

### Creation Mode

After a project is bootstrapped, Myelin should support a Project Memory creation run.

Bootstrap creates the Project Memory shell, not the brain:

```text
projects/<key>/
  readme.md
  index.md
  wiki/
    index.md              # placeholder: Project Memory has not been curated yet
  state/
    index.md
    project.json
    bootstrap-state.json  # status: uncurated
  log/
    index.md
    changelog.md
  runs/
    index.md
```

The first successful `project learn <key>` creates the initial Project Memory brain inside the same project shell. The exact subject pages depend on the repository, but the shape should look like:

```text
projects/<key>/
  readme.md
  index.md
  wiki/
    index.md
    architecture/
      index.md
      <subject>.md
    setup/
      index.md
      <subject>.md
    testing/
      index.md
      <subject>.md
    decisions/
      index.md
      <subject>.md
  state/
    index.md
    project.json
    bootstrap-state.json
    project-memory.json
    schema-context.json
    pages.json
    freshness.json
  log/
    index.md
    changelog.md
  runs/
    index.md
    project-learn/
      index.md
      <run-id>/
        index.md
        input-packet.json
        mutation-plan.json
        validation.json
        run.log
        summary.md
```

Every created folder must have an `index.md` so the project works well in Obsidian and is navigable by agents. Project-local `schema/` and preserved `sources/` are lazy directories: create them only when project-local schema rules or preserved external source material actually exist. The curator should create only subject folders/pages that carry real durable value for that repository. It should not mirror the repo tree, and it should not create a separate folder of detached memory facts for material that naturally belongs under architecture, setup, testing, decisions, workflows, or another subject.

The creation run:

1. Runs from the target repository cwd, not the Myelin repo.
2. Reads the repo codebase and project-owned Myelin shell.
3. Reads any existing Project Memory pages if the project was partially curated before.
4. Reads a bounded set of project-scoped candidates, project handoff instructions, Session Memory, source references, and project state.
5. Produces initial curated Project Memory subject pages that describe behavior, architecture decisions, setup/runbooks, current state, and provenance without mirroring the repo tree.
6. Updates state so the project no longer looks completely uncurated, or records exactly why creation degraded.

Bootstrap should remain the low-level shell creation contract. The product also needs a higher-level brain creation workflow so the operator does not have to manually run every layer for every project.

Resolved direction:

- `bootstrap` creates or repairs the Project Memory shell and capture routing.
- `project learn <key>` creates the initial Project Memory brain when the project has a shell but no curated brain yet, and maintains Project Memory when a brain already exists.
- `project onboard <key> --repo <path>` runs shell bootstrap first and then starts `project learn` sequentially.

This creates three operator paths:

- Existing shell, missing brain: run `project learn <key>`.
- New project, shell only: run `bootstrap <key> --repo <path>`.
- New or retroactive project, ready for full setup: run `project onboard <key> --repo <path>`.

The important contract is that shell creation must not fail just because agentic brain creation degrades, while full onboarding should make the agentic continuation visible and inspectable.

### Maintenance Mode

Project Memory maintenance consumes new Project Memory handoffs and candidates created by Session Memory ingest.

A maintenance run:

1. Acquires a project-level curator lock.
2. Builds a bounded input packet from pending project handoffs, project candidates, selected Session Memory, existing Project Memory pages, page metadata, and project state.
3. Runs a curator agent in the target repo cwd.
4. Verifies durable page entries against repo files, preserved source evidence, existing Project Memory, and cited Session Memory.
5. Updates the smallest canonical page or page section that makes the knowledge reusable.
6. Marks consumed handoffs/candidates as processed, rejected, deferred for autonomous reconciliation, or degraded with output references and reason.
7. Refreshes page metadata, freshness, and derived indexing state as needed.

Maintenance should be automatic behind debounce, budget, and locking rules. Operators also need an explicit command for immediate runs and recovery, but normal correctness should come from autonomous validation, deterministic checks, provenance, and fail-loud degraded states rather than operator approval.

## Technical Design

### Curator Job Model

The Project Memory Curator is a bounded agentic job with two modes:

- `create`: initial Project Memory creation for a shell or partially curated project.
- `maintain`: incremental Project Memory updates from pending handoffs/candidates and project evidence.

The design uses two user-facing surfaces above the existing low-level `bootstrap` command:

- `project learn <key>` creates the initial Project Memory brain for an already bootstrapped project, then becomes the ongoing Project Memory maintenance command after creation.
- `project onboard <key> --repo <path>` creates the shell and then runs `project learn`.

The CLI keeps `brain` as user-facing product language rather than a new top-level namespace. Output text can say "creating project brain" or "project brain ready", but the command vocabulary stays under `project` because the layer being created is Project Memory.

Regardless of command name, the internal boundary should be a Project Memory Curator service, not generic pipeline stages.

### Governed Page Entry Model

Project Memory should be compiled from evidence into subject pages with addressable entries.

The page is the human and agent reading surface. The entry is the smallest page section that Myelin can validate, update, supersede, or mark stale without rewriting unrelated page content. This keeps the LLM Wiki product shape while giving autonomous agents stable IDs, provenance, applicability, lifecycle, and contradiction handling.

An addressable page entry should carry:

- stable ID
- scope and applicability: project, branch, worktree, commit range, version range, paths, symbols
- cognitive type: episodic, semantic, procedural, policy
- epistemic role: evidence, signal, assertion, inference, instruction
- source authority
- source taint
- evidence references
- verification references
- lifecycle status
- valid-time and transaction-time metadata
- supersedes / contradicts / depends-on relations
- retrieval and usage telemetry hooks

Initial lifecycle states:

- `candidate`
- `active`
- `stale_pending`
- `disputed`
- `superseded`
- `retracted`
- `quarantined`
- `rejected`

This keeps important distinctions explicit:

- `superseded`: once valid, later replaced
- `retracted`: should not have been treated as valid
- `stale_pending`: source dependencies changed and revalidation is required
- `disputed`: credible conflicting evidence exists
- `quarantined`: unsafe, malformed, tainted, or unresolved high-risk content

Markdown remains canonical, but it should be structured enough for deterministic validation and index rebuilds. The serving layer can derive SQLite rows, FTS entries, vectors, relations, scores, and telemetry from canonical markdown.

### Mutation Plan Boundary

The curator should produce typed mutation plans rather than directly rewriting arbitrary markdown.

Allowed operations:

- `CREATE`
- `PATCH`
- `SPLIT`
- `MERGE`
- `ATTACH_EVIDENCE`
- `REVALIDATE`
- `SUPERSEDE`
- `RETRACT`
- `MARK_STALE`
- `MARK_DISPUTED`
- `QUARANTINE`
- `NOOP`

Each plan should include target page paths, target entry IDs when applicable, proposed content, evidence references, applicability, preconditions, expected document hashes, and risk features.

Runtime-owned validation must enforce:

- schema validity
- stable-ID uniqueness
- legal lifecycle transition
- all source references resolve
- project/worktree/branch/commit consistency
- expected document hashes
- markdown parsing
- path/symbol/test/command existence when referenced
- relation integrity
- secret and sensitive-data scanning
- duplicate and near-duplicate detection
- contradiction lookup
- mutation and token budgets
- protected metadata enforcement

The curator job should record:

- project key
- mode
- target repo path
- provider/session id
- input packet reference
- output references
- changed wiki/state files
- status
- degraded reason or assurance failure reason
- started/finished timestamps

The curator must run with the target repository as cwd so the agent can inspect code and local instructions. Myelin should still own the input packet, output schema, status writes, and candidate/handoff lifecycle updates.

### Curator Input Packet

The curator input should be an explicit, scoped, auditable packet. Routine curator runs should not receive all SQLite data or unrestricted database access.

Inputs should include:

- project identity from `state/project.json`
- target repo path and git metadata
- mode and objective
- current bootstrap/freshness/status state
- selected existing Project Memory pages and page metadata
- pending `project_handoff_instructions`
- pending project-scoped `memory_candidates`
- selected source Session Memory rows referenced by handoffs/candidates
- tombstone/source references needed to audit evidence
- compact recent Session Memory only when it affects candidate interpretation
- current Project Memory lookup results for candidate topics
- allowed write assurance policy for the run

Inputs should not include:

- all raw Experience Log rows
- all Session Memory rows
- all SQLite tables
- unrelated Practice or Personal candidates
- unbounded transcripts

The packet builder should own prompt budgeting. If there are too many pending items, it should split work into batches and preserve ordering/reasoning in the job state. Narrow live tools can be added later only for concrete curator needs that the packet cannot satisfy.

### Curator Reasoning Rules

For each project handoff or candidate, the curator should classify the outcome:

- already documented
- update existing page
- create new canonical page and update index
- stale or contradicted by repo reality
- insufficient evidence
- belongs to another layer
- requires autonomous validation or reconciliation
- no durable Project Memory value

Routine updates should prefer existing canonical pages. New pages should be created only when the taxonomy supports a stable project-memory surface.

Project Memory should capture:

- product or system behavior
- feature intent
- architecture decisions
- setup and runbook knowledge
- current state and known gaps
- manual QA or verification flows
- provenance and source history

Project Memory should avoid:

- raw transcript summaries
- generic codebase inventory an agent can cheaply inspect
- speculative architecture statements
- source material mixed into synthesized wiki prose
- Practice or Personal guidance

### Session-To-Project Boundary

The Session Memory layer should avoid obvious duplicate Project Memory work, but it must not become a Project Memory curator. The resolved boundary is a cheap deterministic Project Memory existence check, not full Project Memory curation.

Resolved shape:

- Session ingest asks a deterministic Project Memory lookup facade whether a candidate topic appears already documented.
- The lookup returns `known`, `possibly_known`, `not_found`, or `degraded`, with page citations.
- Session ingest can use that as a hint to suppress obvious duplicate handoffs or mark a handoff as "verify/update existing page".
- The Project Memory Curator still decides whether the wiki is current and whether a change belongs.

This avoids mixing responsibilities while still reducing queue noise.

### Project Memory Lookup And Query

Project Memory needs two read surfaces:

- a maintenance lookup surface for curators and Session ingest
- a user/agent query surface for answering project questions

Both should treat markdown Project Memory as canonical. Metadata, text chunks, and vectors are derived indexes over the markdown pages, not replacements for them.

The maintenance lookup surface can start with deterministic page metadata and text search over `projects/<key>/wiki/`, then evolve toward chunked vector recall. It should return citations and degraded state rather than pretending absence from an index means absence from Project Memory.

The user-facing multi-layer `query` facade can later route across Project Memory, Session Memory, Practice Memory, Personal Memory, and state. This design does not implement that full facade, but Project Memory lookup should be compatible with it.

Hard applicability gates must run before relevance ranking. A semantically strong memory from the wrong branch, worktree, commit range, lifecycle state, or taint policy is not a valid current-memory result.

Candidate generation should use independent channels:

- exact ID/path/symbol/error/test/commit lookup
- FTS/BM25
- vector similarity
- relation expansion
- recent Session Memory only when the query mode asks for current work

Initial query modes should be explicit in the internal API:

- `current_state`
- `why`
- `how_to`
- `what_failed`
- `verification`
- `still_true`
- `pre_action`
- `historical`

### Autonomous Write Assurance Policy

Project Memory should maintain itself. The default path is autonomous apply with strong assurance, not human approval.

The write policy should distinguish human-auditable from human-operated:

- routine, well-sourced updates auto-apply after validation
- every applied change records provenance, source evidence, affected candidates/handoffs, before/after hashes, and validation results
- broad rewrites, conflicting evidence, decision-record changes, destructive deletes, and low-confidence synthesis do not ask the operator by default
- high-risk changes route to stronger autonomous assurance: narrower packets, independent validator pass, deterministic schema/page checks, repo evidence re-read, and reconciliation
- if assurance still fails, the curator leaves a degraded or quarantined state that agents can see and work around, instead of silently writing questionable Project Memory
- explicit `--review` or `--dry-run` may exist for debugging, audits, or deliberate operator control, but they are not the daily product path
- every skipped, rejected, deferred, or quarantined change records why and what evidence would unblock autonomous processing

The curator should never silently discard pending inputs. Every consumed handoff/candidate ends in a terminal or explicitly deferred status.

### Reusable Promotion Pattern

Project, Practice, and Personal Memory should share the same high-level pattern:

```text
Session Memory interpretation
  -> scoped candidate or layer handoff
  -> layer-specific curator/promoter
  -> canonical markdown memory
  -> derived lookup/index state
```

The domain rules differ:

- Project Memory subject: one repository.
- Practice Memory subject: repeatable cross-project workflows, tools, frameworks, deployments, and implementation practices.
- Personal Memory subject: Liad's durable preferences and agent behavior expectations.

This design should establish the shared handoff/curator/index lifecycle without pretending that Practice and Personal canonical homes are already designed.

## Data / State

Canonical Project Memory state:

- `projects/<key>/wiki/**`
- `projects/<key>/state/page-metadata.json`
- `projects/<key>/state/pages.json`
- `projects/<key>/state/freshness.json`
- `projects/<key>/state/bootstrap-state.json`
- optional `projects/<key>/sources/**` when preserved source material exists
- `projects/<key>/log/changelog.md`

SQLite queue and continuity state:

- `session_memories`
- `memory_candidates`
- `project_handoff_instructions`
- `experience_event_tombstones`
- derived Session Memory vector state

Likely new or evolved state:

- Project Memory curator job/run metadata.
- Candidate and handoff processed output references.
- Project Memory chunk/index metadata for derived lookup.
- Curator locks and maintenance scheduling state.

The exact schema is an implementation-planning concern, but the design requires terminal lifecycle state for each consumed input.

## Integrations

Likely integration points:

- `bootstrap`: creates shell and capture routing only.
- `project learn`: creates initial curated Project Memory for an existing shell, then maintains it after creation.
- `project onboard`: runs bootstrap and then `project learn` sequentially.
- `ingest`: continues producing Session Memory and downstream handoffs only.
- `memory candidates`: lists and inspects candidate records.
- handoff repositories: need list/show/process helpers for Project Memory.
- `project learn`: either evolves into the Project Memory Curator or becomes a compatibility wrapper around it.
- `query`: later routes across Project Memory and Session Memory through layer-specific facades.
- `status`: should expose uncurated, partially curated, current, degraded, and pending-curation states.
- Practice and Personal future promoters: should reuse the same lifecycle shape with different canonical homes and promotion rules.

## Error Handling

The curator should fail loud and leave inspectable state.

Failure cases:

- target repo path missing or not readable
- no provider available
- prompt/input packet too large
- candidate/handoff batch cannot be fully represented
- existing Project Memory conflicts with repo evidence
- proposed page change is broad or low confidence
- proposed mutation lacks entry-level evidence or applicability
- source taint attempts to cross into an unauthorized scope
- page metadata/index refresh fails
- derived vector/index refresh fails
- lock already held by another curator job

Canonical wiki writes should not be partially trusted if validation fails. If markdown files changed but metadata refresh failed, status should report degraded state and the changed files should remain visible in the run artifact.

## Testing Strategy

Future implementation should verify:

- bootstrap still creates only the shell unless the chosen creation trigger is enabled
- creation mode can produce initial Project Memory from a fixture repo and bounded packet
- Project Memory page entries preserve evidence, applicability, lifecycle, and verification metadata
- curator outputs typed mutation plans instead of direct arbitrary markdown rewrites
- deterministic validation rejects illegal lifecycle transitions, missing evidence, taint violations, and protected metadata self-assignment
- maintenance mode consumes project handoffs/candidates and updates the smallest expected wiki surface
- already-documented facts do not produce duplicate pages
- risky/conflicting candidates route to autonomous validation, reconciliation, degraded, or quarantine states instead of silently applying
- candidate/handoff lifecycle state records processed/rejected/deferred outcomes
- Project Memory lookup cites markdown pages and degrades honestly when metadata/indexes are missing
- derived indexing failure does not invalidate canonical markdown
- curator locking prevents concurrent writes for one project
- status reports uncurated, pending, running, degraded, and current states

Repo-native verification should remain:

```bash
bun test
bun run typecheck
git diff --check
```

## Planning Boundary Guidance

This design should split into focused implementation chunks later:

- Project Memory Curator command/service and run state.
- Project Memory page-entry schema and lifecycle state machine.
- Mutation plan schema and deterministic validator.
- Source authority, taint, and cross-scope write policy.
- Curator input packet builder and prompt budget controls.
- Project handoff list/show/process helpers.
- Project Memory lookup over markdown and page metadata.
- Controlled autonomous wiki update/apply path with provenance, validation, reconciliation, and degraded/quarantine states.
- Bootstrap creation trigger policy.
- Maintenance scheduler with lock, cooldown, budget, and explicit command.
- Project Memory derived index/backfill hooks.
- Status/query integration.
- Documentation and fixture validation.

Do not combine Project, Practice, Personal, full multi-layer query, and curator scheduling into one implementation plan.

## Acceptance Criteria

- A bootstrapped project can move from shell-only to initial curated Project Memory through the chosen creation trigger.
- Project Memory maintenance can consume pending project handoffs/candidates from Session Memory output.
- Project Memory is compiled into subject pages with addressable entries carrying evidence, applicability, lifecycle, authority, taint, and verification metadata.
- Curator model output is a mutation plan; trusted runtime code validates, stamps, and publishes canonical markdown.
- Session Memory remains responsible for continuity and downstream instructions, not curated wiki mutation.
- Project Memory markdown remains canonical; SQLite records are queues, continuity, and derived serving state.
- Curator outputs preserve provenance and terminal lifecycle status for each consumed input.
- Duplicate or already-documented candidate topics are handled without generating noisy wiki changes.
- Risky, broad, or conflicting updates do not silently apply; they route through autonomous assurance or fail loud into degraded/quarantined state.
- The design leaves a reusable promotion pattern for Practice and Personal Memory without implementing those layers in this slice.

## Assumptions

- The target repo is the best context for Project Memory curation.
- Project Memory should remain compact, behavior-focused, and provenance-backed.
- The current candidate/handoff schema is directionally correct but may need lifecycle/output-reference extensions.
- Existing project wiki metadata can be reused as a starting point, but it should not constrain the final Project Memory Curator design.
- Some existing wiki pages may need migration into structured subject pages with addressable entries.
- Practice and Personal canonical homes remain deferred until Project Memory curation proves the shared lifecycle.

## Open Questions

- Should bootstrap automatically start Project Memory creation, expose it behind an explicit flag, or only print the next command?
- How much Project Memory lookup should Session Memory ingest perform before creating project handoffs?
- Should the curator receive only scoped packets, or should it have live read access to broader SQLite state?
- What autonomous assurance pipeline should replace human review as the normal safety gate?
- What is the Phase 1 Project Memory page structure: flat subject pages, subject folders, or another subject taxonomy?
- What lifecycle states must be implemented before broad autonomous Project Memory curation is allowed?
- What trigger threshold should start automatic maintenance?
- What is the first Project Memory lookup/index implementation: metadata/text search, vector chunks, or both?
- Is Current Briefing a Project Memory artifact, a status/query facade output, or a separate state product?
