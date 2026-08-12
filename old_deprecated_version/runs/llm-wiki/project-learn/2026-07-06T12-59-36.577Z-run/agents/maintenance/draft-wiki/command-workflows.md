# Command Workflows

Myelin's operator workflow is centered on the `myelin` CLI, with the root `Makefile` acting as a thin convenience layer over the same Bun/TypeScript entrypoint.

The installed form is `myelin <command>`. In a repo checkout, the equivalent local form is `bun src/cli.ts <command>` (`README.md`, `docs/CLI.md`). `src/cli.ts` constructs the command registry and registers the active command groups from `src/commands/`: `status`, `bootstrap`, `capture`, `install`, `ingest`, `memory`, `project`, `session`, and `schema`.

## Vocabulary and entrypoints

Myelin V2 intentionally uses product-language command names rather than V1 pipeline names. `docs/adr/0016-use-v2-cli-vocabulary.md` says V2 should name product concepts directly instead of preserving `compile` and `update`; `docs/adr/0017-use-learn-ingest-query-session-cli-verbs.md` maps the intended language to `project learn`, ingest, query, and session verbs. Current docs and code refine that split:

- `myelin project learn <key>` is the broad Project Memory learning workflow.
- Top-level `myelin ingest <key>` is the Experience Log to Session Memory workflow.
- `myelin memory query <key> "<question>"` is the operator query facade.
- `myelin schema check/build <key>` validates or regenerates project schema context.
- `myelin bootstrap <key> --repo <absolute-path>` creates or updates the project shell for a repository.

The root `Makefile` sets `MYELIN := bun src/cli.ts` and forwards targets to the CLI. Its active aliases are `status`, `query`, `learn`, `ingest`, `bootstrap`, `schema-check`, `schema-build`, `session-close`, `test`, and `typecheck` (`Makefile`). These targets validate required variables such as `PROJECT`, `QUESTION`, and `REPO`, then pass optional `ARGS` through to the CLI. The Makefile is therefore an operator shortcut, not a separate product API.

## Daily operator loop

Use `myelin status [project-key] [--json]` or `make status PROJECT=<key>` to inspect a project. With no project key, status resolves the project from the current working directory. The command is read-only and renders a human summary by default, with a structured facade response under `--json` (`docs/CLI.md`, `src/commands/status.ts`).

Use `myelin memory query <key> "<question>"` or `make query PROJECT=<key> QUESTION="..."` to query indexed Session Memory vectors. The query path is deterministic retrieval, not answer synthesis: `src/commands/memory.ts` calls `src/query/engine.ts`, returns the answer text by default, and fails if the response is degraded. `--json` returns structured matches, citations, confidence, degraded state, and source tools; `--debug` includes route/layer diagnostics. Query may create or update cached query embeddings, but it does not call an answer-synthesis LLM (`docs/CLI.md`).

Use `myelin project learn <key>` or `make learn PROJECT=<key>` to refresh curated Project Memory from repo evidence, source proposals, and run packets. This command may invoke provider CLIs, writes run artifacts under `projects/<key>/runs/`, writes `prompt-budget.json` before curator invocation, runs deterministic runtime inbox intake before packet construction, and may update Project Memory outputs unless stopped by `--dry-run`, review gates, validation failure, or another stop condition (`docs/CLI.md`, `src/commands/project.ts`). Its human output reports status, mode, run directory, validation result, whether writes were stopped, applied pages/items, changed files, and pending retrieval indexing when applicable.

`project learn` is designed to auto-apply routine curated updates by default while preserving controls. `docs/adr/0019-project-learn-auto-applies-by-default.md` establishes that default; `docs/adr/0020-gate-risky-project-learn-changes.md` requires review or dry-run handling for destructive deletes, decision-record supersession, low-confidence synthesis, conflicting sources, broad rewrites, or explicit `--review` / `--dry-run`. The code also accepts `--provider codex|claude`, `--model <model>`, `--review`, `--dry-run`, `--recreate`, and `--json` (`src/commands/project.ts`).

Use `myelin ingest <key>` or `make ingest PROJECT=<key>` for the separate Experience Log to Session Memory pipeline. It batches queued Experience Log rows, creates `ingest_jobs`, and launches detached provider-backed worker processes. Workers run from the target repo, lease rows into tombstones, invoke the selected provider runtime, write Session Memory outputs, candidates, handoff instructions, reconciliation links, and finalize tombstones (`docs/CLI.md`, `src/commands/ingest.ts`). `--limit` caps selected rows, `--batch-size` must be `1..500`, `--provider` is `codex` or `claude`, and `--json` emits the structured start result. The default provider in `src/commands/ingest.ts` is `codex`; environment/config profiles can still affect provider behavior elsewhere.

## Project setup and schema workflows

`myelin bootstrap <key> --repo <absolute-path>` creates or updates the project shell under `projects/<key>/` for a software repository and rejects a repo path already registered to another project key (`docs/CLI.md`, `src/commands/bootstrap.ts`). The Makefile alias is `make bootstrap PROJECT=<key> REPO=<path>`.

`myelin schema check <key>` is read-only validation of generated schema context. `myelin schema build <key>` builds `projects/<key>/state/schema-context.json`; `--dry-run` prints the generated context without writing (`docs/CLI.md`, `src/commands/schema.ts`). The Makefile aliases are `schema-check` and `schema-build`.

