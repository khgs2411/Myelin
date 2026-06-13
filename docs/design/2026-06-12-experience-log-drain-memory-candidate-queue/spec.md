# Agentic Ingest And Memory Candidate Queue Design

Status: Externally audited and ready for implementation roadmap planning.

## Goal

Design the first processing path after raw hook capture: `myelin ingest <project-key>` starts a bounded, detached agentic workflow in the target repository, gives the ingest agent tools to pull and process `experience_events`, records tombstones as audit trail, and lets the agent decide what Session Memory or downstream layer inputs to create without treating raw captured text as trusted truth.

The slice exists to answer one product question: after Codex hooks create raw Experience Log evidence, how does Myelin grow Session Memory first and then derive higher memory-layer work safely?

## Current Context

This design assumes the approved bootstrap and Codex hook capture slice lands cleanly.

Relevant current substrate:

- `state/memory.db` is the root SQLite serving/state database.
- `src/memory/migrations.ts` defines `experience_events`, `hook_errors`, and `experience_event_tombstones`.
- `src/memory/experience.ts` provides helpers for recording Experience Log rows and tombstoning processed rows.
- `projects/<key>/state/project.json` stores project routing metadata, including `repo_paths`.
- `projectForRepoPath` in `src/runtime/projects.ts` resolves a local cwd to a bootstrapped project.
- Existing session storage exists in SQLite through `sessions` and `session_events`, but the current session event kinds are manual-session oriented: `note`, `decision`, `finding`, `followup`.
- Existing `memory query` is an answer surface, not a memory-maintenance surface.
- Existing `project ingest` and `project learn` are pipeline commands. `project ingest <key>` remains the queued source/inbox processing command. This design adds top-level `myelin ingest <project-key>` as the public orchestration surface for the detached agentic Experience Log to Session Memory pipeline, while still keeping internal stages bounded and reviewable.

Current repository/data layout evidence:

- Runtime code is rooted in `src/`, grouped by product/runtime domains such as `commands`, `runtime`, `memory`, `capture`, `install`, `pipeline`, `query`, and `schema`.
- Project-owned data is rooted in `projects/<key>/` with `sources`, `wiki`, `schema`, `state`, `log`, and `runs`.
- Root `state/memory.db` is the generated SQLite serving, event, queue, and session substrate, partitioned by `project_key`.
- `MYELIN.md` distinguishes five memory types from four storage layers. Project Memory is canonical markdown under project `wiki/`; Session Memory and Experience Log are SQLite; Practice and Personal Memory are canonical markdown concepts that still need a clear home.
- `AGENTS.md` still uses the older four-layer storage framing (`repo`, `raw/sources`, `wiki`, `state`), while `MYELIN.md` and `CONTEXT.md` define the five memory-type product model.

Relevant roadmap stubs:

- `.tasks/04-capture-and-candidates/memory-candidate-queue.md`
- `.tasks/04-capture-and-candidates/trigger-modes.md`
- `.tasks/02-session-memory/session-event-contract.md`
- `.tasks/03-project-memory/project-memory-update-candidate.md`
- `.tasks/07-practice-memory/practice-candidate.md`
- `.tasks/08-personal-memory/personal-preference-candidate.md`
- `.tasks/10-pipeline-and-audit/project-ingest-flow.md`

Referenced retrieval docs:

- `sqlite-vec` JavaScript docs: <https://alexgarcia.xyz/sqlite-vec/js.html>
- `sqlite-vec` repository: <https://github.com/asg017/sqlite-vec>
- Gemini embeddings JavaScript docs: <https://ai.google.dev/gemini-api/docs/embeddings#javascript>

## Product Boundary

This slice creates the first agentic layer above raw evidence. The ingest agent runs from the target repository context, pulls raw Experience Log rows plus existing Myelin memory surfaces through tools, decides what Session Memory is worth creating, and writes output that can later feed Project, Practice, and Personal Memory.

It does not:

- mutate `wiki/` pages
- create canonical Practice Memory
- create canonical Personal Memory
- apply Project Memory updates
- summarize whole sessions into final durable prose
- delete raw Experience Log rows without a tombstone
- run unbounded or recursive agentic work

It may:

- invoke a bounded ingest agent
- let the ingest agent pull Experience Log rows in batches until the queue is empty
- let the ingest agent decide what Session Memory, Memory Candidates, and Layer Handoff Instructions to create
- create candidate records
- enqueue downstream project/practice/personal layer work when the session-level interpretation finds useful signal
- mark rows no-op/rejected when they are not useful
- tombstone processed rows with durable output references
- expose candidate list/show commands for review

## User-Facing Behavior

The initial operator flow should be explicit and non-blocking:

1. Capture has already written raw Experience Log rows for a bootstrapped repo.
2. The operator runs `myelin ingest <project-key>`.
3. Myelin starts a background/headless provider session for the ingest run and returns a durable handle immediately.
4. Myelin launches the provider session with cwd set to the target repo path, on `master` for this version.
5. The ingest agent receives a strong prompt plus tools for pulling Experience Log rows, querying/writing Myelin memory, and creating downstream handoff inputs.
6. The ingest agent pulls Experience Log rows in batches until the queue is empty.
7. Myelin automates the queue-drain bookkeeping around pulled rows and records tombstones as the audit trail.
8. The ingest agent decides what Session Memory, session candidates, and Project/Practice/Personal handoff inputs to create.
9. The operator can later inspect status or follow up using the returned job/session handle.

First command shape:

```text
myelin ingest <project-key> [--limit N] [--json]
myelin ingest status <ingest-job-id> [--json]
myelin memory candidates <project-key> [--status pending|needs-review|processed|rejected] [--scope session|project|practice|personal] [--json]
myelin memory candidate show <candidate-id> [--json]
```

These command names are fixed for this design slice. `myelin ingest` is the public command that starts the fixed agentic ingest pipeline as a detached/background provider session. `myelin ingest status <ingest-job-id>` is the first status surface. Narrower internal modules own Experience Log row access, Session Memory writes, candidate creation, tombstoning, and downstream queue writes, but they are not separate product commands.

`--limit N` limits the maximum number of Experience Log rows the ingest job may claim from `experience_events`. It does not limit batches, Session Memory outputs, Memory Candidates, or handoff records. If omitted, the ingest agent pulls bounded batches until the active queue for that project is empty.

Candidate status storage uses underscore enum values such as `needs_review`. Human CLI filters may accept the hyphenated alias `needs-review` and normalize it before querying; JSON output should return the stored enum value.

`--dry-run` is not required for the first version. The stronger product requirement is that an explicit `myelin ingest <project-key>` invocation starts useful work without tying up the terminal. Preview behavior can be reconsidered later if operators need it, but it should not define the primary workflow.

## Architecture / Data Homes

This slice keeps the current V2 storage-layer layout stable. Memory types map onto the existing storage substrate; the filesystem should not be reorganized around memory-type folders in this slice.

Current data-home mapping:

- Experience Log: root SQLite `state/memory.db`, primarily `experience_events` plus tombstones.
- Session Memory: root SQLite `state/memory.db`, in a dedicated `session_memories` table for agent-written session continuity.
- Memory Candidates and layer handoffs: root SQLite `state/memory.db`.
- Project Memory: `projects/<key>/wiki/`, with project-owned metadata in `projects/<key>/state/`, preserved project source material in `projects/<key>/sources/`, and operational evidence in `projects/<key>/log/` and `projects/<key>/runs/`.
- Practice Memory: canonical home deferred until Practice promotion is designed; this slice may only create candidate or handoff records.
- Personal Memory: canonical home deferred until Personal promotion is designed; this slice may only create candidate or handoff records.
- Raw unclassified intake: root `raw/` for global unclassified material, separate from synthesized memory.

This preserves the implemented bootstrap layout and the existing ADR direction: SQLite is the serving/event/session substrate, Project Memory remains curated markdown, and Practice/Personal homes should be introduced only when their promotion workflows have real examples.

## Architecture Layers

Myelin should keep storage, product logic, query behavior, and external interfaces distinct:

- DB layer: SQLite tables and indexes for Experience Log, Session Memory, Memory Candidates, and Project/Practice/Personal handoff instruction queues.
- Functions / logic / processor layer: Myelin-owned functions that create, validate, route, list, process, and tombstone memory records. This layer owns table selection and lifecycle behavior.
- Query layer: future retrieval behavior over Session Memory and other layers, including SQLite VEC and embedding-backed lookup.
- MCP / CLI / API layer: external interfaces that call Myelin functions. These interfaces should not expose physical table names or require callers to know storage details.

