# CLI Reference

This is the canonical reference for Myelin CLI commands.

Use either the installed `myelin` binary or the repo-local form:

```bash
bun src/cli.ts <command>
```

The sections below document purpose, usage, options, output, and side effects. Commands that mutate SQLite, project files, provider hooks, or launch detached workers call that out explicitly.

## status

### `myelin status [project-key] [--json]`

Shows project status for a specific project key, or resolves the project from the current working directory when no key is supplied.

Arguments:

- `project-key`: optional project key.

Options:

- `--json`: emit the structured status facade response.

Output:

- Human-readable project summary by default.
- JSON facade response with `--json`.

Side effects:

- Read-only.

Examples:

```bash
myelin status wizepal
myelin status --json
```

## bootstrap

### `myelin bootstrap <project-key> --repo <absolute-path>`

Creates or updates the Myelin project shell for a software repository.

Arguments:

- `project-key`: stable Myelin project key.

Options:

- `--repo <absolute-path>`: absolute path to the repository being bootstrapped.

Output:

- Bootstrapped project key, repo path, created artifact count, and kept artifact count.

Side effects:

- Writes project state and memory shell under `projects/<project-key>/`.
- Rejects repo paths already registered to another project key.

Examples:

```bash
myelin bootstrap wizepal --repo /Users/liadgoren/Wizepal/droplet-bot
```

## schema

### `myelin schema check <project-key>`

Validates the generated schema context for a project.

Arguments:

- `project-key`: project to validate.

Options:

- None.

Output:

- Success message, or validation errors.

Side effects:

- Read-only.

### `myelin schema build <project-key> [--dry-run]`

Builds generated schema context for a project.

Arguments:

- `project-key`: project to build.

Options:

- `--dry-run`: print generated context JSON without writing it.

Output:

- Write/current message by default.
- Generated context JSON with `--dry-run`.

Side effects:

- Writes `projects/<project-key>/state/schema-context.json` unless `--dry-run` is used.

Examples:

```bash
myelin schema check class-kit
myelin schema build class-kit
myelin schema build class-kit --dry-run
```

## project

### `myelin project learn <project-key> [--dry-run] [--review] [--provider codex|claude] [--model <model>] [--json]`

Runs the broad project-memory learning pipeline.

Arguments:

- `project-key`: project to learn.

Options:

- `--dry-run`: preview without committing writes.
- `--review`: run in review-oriented mode.
- `--provider codex|claude`: provider override.
- `--model <model>`: model override.
- `--json`: emit structured result JSON.

Output:

- Human-readable run summary by default.
- Structured run result with `--json`.
- Status `completed_with_pending_index` means canonical Project Memory writes succeeded, but derived retrieval hints or indexing still need follow-up.

Side effects:

- May invoke provider CLIs.
- Runs deterministic runtime inbox intake before packet construction, creating or reusing Project Memory candidates for valid `projects/<project-key>/sources/inbox/*.json` source proposals.
- Writes `prompt-budget.json` before curator invocation. Codex-backed curator prompts reference run artifacts instead of inlining the full packet; bounded inline prompt fallback can reduce supporting packet context when needed.
- May write run artifacts under `projects/<project-key>/runs/`.
- May update project memory outputs unless `--dry-run` stops writes.

### `myelin project ingest <project-key> [--dry-run] [--review] [--provider codex|claude] [--model <model>] [--json]`

Processes queued source/inbox material through the project-memory pipeline. This is distinct from top-level `myelin ingest`, which processes Experience Log rows into Session Memory.

Arguments and options:

- Same parser shape as `project learn`.

Side effects:

- May invoke provider CLIs.
- May drain queued source/inbox material and write project memory artifacts.

### `myelin project migrate-layout <project-key>`

Migrates legacy project layout into the current project directory structure.

Arguments:

- `project-key`: project to migrate.

Options:

- None.

Side effects:

- Moves or creates project layout files/directories as needed.

Examples:

```bash
myelin project learn class-kit --dry-run
myelin project ingest class-kit
myelin project migrate-layout class-kit
```

## ingest

Top-level `ingest` is the Experience Log to Session Memory pipeline.

### `myelin ingest <project-key> [--limit N] [--batch-size N] [--provider codex|claude] [--json]`

Starts detached provider-backed workers that transform queued Experience Log rows into Session Memory, candidates, and handoff instructions.

Arguments:

- `project-key`: project whose Experience Log rows should be drained.

Options:

- `--limit N`: maximum Experience Log rows to select.
- `--batch-size N`: rows per detached worker batch. Must be `1..500`.
- `--provider codex|claude`: provider override.
- `--json`: emit structured start result.

Output:

- Started job count, queued count, selected count, and batch size.
- Warns when the registered target repo is on a non-`master` branch; this is warning-only.

Side effects:

- Creates `ingest_jobs` rows.
- Launches detached worker processes.
- Workers may invoke provider CLIs from the target repo cwd.
- Workers lease Experience Log rows into tombstones, create Session Memory outputs, and finalize tombstones.

Examples:

```bash
myelin ingest wizepal
myelin ingest class-kit --limit 50 --batch-size 25 --json
```

### `myelin ingest status <ingest-job-id> [--json]`

Shows one ingest job.

Arguments:

- `ingest-job-id`: job id to inspect.

Options:

- `--json`: emit `{ "job": ... }`.

Side effects:

- May refresh a stale detached running job to `failed` if its PID is no longer alive.

### `myelin ingest status --project <project-key> [--json]`

Shows project-level ingest completion status.

Options:

- `--project <project-key>`: project to inspect.
- `--json`: emit `{ "status": ... }`.

Side effects:

- May refresh stale detached running jobs before counting.

Examples:

```bash
myelin ingest status ingest_2026-06-17T16-18-48.233Z_110a77 --json
myelin ingest status --project wizepal --json
```

### `myelin ingest jobs <project-key> [--status starting|running|needs_followup|completed|failed] [--limit N] [--json]`

Lists ingest jobs for investigation.

Arguments:

- `project-key`: project whose jobs should be listed.

Options:

- `--status <status>`: optional job status filter.
- `--limit N`: maximum rows to return. Default `50`.
- `--json`: emit `{ "jobs": [...] }`.

Side effects:

- Read-only.

Examples:

```bash
myelin ingest jobs class-kit --status failed --json
myelin ingest jobs class-kit --status failed --limit 10
```

### `myelin ingest jobs resolve <project-key> (--id <job-id> | --all) --reason <text> [--code <error-code>] [--dry-run] [--json]`

Marks failed ingest jobs as resolved when the operator has determined they are environmental or otherwise non-actionable failures.

Arguments:

- `project-key`: project whose failed jobs should be resolved.

Options:

- `--id <job-id>`: resolve a specific failed job. May be repeated.
- `--all`: target all failed jobs for the project.
- `--reason <text>`: required explanation.
- `--code <error-code>`: optional filter against `error_json.code`.
- `--dry-run`: show matched jobs without updating them.
- `--json`: emit `{ "dry_run": boolean, "resolved": [...] }`.

Output:

- Count of jobs that would be or were resolved.

Side effects:

- Without `--dry-run`, updates matched failed jobs to `completed`.
- Clears `error_json`.
- Stores previous error and resolution metadata under `followup_state_json.resolved_failed_job`.

Examples:

```bash
myelin ingest jobs resolve class-kit --all --reason "environment cleanup" --dry-run --json
myelin ingest jobs resolve class-kit --all --code detached_worker_exited --reason "environment cleanup"
myelin ingest jobs resolve class-kit --id ingest_2026-06-17T15-58-53.443Z_afb829 --reason "obsolete branch policy failure"
```

### `myelin ingest worker <ingest-job-id>`

Runs the worker runtime for an existing job. This is primarily called by detached ingest workers.

