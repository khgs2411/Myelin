# Behavior states and gate precedence

Myelin exposes independent lifecycle, retrieval, and operational states so an operator can distinguish preserved evidence, curated memory, usable retrieval, and work that still needs attention.

## Gate order and authority boundaries

Commands are the public authority boundary; a detached consumer must use their CLI/JSON contracts rather than import core code. Within that boundary, the implementation generally applies gates in this order:

1. **Identity and scope.** A project must resolve from the explicit key or an unambiguous registered repository path (`src/status/status-service.ts`); project inbox intake verifies the target layer, project key, and target scope before it creates a candidate (`src/project/project-memory-candidate-intake-service.ts`).
2. **Input validity and ownership.** Command parsers reject unsupported enum values and invalid limits. Ingest worker output is schema- and enum-validated before writes (`src/ingest/worker.ts`). A reconciliation operation may affect only an active memory in the same project and, when supplied, only the reconciliation context; a replacement must itself be active.
3. **Eligibility and readiness.** Project learning checks its preflight, schema context, source reconciliation, and runtime-inbox intake before authoring; an incomplete canonical apply journal blocks resume (`src/project/project-memory-curator-service.ts`). Retrieval uses the active embedding contract, and indexing requires a working provider/vector table.
4. **Protection before irreversible cleanup.** Reset first verifies a registered project, a repository path, and a safe path beneath `projects/`; embedding prune first verifies active-contract coverage. Only then may either delete derived/project-shell state.

The effects of a failed earlier gate take precedence over later work: no project inbox candidate is created for an invalid scope; no reconciliation mutation is made for an unclaimed tombstone or inactive/out-of-context memory; no pruning happens if coverage is incomplete. Status is different: it evaluates all sections and reports the worst severity rather than stopping at the first warning (`src/status/severity.ts`).

## Experience Log ingest and Session Memory states

`myelin ingest <project>` starts detached workers; it returns `no_work` when no queued events are eligible, otherwise creates batch jobs (`src/ingest/ingest-service.ts`). The job state is one of:

| State | User-visible outcome |
| --- | --- |
| `starting` | Job exists while detached launch is being established. |
| `running` | Worker may lease events and write terminal outputs. |
| `needs_followup` | Terminal but requires operator review; it appears in `memory review`. |
| `completed` | Terminal processing completed; an operator can inspect output counts and summary. |
| `failed` | Terminal failure; status severity becomes `blocked` when leased work remains, otherwise `attention`. |

An event is preserved until its tombstone reaches one of these states: `claimed`, `output`, `no_output`, `failed`, or `unfinished` (`src/memory/ingest-types.ts`, `src/memory/experience.ts`). `claimed` is nonterminal. `output` records references to created output, `no_output` records an intentional empty result, and `failed`/`unfinished` retain audit evidence for failure/recovery rather than silently discarding raw rows.

Ingest progress uses a separate ordered completion layer, not the job status: 10 `Experience Log drain pending`, 20 `Experience Log drain complete`, 30 `Session Memory write complete`, and 40 `Session Memory retrieval pending` (`src/ingest/status.ts`). Thus drained events and written Session Memory do not imply retrieval is ready.

The worker can create Session Memory with kinds `continuity`, `decision`, `blocker`, `next_action`, or `verification`; its lifecycle is `active`, `superseded`, or `retracted`. Supersession requires an active old memory, an active replacement, valid claimed tombstone evidence, and an allowed relationship (`supersedes`, `refines`, `contradicts`, or `duplicates`). Retraction requires the same active/context/evidence checks but no replacement. It never physically deletes the old memory (`src/ingest/worker.ts`, `src/memory/session-memories.ts`).

Candidate and handoff authority is narrower than direct trusted memory. Memory candidates use scopes `session`, `project`, `practice`, or `personal`; handoffs only `project`, `practice`, or `personal`. Provider output may create only `pending` or `needs_review`, while persisted candidate lifecycle also includes terminal `processed` and `rejected` (`src/memory/ingest-types.ts`). Ambiguous, risky, conflicting, or privacy-sensitive material is therefore routed to a candidate/handoff rather than becoming direct Session Memory.

## Project Memory authoring and runtime inbox gates

`myelin project learn <key>` chooses curator mode `create` or `maintain`. Its reported run status is `completed`, `completed_with_pending_index`, `failed`, or `needs_review`; `completed_with_pending_index` means canonical curation succeeded but derived retrieval still needs work (`src/project/project-memory-curator-contracts.ts`). Agent-run state additionally records `completed_with_pending_index` or `degraded` alongside `completed`/`failed`, and the durable project state is `curated`, `degraded`, or `failed` (`src/project/project-memory-agent-contracts.ts`).

