# Operator CLI Workflows

Operator CLI workflows in Myelin are Bun/TypeScript commands exposed through the `myelin` binary or the repo-local `bun src/cli.ts` entrypoint, with a thin `Makefile` layer for common tasks.

## Command Surface

The root CLI entrypoint is `src/cli.ts`. It creates a `myelin` registry and registers `status`, `bootstrap`, `capture`, `install`, `uninstall`, `ingest`, `memory`, `project`, `session`, and `schema` commands from `src/commands/`. The command registry matches the longest registered path first, so subcommands such as `ingest jobs resolve` take precedence over broader handlers such as `ingest jobs` and `ingest`.

`docs/CLI.md` is the canonical operator reference for purpose, options, output, and side effects. The implementation has a few additional supported commands that are tested but not fully documented there: `project list`, `project packet`, `project reset`, and `memory index project`.

Myelin V2 vocabulary avoids old V1 command names. Current product-language commands are:

| Operator task | Primary command | Make alias |
| --- | --- | --- |
| Show project status | `myelin status [project-key] [--json]` | `make status PROJECT=<key> [ARGS='--json']` |
| Bootstrap a project shell | `myelin bootstrap <key> --repo <absolute-path>` | `make bootstrap PROJECT=<key> REPO=<path>` |
| Validate generated schema context | `myelin schema check <key>` | `make schema-check PROJECT=<key>` |
| Build generated schema context | `myelin schema build <key> [--dry-run]` | `make schema-build PROJECT=<key>` |
| Run broad Project Memory learning | `myelin project learn <key> [--dry-run] [--review] [--recreate] [--provider codex|claude] [--model <model>] [--json]` | `make learn PROJECT=<key> [ARGS='...']` |
| Drain Experience Log rows into Session Memory | `myelin ingest <key> [--limit N] [--batch-size N] [--provider codex|claude] [--json]` | `make ingest PROJECT=<key> [ARGS='...']` |
| Query memory | `myelin memory query <key> "<question>" [--limit N] [--layer session|project|auto] [--max-inline-chars N] [--branch current|<name>] [--json] [--debug]` | `make query PROJECT=<key> QUESTION="..." [ARGS='--json']` |
| Index Session Memory vectors | `myelin memory index session <key> [--limit N] [--batch-size N] [--retry-failed] [--json]` | none |
| Index Project Memory retrieval rows | `myelin memory index project <key> [--limit N] [--batch-size N] [--retry-failed] [--json]` | none |
| Close a manual session | `myelin session close <key> [--summary "..."] [--session <id>] [--json]` | `make session-close PROJECT=<key>` |

The README maps older habits to the V2 names: `compile` becomes `project learn`, `update` becomes top-level `ingest`, `ask` becomes `memory query`, and `init` becomes `project onboard` in product vocabulary. The current source tree does not register `project onboard`; `bootstrap` is the implemented project-shell creation command.

## Makefile Aliases

The `Makefile` is intentionally a thin wrapper around `MYELIN := bun src/cli.ts`. It does not own product behavior. Each target validates required variables and forwards optional `ARGS`:

- `status`, `query`, `learn`, `ingest`, `bootstrap`, `schema-check`, `schema-build`, and `session-close` call the matching CLI commands.
- `test` runs `bun test`.
- `typecheck` runs `bun run typecheck`.

New automation should call the CLI command vocabulary directly unless the Make alias is useful for humans. Do not add Make targets that reintroduce V1 vocabulary as primary product language.

## Status And Bootstrap

`myelin status [project-key] [--json]` resolves a project by explicit key or from the current working directory. It is read-only. Human output renders a project summary; `--json` returns the structured status facade response from `StatusService`.

`myelin bootstrap <key> --repo <absolute-path>` creates or updates a project shell under `projects/<key>/`. It writes project state and memory shell artifacts and rejects repository paths already registered to another project key. The implementation prints created, kept, moved, and removed counts; `docs/CLI.md` documents bootstrap as human output only, and `bootstrap.ts` does not currently accept `--json`.

## Schema Workflow

Schema work is split between read-only validation and generated-context rebuild:

- `schema check <key>` validates `projects/<key>/state/schema-context.json` and is always read-only. Passing `--dry-run` is rejected because check mode already has no writes.
- `schema build <key>` writes `projects/<key>/state/schema-context.json` when the generated context is stale.
- `schema build <key> --dry-run` prints the generated context JSON without writing.

`project learn` verifies schema freshness before learning work, so operators normally run `schema build` when schema inputs change and `schema check` before diagnosing learn/query failures.

## Project Memory Learning

`myelin project learn <key>` is the broad Project Memory refresh workflow. It may invoke provider CLIs, build run packets, process runtime inbox source proposals, create run artifacts under `projects/<key>/runs/`, and apply Project Memory writes unless stopped by dry-run or review gates.

Important options:

- `--dry-run` previews without committing writes.
- `--review` runs a review-oriented mode.
- `--recreate` is implemented in `src/commands/project.ts` and requests recreation behavior from `ProjectService`.
- `--provider codex|claude` and `--model <model>` override runtime provider selection.
- `--json` emits the structured run result.