This design slice primarily defines the DB layer and the functions/logic/processor layer for Experience Log to Session Memory ingest and downstream handoff creation. Query-layer semantic retrieval and MCP/CLI/API command design are compatibility constraints and later implementation slices, except where this slice needs stable internal function contracts.

## Technical Design

### Agentic Ingest Boundary

Ingest is the public orchestration command. The Experience Log drain is an internal data-access stage over local SQLite state, not the main product behavior.

The ingest workflow should:

- launch a bounded ingest agent in the target repo cwd, on `master` for this version
- provide tools for the agent to pull Experience Log rows in batches
- let the agent inspect existing memory surfaces before deciding whether evidence is new
- let the agent decide which memory outputs or handoff instructions are appropriate
- write candidate, downstream queue, or no-op decisions
- write `experience_event_tombstones`
- drain pulled raw rows by moving them into tombstones, then finalize those tombstones when the ingest job completes

The ingest workflow is intentionally agentic. The hard boundary is that agentic work happens after capture, never inside hooks, and must be bounded by project, repo cwd, branch, batch, tool surface, output schema, and terminal records.

### Agent Runtime Context

The ingest agent should run as a headless provider session from the repository whose Experience Log rows are being processed. If Myelin is ingesting `class-kit`, the agent's cwd is the ClassKit repo, not the Myelin repo. For this version, Myelin should force or require the target repo to be on `master` before launching the ingest agent.

The agent should not receive a pre-chewed transcript as the primary interface. Preferred access is through Myelin tools, eventually the Myelin MCP layer, that let it:

- pull Experience Log rows in bounded batches
- query existing Session Memory and other available Myelin memory
- create Session Memory
- create Session Memory candidates when the agent decides review is needed
- create Project, Practice, and Personal Layer Handoff Instructions
- inspect the current ingest job state

Providing rows directly in a temporary file or prompt payload is acceptable as an implementation bridge, but the target design is tool-first so the agent can keep querying Myelin as other workers create new memory.

Myelin optimizes the agent's context and capabilities; it should not hard-code the shape, count, or granularity of Session Memory records created from a batch. The agent decides whether a pulled batch produces no memory, one memory, several memory items, Session Memory candidates, or downstream Layer Handoff Instructions.

If the target repo is not currently on `master`, Myelin should not launch the provider session. For this slice, the command should create or update an `ingest_jobs` record with `failed` status and structured branch-mismatch error metadata so the operator can inspect the failed attempt through the normal status path. It should not pull Experience Log rows or create tombstones in that case.

### Pull-To-Tombstone Lifecycle

Pulling Experience Log rows is the queue-claim operation. When an ingest agent pulls a batch, Myelin should atomically move those rows out of `experience_events` and into `experience_event_tombstones` with enough source metadata, ingest job id, provider session id, and bounded retained evidence to audit what was pulled.

The tombstone is finalized when the ingest job finishes. Finalization should add the simple terminal data Myelin needs: whether the pulled evidence produced output references, produced no output, or remained unfinished because the job failed. The ingest agent does not need to manually maintain tombstones for every row; Myelin owns that bookkeeping.

This lifecycle should stay intentionally small. Tombstones are an audit trail and queue-drain mechanism, not a prominent workflow surface or a general recovery system.

### Parallelism Boundary

The first implementation should run one detached ingest agent by default. Myelin should not build a scheduler, worker pool, cancellation manager, or multi-agent orchestration in this slice.

The pull API should still be partition-safe. Pulling a bounded batch should atomically claim those rows for a specific ingest job/agent and move them into tombstones, so a later multi-agent version can split large Experience Log queues across workers without duplicate pulls. Agents should be told if they are part of a parallel run when that later mode exists, and they should use Myelin tools to observe memory created by other workers in real time.

### Candidate Queue

Each candidate targets exactly one memory scope:

- `session`
- `project`
- `practice`
- `personal`

Each candidate has one lifecycle status. Provisional statuses:

- `pending`: created and waiting for review or later processing
- `needs_review`: created but too ambiguous or risky for automatic next steps
- `processed`: consumed by a later workflow
- `rejected`: explicitly rejected from the queue by a human or later workflow

The queue should preserve enough provenance for a future agent to inspect the candidate without needing the raw row:

- candidate id
- project key
- target scope
- status
- source event ids or tombstone ids
- provider/source metadata
- event kind
- created timestamp
- evidence summary or raw excerpt policy
- proposed memory payload
- confidence/risk classification
- reason
- output references or next-step references when processed later

### Direct Session Memory Storage

Trusted low-risk Session Memory is stored directly in SQLite in a dedicated `session_memories` table. It is not stored as raw Experience Log data, and it is not written into curated project wiki pages in this slice.

The first table should hold the durable session-continuity text and metadata needed by future Myelin facades:

- id
- project key
- provider/session identifiers when available
- source event or tombstone references
- memory kind, such as `continuity`, `decision`, `blocker`, `next_action`, or `verification`
- summary text
- structured payload JSON for future tools
- confidence/risk
- created and updated timestamps

Embedding search should be supported later through a companion index/table or generated vector index over `session_memories`. The Session Memory table is the canonical semantic record; embeddings are a retrieval aid, not the memory source of truth.

### Session Memory Retrieval Facade

Future MCP tools and agent-facing query surfaces should not query raw SQLite tables directly. They should call a stable Myelin facade, such as `query_session_memory`, that accepts a project key, question/query text, and bounded retrieval options. The facade owns the retrieval implementation.

The selected retrieval implementation is SQLite VEC over generated embeddings for `session_memories`, behind that facade. This keeps the external contract stable if Myelin later changes table names, embedding models, dimensions, vector index strategy, or fallback retrieval.

Embedding generation and vector-index maintenance are deferred to the later MCP/query retrieval slice. The first ingest implementation must write canonical `session_memories` with stable ids, project keys, timestamps, memory kinds, source references, and text payloads that can be embedded later without reinterpreting the raw Experience Log.

Implementation notes from the referenced docs:

- `sqlite-vec` can be loaded into a Bun SQLite connection through the JavaScript package, but the docs note macOS may require a custom SQLite library for extension support.
- `sqlite-vec` stores and queries vectors through `vec0` virtual tables and supports metadata, auxiliary columns, and partition keys. Myelin should use `project_key` as a partition/filter boundary for project-scoped Session Memory retrieval.
- The `sqlite-vec` repository labels the project pre-v1, so Myelin should isolate it behind an internal retrieval adapter rather than letting the schema or MCP contract depend on package-specific details.
- Gemini embeddings can be generated from JavaScript with the Gemini API and an explicit output dimensionality. Myelin must store the embedding provider, model name, and dimension with generated vectors so vectors from incompatible embedding spaces are not mixed silently.

### Layer Handoff Model

The ingest agent is the Session Memory layer agent. It reads the lowest-level captured evidence and existing Myelin memory, then decides whether the evidence should:

- produce no durable output because it is pointless or already represented
- write low-risk Session Memory output directly
- create a Session Memory candidate when the summary is ambiguous or risky
- create downstream layer handoff instructions for future Project, Practice, or Personal processing

Session Memory is the lowest actual memory layer. Project, Practice, and Personal work is derived from session-level interpretation rather than directly trusting raw capture. This is a layer handoff graph, not a free-form recursive loop. In the first version, one ingest run performs one hop only: Experience Log to whatever Session Memory outputs the ingest agent judges useful, plus optional downstream layer handoff instructions. Each handoff instruction must be a durable candidate/instruction/prompt/input for a later layer agent. It should tell that agent what to read, query, fetch, compare, or verify, and why the Session Memory agent believes the higher layer may need work.

Layer handoff instructions are not small hints. They are not trusted Project, Practice, or Personal Memory. They are structured inputs for future layer agents, with source references and enough prompt context for the downstream agent to continue from the session-level interpretation without reprocessing the full raw Experience Log.

Each Layer Handoff Instruction stores both structured machine-readable fields and agent-ready prompt text. The structured fields support validation, dedupe, querying, review, and traceability. The prompt text gives the downstream layer agent a clean starting input without requiring every future agent to reconstruct the prompt from raw fields.

The Session Memory agent is the first-contact agent for raw Experience Log ingestion. It may use Myelin tools, MCP calls, and existing memory retrieval to discover related prior Session Memory before writing a handoff instruction. For example, if a ClassKit session implements Supabase OAuth and Myelin retrieval shows two prior Supabase OAuth implementations, the Session Memory agent can create:

- a Project layer handoff input to verify and record that ClassKit uses Supabase OAuth
- a Practice layer handoff input to investigate the repeated Supabase OAuth implementation pattern
- a Personal layer handoff input to evaluate whether repeated Supabase Auth choices indicate a user preference

Those handoff instructions are agent-generated inputs for future layer agents. They can include the first-contact agent's generated prompt, objective, suggested reads/queries/fetches, and bounded evidence excerpts, but they should not duplicate the full raw Experience Log transcript.

The structured payload should include:

- target layer/scope: `project`, `practice`, or `personal`
- objective
- source Session Memory ids
- source Experience Log tombstone ids or source event ids
- suggested reads, queries, fetches, comparisons, or verifications
- reason the handoff exists
- confidence/risk
- status
- prompt text for the downstream layer agent

### Retention Boundary For Derived Inputs

Memory Candidates and Layer Handoff Instructions should use extended bounded evidence retention. They may store:

- generated summaries
- bounded excerpts from captured text
- structured source metadata
- source Session Memory ids
- source Experience Log event ids or tombstone ids
- suggested Myelin queries, repo reads, or external fetches for the downstream agent
- generated prompt text from the Session Memory agent

They must not store complete raw Experience Log transcripts by default. Once an Experience Log row is processed, the raw row can be deleted through the tombstone helper after the durable output references have been written.

### Session Memory Trust Boundary

`myelin ingest` may write Session Memory directly when the ingest agent classifies the output as low-risk. Low-risk Session Memory is factual continuity about the session: what was discussed, what changed, what was verified, what is blocked, and what the next action is.

Ambiguous, broad, conflicting, or high-risk summaries must become `scope=session` candidates instead of trusted Session Memory. Examples include uncertain claims, suspected durable project facts without evidence, privacy-sensitive raw excerpts, or summaries that would change future agent behavior beyond session continuity.

### First Candidate Types

Provisional first candidate payloads:

- `session`: session continuity note, action, blocker, verification result, or correction
- `project`: possible durable project fact, decision, setup gotcha, runbook change, or stale/correction signal
- `practice`: possible cross-project reusable approach, only when the evidence explicitly suggests a reusable pattern
- `personal`: possible user preference, only when the evidence is explicit user guidance or repeated correction evidence

The first implementation should let the ingest agent create low-risk Session Memory output and queue risky Session Memory candidates when the agent decides review is needed. Project, Practice, and Personal handoff instruction creation should be conservative and may require explicit session-level interpretation, repeated evidence, or a later downstream layer agent before activation.

## Data / State

Provisional SQLite table for detached ingest lifecycle:

```text
ingest_jobs
  id TEXT PRIMARY KEY
  project_key TEXT NOT NULL
  status TEXT NOT NULL CHECK (...)
  provider TEXT NOT NULL
  provider_session_id TEXT
  requested_by TEXT
  input_json TEXT NOT NULL
  output_counts_json TEXT NOT NULL
  terminal_summary TEXT
  error_json TEXT
  followup_state_json TEXT
  started_at TEXT
  finished_at TEXT
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
```

`ingest_jobs` is Myelin's durable record for a detached/background ingest run. It is not a full local queue runner in this slice. It records enough lifecycle state for status checks, audit, retry decisions, and operator follow-up while allowing the provider's headless session id to remain an implementation detail attached to the Myelin job.

Initial statuses should be small and lifecycle-oriented, such as:

- `starting`: Myelin created the job and is launching the provider session.
- `running`: the headless provider session is active.
- `needs_followup`: the provider session needs operator input or could not safely continue.
- `completed`: the run finished and wrote terminal output records.
- `failed`: the run failed before successful completion; unprocessed raw rows remain retryable unless tombstones prove otherwise.

The first version should not implement a full scheduler, retry daemon, cancellation system, or concurrency manager. The schema should leave room to grow into that later without changing the public meaning of `myelin ingest <project-key>`.

Provisional SQLite table for trusted agent-written Session Memory:

```text
session_memories
  id TEXT PRIMARY KEY
  project_key TEXT NOT NULL
  provider TEXT
  provider_session_id TEXT
  ingest_job_id TEXT
  source_event_refs_json TEXT NOT NULL
  memory_kind TEXT NOT NULL CHECK (...)
  title TEXT
  summary TEXT NOT NULL
  payload_json TEXT NOT NULL
  confidence TEXT NOT NULL
  risk TEXT NOT NULL
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
```