`myelin project migrate-layout <key>` migrates legacy project layout into the current directory structure and reports the number of project actions (`docs/CLI.md`, `src/commands/project.ts`). `myelin project packet <key> [--json]` builds a read-only bounded Project Memory packet and is useful for inspecting what a learning run would hand to curation logic. `myelin project list [--include-legacy] [--json]` lists active projects by default. `myelin project reset <key> --clean --confirm <key> [--json]` is a clean rebootstrap path exposed in code; because it deletes/rebuilds project shell state, it should be treated as a high-impact operator command even though it is not covered in `docs/CLI.md`.

## Runtime inbox and candidate workflows

`myelin memory inbox create <key> --layer project --body <text> --title <title> --rationale <text> --confidence low|medium|high --risk low|medium|high` creates an explicit runtime durable-memory source proposal. It writes immutable JSON under `projects/<key>/sources/inbox/<id>.json` and creates source index files when needed, but it does not create memory candidate rows by itself (`docs/CLI.md`, `src/commands/memory.ts`).

`myelin memory inbox intake <key>` deterministically normalizes valid Project runtime inbox source records into Project Memory candidates without invoking a provider. It creates or reuses `memory_candidates` rows with `scope="project"`, `candidate_type="project.inbox"`, and `status="needs_review"`; it does not rewrite runtime inbox source files (`docs/CLI.md`, `src/commands/memory.ts`). `project learn` runs this intake before packet construction, so operators usually do not need to run intake separately unless they are inspecting candidate creation.

Candidate inspection commands are read-only: `myelin memory candidates <key> [--status ...] [--scope ...] [--json]` lists candidates, and `myelin memory candidate show <candidate-id> [--json]` shows one candidate (`docs/CLI.md`, `src/commands/memory.ts`).

## Session Memory, retrieval indexes, and inspection

Session Memory indexing is explicit operator work. `myelin memory index session <key> [--limit N] [--batch-size N] [--retry-failed] [--json]` calls the active embedding provider unless a stub provider is configured, then writes `session_memory_embeddings` status and vector-table rows (`docs/CLI.md`, `src/commands/memory.ts`). `myelin memory index project <key>` is also registered in code and indexes Project Memory retrieval data, reporting selected, indexed, failed, and pending counts; it is not yet documented in `docs/CLI.md`.

Session Memory inspection is read-only: `myelin memory session list <key>`, `myelin memory session show <memory-id>`, and `myelin memory session links <key>` list active/superseded/retracted memories and lifecycle links (`docs/CLI.md`, `src/commands/memory.ts`).

Manual session commands are separate from hook-captured Experience Log ingestion. `myelin session start <key>`, `myelin session log <key> <message>`, `myelin session close <key>`, `myelin session recent <key>`, and `myelin session show <session-id>` write or inspect rows in `sessions` and `session_events` (`docs/CLI.md`, `src/commands/session.ts`). The Makefile exposes only `session-close`.

## Ingest job operations

After `myelin ingest <key>` starts detached work, operators can inspect and reconcile jobs:

- `myelin ingest status <job-id> [--json]` shows one job.
- `myelin ingest status --project <key> [--json]` shows project-level ingest completion status.
- `myelin ingest jobs <key> [--status ...] [--limit N] [--json]` lists jobs.
- `myelin ingest jobs resolve <key> (--id <job-id> | --all) --reason <text> [--code <error-code>] [--dry-run] [--json]` marks failed jobs as resolved.

Status calls may refresh stale detached running jobs to `failed` if the PID is no longer alive (`docs/CLI.md`). Resolving jobs is mutating unless `--dry-run` is used: it updates matched failed jobs to `completed`, clears `error_json`, and stores previous error plus resolution metadata in `followup_state_json.resolved_failed_job` (`docs/CLI.md`, `src/commands/ingest.ts`).

`myelin ingest worker <ingest-job-id>` is primarily an internal detached-worker entrypoint. It reads `MYELIN_ROOT` when set, otherwise uses the repo root, then runs the stored worker input for the job (`src/commands/ingest.ts`).

## Installation and capture hooks

`myelin install [--provider <provider>]` previews provider hook installation; adding `--apply` writes provider hook configuration and Myelin shim files. `myelin uninstall [--provider <provider>]` removes Myelin-owned provider hook entries through the install service and intentionally does not accept `--apply` (`docs/CLI.md`, `src/commands/install.ts`).

`myelin capture codex-hook` is normally invoked by installed Codex hooks, not directly by operators. It reads a hook payload from stdin, records an Experience Log event through the capture service, and fails open so malformed payloads or capture failures do not interrupt provider sessions. Setting `MYELIN_CAPTURE_DISABLED=1` makes it a no-op (`docs/CLI.md`, `src/commands/capture.ts`).

## Verification commands

Normal development verification uses Bun. `README.md` documents `bun test`, `bun run typecheck`, `make test`, and `make typecheck`; the Makefile maps those two targets directly to Bun. These commands do not mutate Project Memory, but tests may write test/runtime artifacts depending on test configuration.

## Compatibility and known command mismatches

Do not reintroduce V1 command names as primary product vocabulary. `README.md` maps `make compile PROJECT=<key>` to `myelin project learn <key>` / `make learn PROJECT=<key>`, and `make update PROJECT=<key>` to top-level `myelin ingest <key>` / `make ingest PROJECT=<key>`. `docs/CLI.md` also explicitly says there is no active `myelin project ingest <key>` command; Project Memory runtime-inbox intake happens inside `project learn`, while top-level `ingest` processes Experience Log rows into Session Memory.

One current documentation/code mismatch remains: `README.md` maps `make init PROJECT=<key>` to `myelin project onboard <key>` / `make onboard PROJECT=<key>`, but `src/cli.ts`, `src/commands/project.ts`, and `Makefile` do not register `project onboard` or `make onboard`. The active setup command in the current code is `bootstrap`.