Runtime inbox intake is deterministic and project-scoped. A valid project-layer item creates a `needs_review` `project.inbox` candidate. An existing `pending`/`needs_review` candidate is retained as `existing`; an existing `processed`/`rejected` candidate is a terminal duplicate. Items for another layer, another project/scope, malformed filenames/content, or unsupported existing status are reported without becoming a Project Memory candidate; inability to resolve the project or read the inbox is blocking (`src/project/project-memory-candidate-intake-service.ts`). Project Memory maintenance then records one of: `applied_to_project_memory`, `already_covered`, `insufficient_evidence`, `not_durable`, `belongs_to_other_layer`, `deferred_unsafe_change`, or `blocked_by_runner_failure`. The legacy input name `already_trusted` normalizes only to `already_covered`.

## Retrieval and embedding lifecycle

Project lookup results expose method `indexed_section_retrieval`, `fallback_markdown_search`, or `unavailable`; quality `indexed`, `fallback`, or `unavailable`; freshness `fresh`, `stale`, `orphaned`, `unknown`, or `not_applicable`; and apply severity `advisory`, `proposal_scoped`, or `blocking` (`src/project/project-memory-retrieval-contracts.ts`). A degraded lookup may still support a proposal only when its declared minimum quality/freshness permits it; blocking lookup reasons stop the applicable update.

Embedding contracts are separate per `session_memory` and `project_memory` scope. Their lifecycle values are `active`, `previous`, `staging`, `retired`, and `failed` (`src/memory/embedding-contract-types.ts`). Migration stages and indexes the desired contract, verifies indexed metadata equals vector rows, smoke-tests a vector query, and only then activates it. Failed or incomplete indexing marks the staging contract failed rather than replacing the active one (`src/memory/embedding-contract-lifecycle-service.ts`). Rollback swaps active and previous contracts only when a previous contract exists; preview reports `none` otherwise.

`memory embeddings prune --apply` is intentionally irreversible for retired/failed/historical derived rows, query-cache rows, and owned vector tables. It never selects active or previous contracts as candidates. Before deletion, it requires every active Session Memory and every canonical Project Memory section to have an indexed document embedding under the active contract; missing coverage aborts the entire prune (`src/memory/embedding-contract-lifecycle-service.ts`, `tests/memory/embedding-contract-lifecycle-service.test.ts`).

## Operational status precedence

`myelin status [project]` resolves an explicit project key first, otherwise a single registered repository containing the current directory; zero matches require a key and multiple matches are rejected as ambiguous (`src/status/status-service.ts`). It returns installation, Session Memory, and Project Memory sections with `healthy`, `attention`, or `blocked` plus evidence, warnings, and suggested actions (`src/status/contracts.ts`). Overall state is the maximum severity: `blocked` overrides `attention`, which overrides `healthy`.

For retrieval specifically, no active Session Memory is healthy even with no index; otherwise zero indexed rows is blocked and pending/failed rows are attention. For curated Project Memory the same rule applies; uncurated Project Memory does not itself make retrieval unavailable (`src/status/severity.ts`). However, invalid curation state, a claimed-curated project without readable canonical markdown, unreadable inbox, stale lock, or unavailable root SQLite can independently make the relevant section blocked. A provider unavailable for an existing active contract raises the section to attention, not blocked. This means status communicates the strongest observed operational risk without changing the underlying authoritative state.

## Destructive reset boundary

`myelin project reset <key>` performs a clean rebootstrap only after the project resolves, has a configured repository path, and its computed project directory is contained under the managed `projects/` root. It deletes the project's canonical markdown shell, project state, preserved project sources, and project runs, then bootstraps again. It explicitly preserves `state/memory/memory.db`; failure to preserve an existing database is an error (`src/project/project-reset-service.ts`). The reset is therefore destructive for project-layer artifacts and cannot be treated as a Session Memory purge.

## Evidence and known gaps

Current behavior above is grounded in the implementation contracts and regression coverage in `tests/ingest/worker.test.ts`, `tests/ingest/ingest-service.test.ts`, `tests/memory/embedding-contract-lifecycle-service.test.ts`, `tests/memory/project-memory-retrieval-index-service.test.ts`, and `tests/status/`. The required checkout evidence artifact `repository-identity.json` is absent from this snapshot, so repository identity is not asserted here. The inspected tests exercise core validation, lifecycle, retrieval, and status rules, but do not demonstrate a full live-provider/concurrent end-to-end run for every gate combination.