`session_memories` stores trusted, low-risk continuity written by the ingest agent. It is distinct from the existing manual `sessions` / `session_events` tables. Status/current-briefing integration may read from both later, but this slice should not force the two models into one table.

Provisional SQLite table for proposed memory outputs:

```text
memory_candidates
  id TEXT PRIMARY KEY
  project_key TEXT NOT NULL
  scope TEXT NOT NULL CHECK (...)
  status TEXT NOT NULL CHECK (...)
  candidate_type TEXT NOT NULL
  title TEXT
  summary TEXT NOT NULL
  evidence_json TEXT NOT NULL
  proposed_payload_json TEXT NOT NULL
  confidence TEXT NOT NULL
  risk TEXT NOT NULL
  reason TEXT NOT NULL
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  processed_at TEXT
```

`memory_candidates` stores proposed memory outputs that require later review or processing. It should not store downstream agent work instructions.

Provisional SQLite tables for downstream layer-agent inputs:

```text
project_handoff_instructions
  id TEXT PRIMARY KEY
  project_key TEXT NOT NULL
  status TEXT NOT NULL CHECK (...)
  objective TEXT NOT NULL
  prompt_text TEXT NOT NULL
  source_session_memory_ids_json TEXT NOT NULL
  source_event_refs_json TEXT NOT NULL
  suggested_actions_json TEXT NOT NULL
  reason TEXT NOT NULL
  confidence TEXT NOT NULL
  risk TEXT NOT NULL
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  processed_at TEXT
```

```text
practice_handoff_instructions
  id TEXT PRIMARY KEY
  project_key TEXT NOT NULL
  status TEXT NOT NULL CHECK (...)
  objective TEXT NOT NULL
  prompt_text TEXT NOT NULL
  source_session_memory_ids_json TEXT NOT NULL
  source_event_refs_json TEXT NOT NULL
  suggested_actions_json TEXT NOT NULL
  reason TEXT NOT NULL
  confidence TEXT NOT NULL
  risk TEXT NOT NULL
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  processed_at TEXT
```

```text
personal_handoff_instructions
  id TEXT PRIMARY KEY
  project_key TEXT NOT NULL
  status TEXT NOT NULL CHECK (...)
  objective TEXT NOT NULL
  prompt_text TEXT NOT NULL
  source_session_memory_ids_json TEXT NOT NULL
  source_event_refs_json TEXT NOT NULL
  suggested_actions_json TEXT NOT NULL
  reason TEXT NOT NULL
  confidence TEXT NOT NULL
  risk TEXT NOT NULL
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  processed_at TEXT
```

These tables store inputs for later Project, Practice, or Personal layer agents. A handoff instruction is not a proposed memory update and is not trusted higher-layer memory.

Layer agents and MCP/query surfaces should not care which physical table backs a handoff. They should use layer-specific functions/facades, such as enqueueing a Project, Practice, or Personal handoff input and listing pending inputs for that layer. Shared lifecycle behavior should live in reusable code, not be duplicated per table. Cross-layer reporting, if needed, should be implemented through a facade or union-style read, not by exposing table details to callers.

The external MCP/API shape can remain a single scoped interface later, such as one tool that accepts `scope` (`session`, `project`, `practice`, or `personal`) plus input text/metadata. Internally, that interface should dispatch into Myelin functions. For handoff instructions, the functions/processor layer should expose layer-specific functions backed by shared helpers so domain intent remains clear while lifecycle code stays reusable.

Possible supporting indexes:

- `(project_key, status, created_at)` on `ingest_jobs`
- `(provider, provider_session_id)` on `ingest_jobs` when the provider returns a session id
- `(project_key, status, created_at)`
- `(project_key, scope, status, created_at)`
- `(project_key, status, created_at)` on each layer handoff table
- unique source-event guard if one event can create only one candidate in this slice

Deferred design boundaries:

- exact SQLite VEC table/index shape, Gemini embedding model, backfill behavior, and query facade behavior are deferred to the MCP/query retrieval slice
- canonical Practice and Personal Memory homes are deferred until their promotion designs
- full local queue runner behavior, retries, cancellation, and concurrency limits are deferred until detached ingest proves it needs them

## Trigger Modes

This slice revises the roadmap's trigger-mode vocabulary because `myelin ingest` is now explicitly agentic and detached.

Provisional interpretation:

- hooks remain non-agentic raw capture
- `myelin ingest <project-key>` is an explicit operator action that starts a bounded background/headless provider session
- detached ingest is not `Auto Mode`; it is explicit operator-triggered background work
- always-on automatic ingest remains out of scope unless separately designed
- the command should return a durable job/session handle for later status checks or follow-up

## Integrations

The design touches these existing product surfaces:

- Experience Log SQLite tables and tombstone helper.
- Project discovery by key.
- CLI command registry.
- Existing ingest vocabulary, because top-level `myelin ingest <key>` now coexists with `project ingest <key>` rather than replacing queued source/inbox processing.
- Existing manual `sessions` / `session_events`, because later status/current-briefing integration may read both manual session events and trusted `session_memories`.
- Future Project Memory curator, Practice Memory, Personal Memory, and facades.

## Permissions / Security

Raw Experience Log rows may contain private prompts, assistant answers, local paths, and project context. The queue must not make that exposure worse.

Security constraints:

- keep raw data local
- do not write candidate data into tracked markdown by default
- avoid storing unnecessary full raw prompt/response text in candidates if tombstone/source references are enough
- never mutate curated memory from hook-drain flow in this slice
- no model calls in hooks
- no unbounded worker launch from ingest; background ingest still needs project, batch, provider-session, and output limits
- every agentic handoff writes a durable output or terminal decision

## Error Handling

Ingest must be safe to retry.

Expected behavior:

- If candidate or downstream queue write fails, leave the raw Experience Log row untouched.
- If tombstone write fails, leave the raw row untouched or roll back the candidate/downstream write in the same transaction.
- If a row is malformed but project-keyed, create an invalid/no-op decision or candidate according to the resolved policy.
- If a candidate already exists for an event, do not duplicate it; return an idempotent result.
- If an agent cannot classify a row, create `needs_review` when review could recover signal, or a tombstone-only no-op when the row is low-signal and safely terminal.
- If a background provider session fails after pulling rows, Myelin should finalize or mark the pulled tombstones as unfinished/failed rather than pretending they were deliberate no-output rows.
- If the operator asks for status after a detached run, Myelin should report the durable ingest job state rather than requiring the operator to inspect provider logs directly.

## Testing Strategy

Implementation planning should include:

- SQLite schema tests for candidate, Session Memory, and handoff queue tables and indexes
- ingest tests that convert synthetic Experience Log rows into candidates
- bounded agent fixture/stub tests for ingest-agent outputs
- idempotency tests for repeated ingest runs
- transaction tests proving raw rows are not lost on partial failure
- background ingest job tests proving the command returns a handle before the provider session finishes
- status/follow-up tests proving Myelin can report detached ingest state from durable records
- tombstone tests proving pulled rows move out of the active queue atomically and are finalized when the ingest job completes
- CLI list/show tests for candidates
- privacy tests or fixture checks proving tracked files do not include raw private payloads

## Planning Boundary Guidance

Likely future chunks:

- candidate queue schema and helpers
- detached ingest job/session tracking and status reporting
- top-level ingest orchestration plus Experience Log access stage and idempotent tombstoning
- bounded ingest agent contract and tool surface
- one-hop layer handoff contract
- candidate CLI list/show/reject basics
- first Session Memory output/candidate mapping
- Session Memory low-risk/risky classification rules
- first Project Memory update candidate mapping
- optional trigger mode/config integration
- later model-backed curator or promotion workflow

The next implementation plan should not bundle canonical memory promotion, wiki updates, MCP facade changes, vector indexing, or cross-project Practice/Personal promotion.

## Acceptance Criteria

The design is ready for implementation planning when:

- the ingest command ownership and naming are decided
- the candidate queue schema and lifecycle are specified enough for implementation
- the processed-unit-to-output cardinality rule is decided
- the raw retention/tombstone policy is decided
- the Session Memory output shape and one-hop layer handoff rules are decided
- the relationship to existing `session_events` is decided
- failure and retry behavior are unambiguous

## Assumptions

- The approved bootstrap/hook capture slice lands before this slice is implemented.
- The first useful drain target is `class-kit`, but the design should work for any bootstrapped project.
- Raw Experience Log rows are local SQLite data and may contain sensitive user/project text.
- The queue is a safety boundary, not a truth boundary.

## Design Agenda

The live decision trail is in `agenda.md`.
