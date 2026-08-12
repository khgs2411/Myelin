# Command Workflows

Command workflows in Myelin are operator-facing Bun/TypeScript CLI flows for bootstrapping repositories, checking status, maintaining Project Memory, draining Experience Log rows into Session Memory, indexing retrieval state, and inspecting memory artifacts.

## Command Surface

The repo-local command form is `bun src/cli.ts <command>`, and the installed binary is expected to expose the same surface as `myelin <command>`. `src/cli.ts` builds a registry-driven CLI named `myelin` and registers `status`, `bootstrap`, `capture`, `install`, `uninstall`, `ingest`, `memory`, `project`, `session`, and `schema` command groups through `src/commands/*.ts`.

The root `Makefile` is a thin convenience layer over `bun src/cli.ts`, not a second command implementation. It requires `PROJECT=<key>` for project-scoped aliases and passes optional `ARGS` through to the underlying CLI. Current Make aliases are:

| Make target | CLI command |
| --- | --- |
| `make status PROJECT=<key> [ARGS=...]` | `bun src/cli.ts status <key> ...` |
| `make query PROJECT=<key> QUESTION="..." [ARGS=...]` | `bun src/cli.ts memory query <key> "..." ...` |
| `make learn PROJECT=<key> [ARGS=...]` | `bun src/cli.ts project learn <key> ...` |
| `make ingest PROJECT=<key> [ARGS=...]` | `bun src/cli.ts ingest <key> ...` |
| `make bootstrap PROJECT=<key> REPO=<path> [ARGS=...]` | `bun src/cli.ts bootstrap <key> --repo <path> ...` |
| `make schema-check PROJECT=<key> [ARGS=...]` | `bun src/cli.ts schema check <key> ...` |
| `make schema-build PROJECT=<key> [ARGS=...]` | `bun src/cli.ts schema build <key> ...` |
| `make session-close PROJECT=<key> [ARGS=...]` | `bun src/cli.ts session close <key> ...` |

`README.md` also describes `make onboard` / `myelin project onboard <key>` as the V2 replacement for `make init`, but that command is not registered in `src/cli.ts` and is not present in the current `Makefile`. Treat `bootstrap` as the implemented project-shell creation command in this snapshot.

## V2 Vocabulary

Myelin V2 command names use product vocabulary rather than V1 pipeline names. The active operator mapping in `README.md`, `docs/CLI.md`, and `AGENTS.md` is:

| V1/operator habit | V2 command |
| --- | --- |
| `compile` / `make compile PROJECT=<key>` | `myelin project learn <key>` / `make learn PROJECT=<key>` |
| old update-style project refresh | `myelin project learn <key>` for Project Memory, plus `myelin ingest <key>` for Experience Log to Session Memory |
| `project ingest` as Project Memory inbox intake | no active command; runtime inbox intake runs inside `project learn`, or explicitly through `memory inbox intake` |
| `ask` | `myelin memory query <key> "<question>"` / `make query ...` |
| Session Memory embedding backfill | `myelin memory index session <key>` |
| Project Memory retrieval index backfill | `myelin memory index project <key>` in implementation |
| schema validation/build | `myelin schema check <key>` and `myelin schema build <key>` |

Do not reintroduce V1 names as primary docs or automation vocabulary unless a legacy escape hatch is explicitly being documented.

## Primary Operator Workflows

### Bootstrap A Project

`myelin bootstrap <project-key> --repo <absolute-path>` creates or updates a project shell under `projects/<project-key>/`. The command rejects unknown options and requires both the project key and an absolute repo path. Human output reports the project key, repo path, and counts for created, kept, moved, and removed artifacts.

Side effects:

- Writes project state and memory shell files under `projects/<project-key>/`.
- Rejects repo paths already registered to another project key, according to `docs/CLI.md`.
- Has no `--json` mode in the current implementation, even though Make usage examples allow `ARGS='--json'`.

### Check Status

`myelin status [project-key] [--json]` shows status for an explicit project key, or resolves from the current working directory when no key is supplied. It is read-only. Human output is rendered by `StatusService`; `--json` emits the facade response contract with `answer`, `confidence`, `memory_scope`, `citations`, `candidate_ids`, `degraded`, `degraded_reason`, and `source_tools`.

Tests in `tests/commands/status.test.ts` cover deterministic reading of project state, latest session path, freshness state, and JSON facade fields.

### Maintain Project Memory

`myelin project learn <project-key> [--dry-run] [--review] [--recreate] [--provider codex|claude] [--model <model>] [--json]` is the broad Project Memory learning workflow. It may run provider-backed file-authoring agents, writes run artifacts, and may update Project Memory outputs unless `--dry-run` stops writes.

