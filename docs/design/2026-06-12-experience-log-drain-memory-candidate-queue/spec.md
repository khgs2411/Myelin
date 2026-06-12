# Agentic Ingest And Memory Candidate Queue Design

Status: Working draft. Not approved for implementation planning yet.

## Goal

Design the first processing path after raw hook capture: `myelin ingest <project-key>` starts a bounded agentic workflow that reads uningested `experience_events`, turns useful raw evidence into Session Memory-layer output, tombstones processed raw rows, and may enqueue downstream layer work without treating raw captured text as trusted truth.

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
- Existing `project ingest` and `project learn` are pipeline commands. This design now treats top-level `myelin ingest <project-key>` as the likely public orchestration surface for an agentic evidence-to-memory pipeline, while still keeping internal stages bounded and reviewable.

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

This slice creates the first agentic layer above raw evidence. The ingest agent reads raw Experience Log rows plus existing Myelin memory surfaces, decides whether anything new exists for Session Memory, and writes reviewable output that can later feed Project, Practice, and Personal Memory.

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
- classify raw rows into one candidate scope
- create candidate records
- enqueue downstream project/practice/personal layer work when the session-level interpretation finds useful signal
- mark rows no-op/rejected when they are not useful
- tombstone processed rows with durable output references
- expose candidate list/show commands for review

## User-Facing Behavior

The initial operator flow should be explicit:

1. Capture has already written raw Experience Log rows for a bootstrapped repo.
2. The operator runs `myelin ingest <project-key>`.
3. Myelin selects uningested Experience Log rows for the project.
4. Myelin invokes the ingest agent with tools/scripts for reading raw rows, existing memory, wiki pages, and candidate state.
5. The ingest agent decides whether each row or group is pointless, already represented, or useful Session Memory input.
6. Myelin records candidate/no-op outputs and tombstones processed raw rows.
7. When useful, the ingest agent can enqueue downstream layer candidates for Project, Practice, or Personal curation based on the session-level interpretation.

Provisional command shape:

```text
myelin ingest <project-key> [--limit N] [--dry-run] [--json]
myelin memory candidates <project-key> [--status pending|needs-review|processed|rejected] [--scope session|project|practice|personal] [--json]
myelin memory candidate show <candidate-id> [--json]
```

The command names are provisional. The current direction is that `myelin ingest` is the public command that starts the fixed agentic ingest pipeline. Narrower internal modules own Experience Log row access, candidate creation, tombstoning, and downstream queue writes, but they are not separate product commands.

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

## Technical Design

### Agentic Ingest Boundary

Ingest is the public orchestration command. The Experience Log drain is an internal data-access stage over local SQLite state, not the main product behavior.

The ingest workflow should:

- select unprocessed `experience_events` for one project
- provide those rows to a bounded ingest agent, or provide tools for the agent to fetch them
- let the agent inspect existing memory surfaces before deciding whether evidence is new
- classify each processed unit into a terminal path
- write candidate, downstream queue, or no-op decisions
- write `experience_event_tombstones`
- delete processed raw rows through the existing tombstone helper

The ingest workflow is intentionally agentic. The hard boundary is that agentic work happens after capture, never inside hooks, and must be bounded by project, batch, tool surface, output schema, and terminal records.

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
- `rejected`: explicitly rejected or terminal no-op

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

Session Memory is the lowest actual memory layer. Project, Practice, and Personal work is derived from session-level interpretation rather than directly trusting raw capture. This is a layer handoff graph, not a free-form recursive loop. In the first version, one ingest run performs one hop only: Experience Log to one primary Session Memory output plus optional downstream layer handoff instructions. Each handoff instruction must be a durable candidate/instruction/prompt/input for a later layer agent. It should tell that agent what to read, query, fetch, compare, or verify, and why the Session Memory agent believes the higher layer may need work.

Layer handoff instructions are not small hints. They are not trusted Project, Practice, or Personal Memory. They are structured inputs for future layer agents, with source references and enough prompt context for the downstream agent to continue from the session-level interpretation without reprocessing the full raw Experience Log.

Each Layer Handoff Instruction stores both structured machine-readable fields and agent-ready prompt text. The structured fields support validation, dedupe, querying, review, and traceability. The prompt text gives the downstream layer agent a clean starting input without requiring every future agent to reconstruct the prompt from raw fields.

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