Before packet construction, `project learn` runs deterministic runtime inbox intake for valid `projects/<key>/sources/inbox/*.json` Project Memory proposals. A successful run can return `completed_with_pending_index`, which means canonical markdown writes succeeded but derived retrieval rows or indexing still need follow-up.

`project packet <key> [--json]` is a read-only inspection command. Human output summarizes packet mode, wiki page count, pending handoffs/candidates, selected Session Memory count, lookup queries, and degraded state; `--json` emits the full packet. This is useful before debugging learn prompts or curator inputs.

`project list [--include-legacy] [--json]` lists active projects by default and includes archived V1 projects only with `--include-legacy`.

`project reset <key> --clean --confirm <key> [--json]` performs a clean project-shell rebootstrap. Tests show it deletes the project shell content such as old wiki and project-memory state while preserving the root `state/memory.db`. This is a high-impact operator command and requires explicit confirmation.

`project migrate-layout <key>` migrates legacy project layout files into the current structure.

There is no active `myelin project ingest <key>` command. Project Memory runtime-inbox intake belongs inside `project learn`; Experience Log to Session Memory processing is the top-level `ingest <key>` command.

## Experience Log Ingest

Top-level `myelin ingest <key>` starts detached provider-backed workers that transform queued Experience Log rows into Session Memory, memory candidates, handoff instructions, reconciliation links, and tombstone finalization.

Important options:

- `--limit N` caps selected Experience Log rows.
- `--batch-size N` controls rows per detached worker and must be between 1 and 500.
- `--provider codex|claude` overrides the default provider.
- `--json` emits structured job-start data.

The default provider in the command parser is `codex`; config can also supply ingest batch defaults. The command creates `ingest_jobs` rows and launches one detached worker per selected batch. It warns, but still starts, when the registered target repo is on a non-`master` branch; branch context is preserved per row.

Inspection and repair commands:

- `ingest status <job-id> [--json]` shows one job. It may mark a stale running job as `failed` when the stored PID is no longer alive.
- `ingest status --project <key> [--json]` reports project-level ingest completion status and may refresh stale jobs before counting.
- `ingest jobs <key> [--status starting|running|needs_followup|completed|failed] [--limit N] [--json]` lists jobs for investigation.
- `ingest jobs resolve <key> (--id <job-id> | --all) --reason <text> [--code <error-code>] [--dry-run] [--json]` marks failed jobs resolved when the operator has determined they are environmental or non-actionable. Without `--dry-run`, it updates matched failed jobs to `completed`, clears `error_json`, and stores previous error plus resolution metadata in `followup_state_json.resolved_failed_job`.
- `ingest worker <job-id>` is primarily called by detached workers. It reads stored worker input and runs the worker runtime.

## Memory Inbox, Query, And Indexing

`memory inbox create <key> --layer project --body <text> --title <title> --rationale <text> --confidence low|medium|high --risk low|medium|high [--evidence-ref <ref>] [--target-hint <hint>] [--json]` creates an immutable runtime inbox source proposal under `projects/<key>/sources/inbox/<id>.json`. Only `--layer project` is accepted in this slice. The command may create source index files, but it does not create memory candidate rows.

`memory inbox intake <key> [--json]` deterministically normalizes valid Project runtime inbox source records into `scope="project"`, `candidate_type="project.inbox"`, `status="needs_review"` memory candidates. It does not invoke a provider and does not rewrite source files.

`memory query <key> "<question>"` is the operator query facade. In the current implementation it can query Session Memory vectors and Project Memory retrieval rows depending on `--layer session|project|auto`. `--json` emits structured response fields including answer text, confidence/degradation metadata, citations, matches, and source tools. `--debug` includes route/layer diagnostics. Querying may create or update cached query embeddings, but it does not call an answer-synthesis LLM.

`memory index session <key>` calls the embedding provider unless a stub provider is configured, then updates `session_memory_embeddings` status and vector rows. `memory index project <key>` indexes derived Project Memory retrieval rows. Both support `--limit`, `--batch-size`, `--retry-failed`, and `--json`; batch size is bounded by the embedding configuration maximum.

Inspection commands:

- `memory session list <key> [--status active|superseded|retracted] [--limit N] [--json]`
- `memory session show <memory-id> [--json]`
- `memory session links <key> [--memory <memory-id>] [--limit N] [--json]`
- `memory candidates <key> [--status pending|needs-review|processed|rejected] [--scope session|project|practice|personal] [--json]`
- `memory candidate show <candidate-id> [--json]`

These inspection commands are read-only.

## Manual Sessions And Capture Hooks

Manual `session` commands are a lightweight operator log separate from hook-captured Experience Log ingestion:

- `session start <key> [--title "..."] [--json]` writes a `sessions` row.
- `session log <key> <message> [--kind note|decision|finding|followup] [--session <id>] [--json]` writes a `session_events` row. The parser joins extra positional words into the message.
- `session close <key> [--summary "..."] [--session <id>] [--json]` updates the selected session row.
- `session recent <key> [--limit N] [--json]` is read-only.
- `session show <session-id> [--json]` is read-only.