Important side effects and artifacts:

- Runs deterministic Project runtime inbox intake before packet construction.
- Creates or reuses Project Memory candidates for valid `projects/<project-key>/sources/inbox/*.json` records.
- Verifies schema freshness as part of the Project Memory flow.
- Writes run artifacts under `projects/<project-key>/runs/`.
- Writes `prompt-budget.json` before curator invocation.
- Returns `completed_with_pending_index` when canonical Project Memory writes succeeded but derived retrieval hints or indexing still need follow-up.

`myelin project packet <project-key> [--json]` builds a read-only Project Memory packet summary for inspection. `myelin project list [--include-legacy] [--json]` lists active projects by default and includes legacy projects only on request. `myelin project reset <project-key> --clean --confirm <project-key> [--json]` cleanly reboots a project shell and preserves the root `state/memory.db`; this is implemented and tested but is more destructive than normal maintenance. `myelin project migrate-layout <project-key>` migrates legacy layout files into the current project structure.

### Drain Experience Log Into Session Memory

Top-level `myelin ingest <project-key> [--limit N] [--batch-size N] [--provider codex|claude] [--json]` is the Experience Log to Session Memory pipeline. It is intentionally separate from Project Memory source intake.

Behavior:

- Selects queued Experience Log rows, honoring `--limit` when present.
- Batches rows by `--batch-size`; the parser enforces `1..500`.
- Defaults provider to `codex` unless overridden with `--provider claude`.
- Creates `ingest_jobs` rows and starts detached workers.
- Workers may invoke provider CLIs from the target repo cwd.
- Workers lease Experience Log rows into tombstones, create Session Memory outputs, candidates, handoff instructions, reconciliation links, and finalize tombstones.
- Warns but still starts when the target repo is not on `master`; branch context is preserved per row.

Operational inspection commands:

- `myelin ingest status <ingest-job-id> [--json]` shows one job and may mark a running detached job as `failed` if its stored PID is no longer alive.
- `myelin ingest status --project <project-key> [--json]` returns project-level completion status and refreshes stale running jobs before counting.
- `myelin ingest jobs <project-key> [--status starting|running|needs_followup|completed|failed] [--limit N] [--json]` lists jobs.
- `myelin ingest jobs resolve <project-key> (--id <job-id> | --all) --reason <text> [--code <error-code>] [--dry-run] [--json]` marks failed jobs as resolved by updating them to `completed`, clearing `error_json`, and preserving the previous error plus resolution metadata under `followup_state_json.resolved_failed_job`.
- `myelin ingest worker <ingest-job-id>` is primarily a detached-worker entrypoint, not a normal operator command.

### Query And Index Memory

`myelin memory query <project-key> <question> [--limit N] [--layer session|project|auto] [--max-inline-chars N] [--branch current|<branch>] [--json] [--debug]` queries memory through `src/query/engine.ts`. It does not call an answer-synthesis LLM. In the current slice it can query Session Memory vectors and Project Memory retrieval sections, depending on `--layer`.

Side effects:

- May create or update cached query embeddings.
- Fails closed when retrieval dependencies are unavailable.
- `--debug` includes diagnostic route/layer information in JSON output.

Indexing commands:

- `myelin memory index session <project-key> [--limit N] [--batch-size N] [--retry-failed] [--json]` calls the embedding provider unless a stub provider is configured, then writes `session_memory_embeddings` status and vector rows.
- `myelin memory index project <project-key> [--limit N] [--batch-size N] [--retry-failed] [--json]` indexes Project Memory retrieval text. This is registered in code and tested through project-memory retrieval tests, but it is less prominent in `docs/CLI.md` than Session Memory indexing.

Inspection commands:

- `myelin memory session list <project-key> [--status active|superseded|retracted] [--limit N] [--json]`
- `myelin memory session show <memory-id> [--json]`
- `myelin memory session links <project-key> [--memory <memory-id>] [--limit N] [--json]`
- `myelin memory candidates <project-key> [--status pending|needs-review|processed|rejected] [--scope session|project|practice|personal] [--json]`
- `myelin memory candidate show <candidate-id> [--json]`

### Create And Intake Runtime Inbox Items

`myelin memory inbox create <project-key> --layer project --body <text> --title <title> --rationale <text> --confidence low|medium|high --risk low|medium|high [--evidence-ref <ref>] [--target-hint <hint>] [--json]` creates an explicit durable-memory source proposal.

Side effects:

- Writes immutable preserved source JSON under `projects/<project-key>/sources/inbox/<id>.json`.
- Creates source indexes when needed.
- Does not create memory candidate rows by itself.
- Only `--layer project` is accepted in this slice.

`myelin memory inbox intake <project-key> [--json]` normalizes valid runtime inbox source records into Project Memory candidates without invoking a provider and without rewriting the source files. It creates or reuses `scope="project"`, `candidate_type="project.inbox"`, `status="needs_review"` rows.

### Maintain Schema Context

`myelin schema check <project-key>` validates generated schema context and is read-only. It rejects `--dry-run` because check never writes.

`myelin schema build <project-key> [--dry-run]` builds `projects/<project-key>/state/schema-context.json`; `--dry-run` prints generated context JSON without writing. Tests cover valid global schema compilation, dry-run non-mutation, read-only check behavior, and failure when authored global rules are invalid.

### Manual Sessions

Manual session commands are a lightweight operator log separate from hook-captured Experience Log ingestion:

- `myelin session start <project-key> [--title "..."] [--json]` writes a row to `sessions`.
- `myelin session log <project-key> <message> [--kind note|decision|finding|followup] [--session <id>] [--json]` writes a row to `session_events`.
- `myelin session close <project-key> [--summary "..."] [--session <id>] [--json]` updates the selected `sessions` row.
- `myelin session recent <project-key> [--limit N] [--json]` is read-only.
- `myelin session show <session-id> [--json]` is read-only.

Hook capture is the default provider-session path; manual sessions are for explicit operator notes.

### Install Hooks And Capture Events

`myelin install [--provider <provider>] [--apply]` previews or applies provider hook installation. Preview mode is read-only. Apply mode writes provider hook configuration and Myelin shim files.

`myelin uninstall [--provider <provider>]` previews or performs removal through the install service. The command rejects `--apply` and removes only Myelin-owned hook entries.

`myelin capture codex-hook` reads a Codex hook payload from stdin and records an Experience Log event. It is normally invoked by installed hooks, not operators. The hook fails open: malformed payloads or capture failures do not interrupt provider sessions, and `MYELIN_CAPTURE_DISABLED=1` makes it a no-op.

## JSON Modes And Output Contracts

Most operator commands default to human-readable output and expose structured output through `--json`. The notable implementation exception is `bootstrap`, which currently has no JSON flag despite Make usage examples suggesting `ARGS='--json'` can be passed.

JSON output is command-specific:

- `status --json` emits the facade response contract.
- `project learn --json` emits the structured run result, including artifacts and write status.
- `project packet --json` emits the full packet.
- `ingest --json` emits the start result without the internal `kind` discriminator.
- `ingest status --json` emits `{ "job": ... }` or `{ "status": ... }`.
- `ingest jobs --json` emits `{ "jobs": [...] }`.
- `ingest jobs resolve --json` emits `{ "dry_run": boolean, "resolved": [...] }`.
- `memory query --json` emits query response fields such as matches, citations, confidence, degraded reason, and source tools.
- `memory inbox`, `memory session`, `memory candidate`, `memory index`, `session`, and `project list/reset` commands emit command-specific structured payloads.

## Implementation Notes For Future Agents

The CLI parser is intentionally simple: `src/commands/registry.ts` matches the longest registered path prefix and passes remaining arguments to that handler. Unknown commands return help with the registered command list. Most individual command parsers reject unknown options and unexpected extra positional arguments.

Commands use repository root discovery through `repoRoot().root`, so tests frequently change `process.cwd()` into a temporary root before registering a command. Provider-backed commands accept dependency injection in tests, which is why behavior like detached ingest spawning, project learning stubs, and PID liveness checks can be verified without real provider calls.

Keep the conceptual split clear:

- Project Memory maintenance is `project learn`.
- Runtime Project inbox source normalization is `memory inbox intake` and also runs inside `project learn`.
- Experience Log to Session Memory processing is top-level `ingest`.
- Retrieval availability depends on explicit indexing commands.

## Known Gaps

- `README.md` lists `myelin project onboard <key>` / `make onboard PROJECT=<key>`, but this snapshot implements `bootstrap` and has no registered `project onboard` command or `make onboard` target.
- `docs/CLI.md` is canonical for operator reference but omits or under-documents some registered implementation-visible commands: `project list`, `project packet`, `project reset`, and `memory index project`.
- `bootstrap` has no JSON mode in `src/commands/bootstrap.ts`, despite the Makefile usage string allowing arbitrary `ARGS`.
- The query docs say the current slice queries indexed Session Memory vectors, while tests and implementation also cover Project Memory layer retrieval through `--layer project`; future docs should clarify the current multi-layer query shape.