Arguments:

- `ingest-job-id`: job id with stored worker input.

Side effects:

- Leases Experience Log rows.
- Invokes provider runtime.
- Writes Session Memory outputs, memory candidates, handoff instructions, reconciliation links, and tombstone finalization.

## memory

### `myelin memory inbox create <project-key> --layer project --body <text> --title <title> --rationale <text> --confidence low|medium|high --risk low|medium|high [--evidence-ref <ref>] [--target-hint <hint>] [--json]`

Creates an explicit runtime durable-memory inbox source proposal for Project Memory.

Arguments:

- `project-key`: project that owns the proposal.

Options:

- `--layer project`: required. Practice and Personal layers are not accepted until their consumers exist.
- `--body <text>`: required source/proposal text.
- `--title <title>`: required short summary.
- `--rationale <text>`: required explanation for why this should become durable memory.
- `--confidence low|medium|high`: required proposal confidence signal.
- `--risk low|medium|high`: required proposal risk signal.
- `--evidence-ref <ref>`: optional repeatable source reference.
- `--target-hint <hint>`: optional curator routing hint.
- `--json`: emit the structured creation result.

Output:

- Human-readable created item id, source ref, path, confidence, and risk by default.
- Structured creation result with `--json`.

Side effects:

- Writes immutable preserved source JSON under `projects/<project-key>/sources/inbox/<id>.json`.
- Creates `projects/<project-key>/sources/index.md` and `projects/<project-key>/sources/inbox/index.md` when needed.
- Does not create memory candidate rows. Use `myelin memory inbox intake <project-key>` or `myelin project learn <project-key>` after this command.

### `myelin memory inbox intake <project-key> [--json]`

Deterministically normalizes valid Project runtime inbox source records into Project Memory candidates without invoking a provider.

Arguments:

- `project-key`: project whose runtime inbox source records should be normalized.

Options:

- `--json`: emit the structured intake summary.

Output:

- Human-readable counts for created, existing, terminal duplicate, skipped, unsupported, and invalid source records by default.
- Structured intake summary with `--json`.

Side effects:

- Creates or reuses `memory_candidates` rows for valid `projects/<project-key>/sources/inbox/*.json` files.
- Creates only `scope="project"`, `candidate_type="project.inbox"`, `status="needs_review"` candidates in this slice.
- Does not invoke the Project Memory Curator.
- Does not rewrite runtime inbox source files.

### `myelin memory query <project-key> <question> [--limit N] [--branch current|<branch>] [--json] [--debug]`

Queries indexed Session Memory vectors and returns deterministic matches.

Arguments:

- `project-key`: project to query.
- `question`: natural-language query.

Options:

- `--limit N`: number of matches. Default `5`.
- `--branch current|<branch>`: filter matches by captured branch context. `current` resolves the registered repo branch.
- `--json`: emit structured query response.
- `--debug`: include diagnostic route/layer information.

Output:

- Human-readable list of matched Session Memory rows by default.
- JSON response with matches, citations, confidence, degraded reason, and source tools with `--json`.

Side effects:

- May create or update cached query embeddings.
- Does not call an answer-synthesis LLM.

Examples:

```bash
myelin memory query wizepal "What did we decide about sqlite-vec?"
myelin memory query wizepal "What did we last work on in this branch?" --branch current --json
```

### `myelin memory index session <project-key> [--limit N] [--batch-size N] [--retry-failed] [--json]`

Indexes pending Session Memory embeddings for retrieval.

Arguments:

- `project-key`: project whose Session Memory rows should be indexed.

Options:

- `--limit N`: maximum rows to select. Default embedding batch size.
- `--batch-size N`: provider batch size. Must be `1..500`.
- `--retry-failed`: include failed embedding rows.
- `--json`: emit structured index result.

Side effects:

- Calls embedding provider unless a stub provider is configured.
- Writes `session_memory_embeddings` status and vector table rows.

Examples:

```bash
myelin memory index session wizepal
myelin memory index session class-kit --retry-failed --json
```

### `myelin memory session list <project-key> [--status active|superseded|retracted] [--limit N] [--json]`

Lists Session Memory rows for operator inspection.

Arguments:

- `project-key`: project to inspect.

Options:

- `--status active|superseded|retracted`: optional lifecycle status filter.
- `--limit N`: maximum rows. Default `50`.
- `--json`: emit `{ "memories": [...] }`.

Side effects:

- Read-only.

### `myelin memory session show <memory-id> [--json]`

Shows one Session Memory row, including lifecycle metadata and captured contexts.

Arguments:

- `memory-id`: Session Memory id.

Options:

- `--json`: emit structured memory details.

Side effects:

- Read-only.

### `myelin memory session links <project-key> [--memory <memory-id>] [--limit N] [--json]`

Lists Session Memory lifecycle/reconciliation links.

Arguments:

- `project-key`: project to inspect.

Options:

- `--memory <memory-id>`: restrict to links where the memory is source or target.
- `--limit N`: maximum links. Default `100`.
- `--json`: emit `{ "links": [...] }`.

Side effects:

- Read-only.

Examples:

```bash
myelin memory session list class-kit --status active --json
myelin memory session show mem_sqlite_knowledge_domain
myelin memory session links class-kit --memory mem_old --json
```

### `myelin memory candidates <project-key> [--status pending|needs-review|processed|rejected] [--scope session|project|practice|personal] [--json]`

Lists memory candidates.

Arguments:

- `project-key`: project to inspect.

Options:

- `--status <status>`: optional candidate status filter. Hyphenated aliases like `needs-review` are normalized.
- `--scope session|project|practice|personal`: optional scope filter.
- `--json`: emit `{ "candidates": [...] }`.

Side effects:

- Read-only.

### `myelin memory candidate show <candidate-id> [--json]`

Shows one memory candidate.

Arguments:

- `candidate-id`: candidate id.

Options:

- `--json`: emit structured candidate details.

Side effects:

- Read-only.

## session

Manual sessions are a lightweight operator log separate from hook-captured Experience Log ingestion. Hook capture is the default path for provider sessions.

### `myelin session start <project-key> [--title "..."] [--json]`

Starts a manual session.

Side effects:

- Writes a row to `sessions`.

### `myelin session log <project-key> <message> [--kind note|decision|finding|followup] [--session <id>] [--json]`

Logs a manual event to an open session.

Side effects:

- Writes a row to `session_events`.

### `myelin session close <project-key> [--summary "..."] [--session <id>] [--json]`

Closes a manual session.

Side effects:

- Updates the selected `sessions` row.

### `myelin session recent <project-key> [--limit N] [--json]`

Lists recent manual sessions.

Side effects:

- Read-only.

### `myelin session show <session-id> [--json]`

Shows one manual session and its events.

Side effects:

- Read-only.

## install

### `myelin install [--provider <provider>] [--apply]`

Previews or applies provider hook installation.

Options:

- `--provider <provider>`: provider to install hooks for.
- `--apply`: write changes. Without this, the command previews.

Side effects:

- Preview mode is read-only.
- Apply mode writes provider hook configuration and Myelin shim files.

### `myelin uninstall [--provider <provider>]`

Previews removal of Myelin-owned provider hook entries.

Options:

- `--provider <provider>`: provider to uninstall hooks for.

Side effects:

- Removes only Myelin-owned hook entries through the install service.
- Does not accept `--apply`; uninstall behavior is handled by the service mode.

## capture

### `myelin capture codex-hook`

Reads a Codex hook payload from stdin and records an Experience Log event.

Side effects:

- Writes to `experience_events` or hook-error fallback logs.
- Fails open: malformed payloads or capture failures do not interrupt provider sessions.
- No-ops when `MYELIN_CAPTURE_DISABLED=1`.

This command is normally invoked by installed hooks, not by operators directly.