Hook capture is the default provider-session path. `capture codex-hook` reads a Codex hook payload from stdin and records an Experience Log event through `CaptureService`. It fails open: malformed payloads or capture failures do not interrupt provider sessions. It no-ops when `MYELIN_CAPTURE_DISABLED=1`. `MYELIN_ROOT` can override root resolution for hook and ingest worker contexts.

## Install And Uninstall

`install [--provider <provider>] [--apply]` previews or applies provider hook installation. Preview mode is read-only; apply mode writes provider hook configuration and Myelin shim files through `InstallService`.

`uninstall [--provider <provider>]` removes only Myelin-owned provider hook entries through the install service. It does not accept `--apply`.

## JSON Output Modes

Human-readable output is the default for operator commands. `--json` is available on most inspection and workflow commands and is the correct mode for scripts, tests, and detached consumers.

Supported JSON surfaces include `status`, `project list`, `project packet`, `project learn`, `project reset`, top-level `ingest`, `ingest status`, `ingest jobs`, `ingest jobs resolve`, `memory inbox create`, `memory inbox intake`, `memory query`, memory/session inspection commands, memory candidate commands, memory indexing commands, and manual session commands.

Not every command has JSON mode. `bootstrap`, `schema check`, `project migrate-layout`, `ingest worker`, `install`, `uninstall`, and `capture codex-hook` currently render text or empty hook output only. `schema build --dry-run` emits JSON context, but that is controlled by `--dry-run`, not `--json`.

## Normal Operator Flows

For a new repository:

1. Run `myelin bootstrap <key> --repo <absolute-path>` or `make bootstrap PROJECT=<key> REPO=<path>`.
2. Run `myelin schema build <key>` and `myelin schema check <key>`.
3. Run `myelin project learn <key> --dry-run` to preview broad Project Memory work.
4. Run `myelin project learn <key>` to apply accepted Project Memory writes.
5. If the result reports pending retrieval indexing, run `myelin memory index project <key>`.
6. Verify with `myelin status <key>` and `myelin memory query <key> "What should I know?" --json`.

For routine maintenance:

1. Capture provider sessions through installed hooks.
2. Run `myelin ingest status --project <key>` to check whether Experience Log ingest is pending.
3. Run `myelin ingest <key>` to start detached workers.
4. Inspect `myelin ingest jobs <key> --status failed --json` when completion stalls.
5. Resolve known environmental failures with `ingest jobs resolve` only after recording a reason.
6. Run `myelin memory index session <key>` after Session Memory rows are created.
7. Use `memory session list/show/links` and `memory candidates` to inspect outputs and follow-up items.

For explicit Project Memory source proposals:

1. Run `memory inbox create` with a concrete title, body, rationale, confidence, risk, and optional evidence refs.
2. Run `memory inbox intake <key>` for deterministic candidate creation, or let the next `project learn` run perform intake before packet construction.
3. Run `project packet <key> --json` or `project learn <key> --dry-run --json` to inspect what the curator will see.

## Known Gaps

- `docs/CLI.md` is detailed but incomplete relative to implemented commands: it omits `project list`, `project packet`, `project reset`, `memory index project`, `project learn --recreate`, and `memory query --layer/--max-inline-chars`.
- README mentions `myelin project onboard <key>` and `make onboard PROJECT=<key>` as V2 vocabulary, but `src/cli.ts`, `src/commands/project.ts`, and the current `Makefile` do not register those surfaces.
- `docs/CLI.md` documents `bootstrap` output without JSON, matching implementation; the Makefile usage string allows `ARGS='--json'`, but `bootstrap.ts` would reject `--json` as an unknown option.
- Session Memory vector retrieval is implemented and Project Memory retrieval rows are supported, but README still describes broader MCP exposure, Current Briefing integration, and non-Session Memory vectorization as deferred.

## Evidence

- `docs/CLI.md` is the canonical command reference for documented commands, options, side effects, and examples.
- `README.md` describes quick start commands, V1-to-V2 vocabulary, JSON query response fields, and compatibility naming.
- `Makefile` defines thin aliases around `bun src/cli.ts`.
- `src/cli.ts` and `src/commands/registry.ts` define the registered command surface and path matching behavior.
- `src/commands/project.ts`, `src/commands/ingest.ts`, `src/commands/memory.ts`, `src/commands/schema.ts`, `src/commands/session.ts`, `src/commands/status.ts`, `src/commands/bootstrap.ts`, `src/commands/install.ts`, and `src/commands/capture.ts` define command parsing, JSON modes, and side effects.
- `tests/commands/project.test.ts`, `tests/commands/ingest.test.ts`, `tests/commands/memory.test.ts`, `tests/commands/schema.test.ts`, `tests/commands/session.test.ts`, `tests/commands/status.test.ts`, `tests/commands/bootstrap.test.ts`, `tests/commands/install.test.ts`, and `tests/commands/capture.test.ts` verify major operator-facing contracts.