### Session Memory Trust Boundary

`myelin ingest` may write Session Memory directly when the ingest agent classifies the output as low-risk. Low-risk Session Memory is factual continuity about the session: what was discussed, what changed, what was verified, what is blocked, and what the next action is.

Ambiguous, broad, conflicting, or high-risk summaries must become `scope=session` candidates instead of trusted Session Memory. Examples include uncertain claims, suspected durable project facts without evidence, privacy-sensitive raw excerpts, or summaries that would change future agent behavior beyond session continuity.

### First Candidate Types

Provisional first candidate payloads:

- `session`: session continuity note, action, blocker, verification result, or correction
- `project`: possible durable project fact, decision, setup gotcha, runbook change, or stale/correction signal
- `practice`: possible cross-project reusable approach, only when the evidence explicitly suggests a reusable pattern
- `personal`: possible user preference, only when the evidence is explicit user guidance or repeated correction evidence

The first implementation should produce low-risk Session Memory output first and queue risky Session Memory candidates. Project, Practice, and Personal handoff instruction creation should be conservative and may require explicit session-level interpretation, repeated evidence, or a later downstream layer agent before activation.

## Data / State

Provisional SQLite table:

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

Possible supporting indexes:

- `(project_key, status, created_at)`
- `(project_key, scope, status, created_at)`
- unique source-event guard if one event can create only one candidate in this slice

Open design questions:

- whether candidate evidence should preserve raw excerpts or only tombstone/source references
- whether one raw event may create multiple candidates
- whether no-op decisions live only as tombstones or also as rejected candidates
- exact SQLite VEC table/index shape, Gemini embedding model, backfill behavior, and query facade behavior are deferred to the MCP/query retrieval slice
- canonical Practice and Personal Memory homes are deferred until their promotion designs

## Trigger Modes

This slice may revise the roadmap's trigger-mode vocabulary because `myelin ingest` is now explicitly agentic.

Provisional interpretation:

- hooks remain non-agentic raw capture
- `myelin ingest <project-key>` is an explicit operator action that can invoke bounded agents
- automatic/background ingest remains out of scope unless separately designed

## Integrations

The design touches these existing product surfaces:

- Experience Log SQLite tables and tombstone helper.
- Project discovery by key.
- CLI command registry.
- Existing ingest vocabulary, because this slice likely moves the public surface from `project ingest <key>` toward top-level `myelin ingest <key>` while preserving compatibility choices as a planning concern.
- Existing Session Memory tables, if we decide to connect candidates to open/closed sessions now.
- Future Project Memory curator, Practice Memory, Personal Memory, and facades.

## Permissions / Security

Raw Experience Log rows may contain private prompts, assistant answers, local paths, and project context. The queue must not make that exposure worse.

Security constraints:

- keep raw data local
- do not write candidate data into tracked markdown by default
- avoid storing unnecessary full raw prompt/response text in candidates if tombstone/source references are enough
- never mutate curated memory from hook-drain flow in this slice
- no model calls in hooks
- no unbounded worker launch from ingest
- every agentic handoff writes a durable output or terminal decision

## Error Handling

Ingest must be safe to retry.

Expected behavior:

- If candidate or downstream queue write fails, leave the raw Experience Log row untouched.
- If tombstone write fails, leave the raw row untouched or roll back the candidate/downstream write in the same transaction.
- If a row is malformed but project-keyed, create an invalid/no-op decision or candidate according to the resolved policy.
- If a candidate already exists for an event, do not duplicate it; return an idempotent result.
- If an agent cannot classify a row, create `needs_review` or no-op based on the resolved policy.
- `--dry-run` must not write candidates or tombstones.

## Testing Strategy

Implementation planning should include:

- migration tests for candidate queue tables and indexes
- ingest tests that convert synthetic Experience Log rows into candidates
- bounded agent fixture/stub tests for ingest-agent outputs
- idempotency tests for repeated ingest runs
- transaction tests proving raw rows are not lost on partial failure
- dry-run tests proving no writes
- tombstone tests proving raw rows are deleted only after candidate/no-op output exists
- CLI list/show tests for candidates
- privacy tests or fixture checks proving tracked files do not include raw private payloads

## Planning Boundary Guidance

Likely future chunks:

- candidate queue schema and helpers
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
