# Command Surface and Operator Workflows

Myelin exposes a Bun/TypeScript CLI, `myelin`, plus a thin Makefile convenience layer for common operator workflows.

The canonical command reference is `docs/CLI.md`; the executable surface is assembled in `src/cli.ts` by registering command modules from `src/commands/`. The repo-local invocation is `bun src/cli.ts <command>`, and installed usage is documented as `myelin <command>` in `README.md` and `docs/CLI.md`.

## Command Vocabulary

Current V2 operator vocabulary uses product-language verbs:

- `myelin status [project-key] [--json]` inspects project status. It is read-only and can resolve the project from the current working directory when no key is supplied. `tests/commands/status.test.ts` verifies both human output and the JSON facade keys: `answer`, `confidence`, `memory_scope`, `citations`, `candidate_ids`, `degraded`, `degraded_reason`, and `source_tools`.
- `myelin bootstrap <project-key> --repo <absolute-path>` creates or updates a project shell under `projects/<project-key>/`. `tests/commands/bootstrap.test.ts` verifies shell creation and required argument handling.
- `myelin schema check <project-key>` validates generated schema context and is read-only. `myelin schema build <project-key> [--dry-run]` writes `state/<project-key>/schema-context.json` unless `--dry-run` is used.
- `myelin project learn <project-key> [--dry-run] [--review] [--recreate] [--provider codex|claude] [--model <model>] [--json]` runs Project Memory learning. It may invoke provider CLIs, performs deterministic runtime-inbox intake before packet construction, writes run artifacts under `runs/<project-key>/project-learn/`, and updates Project Memory unless stopped by `--dry-run`.
- `myelin ingest <project-key> [--limit N] [--batch-size N] [--provider codex|claude] [--json]` is the top-level Experience Log to Session Memory pipeline. It creates `ingest_jobs` rows and launches detached workers. Batch size must be `1..500`; config default is documented as `INGEST_BATCH_SIZE`, defaulting to `100`.
- `myelin memory query <project-key> <question> [--limit N] [--layer session|project|auto] [--max-inline-chars N] [--branch current|<name>] [--json] [--debug]` is the query facade. It may update cached query embeddings but does not call an answer-synthesis LLM. `README.md` identifies `myelin memory query <project-key> "<question>" --json` as the contract for detached interfaces.
- `myelin memory index session <project-key> [--limit N] [--batch-size N] [--retry-failed] [--json]` indexes pending Session Memory embeddings. `myelin memory index project <project-key> ...` is also implemented and tested for Project Memory retrieval indexing, although it is not documented in `docs/CLI.md`.
- `myelin memory maintain project <project-key> [--dry-run] [--review] [--promote <run>] [--provider codex|claude] [--model <model>] [--json]` is the targeted post-bootstrap Project Memory workflow: it normalizes runtime inbox sources, curates pending project candidates and handoffs against repo evidence and existing wiki pages, publishes approved markdown, and refreshes derived Project Memory retrieval state. `--review` stops before canonical writes; `--promote <run>` separately promotes the exact validated reviewed run and cannot be combined with `--review` or `--dry-run`.
- `myelin memory review <project-key> [--status <status>] [--limit N] [--json]` is read-only operator review for neutral or degraded outcomes, including Project Memory dispositions such as `insufficient_evidence`, `not_durable`, `belongs_to_other_layer`, and `deferred_unsafe_change`; it does not reopen work or create a research queue.
- `myelin memory inbox create ...` writes immutable Project runtime-inbox source JSON under `sources/<project-key>/inbox/`; `myelin memory inbox intake <project-key>` normalizes valid inbox records into `memory_candidates` rows without invoking a provider.
- `myelin memory candidates`, `myelin memory candidate show`, `myelin memory session list`, `myelin memory session show`, and `myelin memory session links` are read-only inspection commands over candidates and Session Memory records.
- `myelin session start|log|close|recent|show` is a manual operator log. `docs/CLI.md` explicitly separates this from hook-captured Experience Log ingestion, which is the default provider-session path.
- `myelin install [--provider <provider>] [--apply]` previews or applies provider hook installation. `myelin uninstall [--provider <provider>]` removes Myelin-owned hook entries through the install service.
- `myelin capture codex-hook` reads a Codex hook payload from stdin and records an Experience Log event. It fails open and no-ops only when `MYELIN_CAPTURE_DISABLED=1`.

## Makefile Aliases

`Makefile` sets `MYELIN := bun src/cli.ts` and forwards a small operator-facing subset:

- `make status PROJECT=<key> [ARGS='--json']` -> `bun src/cli.ts status <key> ...`
- `make query PROJECT=<key> QUESTION="..." [ARGS='--json']` -> `memory query`
- `make learn PROJECT=<key> [ARGS='--dry-run --json']` -> `project learn`
- `make ingest PROJECT=<key> [ARGS='--json']` -> top-level `ingest`
- `make bootstrap PROJECT=<key> REPO=<path> [ARGS='--json']` -> `bootstrap`
- `make schema-check PROJECT=<key>` and `make schema-build PROJECT=<key>` -> schema validation/build
- `make session-close PROJECT=<key> [ARGS='--json']` -> `session close`
- `make test` and `make typecheck` run `bun test` and `bun run typecheck`

The Makefile is intentionally a thin alias layer; `AGENTS.md` says new automation should call the `myelin` vocabulary through `bun src/cli.ts` or the installed binary rather than reintroducing V1 command names.

## Operator Workflows

For a new repository, bootstrap the project shell, validate or build schema context, then run learning:

```bash
bun src/cli.ts bootstrap class-kit --repo /absolute/path/to/repo
bun src/cli.ts schema build class-kit
bun src/cli.ts project learn class-kit --dry-run
bun src/cli.ts project learn class-kit
```

For day-to-day querying, build schema when needed, index the relevant retrieval layer, then query through the facade:

```bash
bun src/cli.ts memory index session class-kit --json
bun src/cli.ts memory index project class-kit --json
bun src/cli.ts memory query class-kit "What should I know?" --json
```

For Experience Log processing, run top-level ingest, inspect job status, and use job administration only after investigating failures:

```bash
bun src/cli.ts ingest class-kit --limit 50 --batch-size 25 --json
bun src/cli.ts ingest status --project class-kit --json
bun src/cli.ts ingest jobs class-kit --status failed --json
bun src/cli.ts ingest jobs resolve class-kit --all --reason "environment cleanup" --dry-run --json
```

`tests/commands/ingest.test.ts` verifies that top-level ingest creates one detached worker per batch, persists branch context even on non-`master` branches, reports project-level pending/completion counts, and can mark a stored running job failed when its PID is no longer alive.

For explicit durable Project Memory proposals, use the runtime inbox:

```bash
bun src/cli.ts memory inbox create class-kit \
  --layer project \
  --title "Local setup note" \
  --body "Concrete reusable fact." \
  --rationale "Future agents need this during setup." \
  --confidence medium \
  --risk low
bun src/cli.ts memory inbox intake class-kit --json
```

`project learn` also runs deterministic inbox intake before packet construction, so operators can either intake explicitly or let learning perform it as part of Project Memory refresh.

For already-curated Project Memory, use maintenance rather than a full create-mode refresh. Inbox intake inside this workflow is deliberately non-recursive: only runtime inbox creation and Session Memory ingest-created project candidates can trigger optional auto Project Memory maintenance, after the configured pending-item threshold is reached.

```bash
bun src/cli.ts memory maintain project class-kit --json
bun src/cli.ts memory review class-kit --status insufficient_evidence --json
```

To promote a reviewed maintenance run, use its reported run path only after the review is accepted:

```bash
bun src/cli.ts memory maintain project class-kit --review --json
bun src/cli.ts memory maintain project class-kit --promote runs/class-kit/project-learn/<run-id> --json
```

Promotion rechecks the review checkpoint, draft and report hashes, canonical baseline, target-repository fingerprint, and the still-pending source set before writing. It fails rather than reauthoring the draft if any checked input has changed.

## JSON-Facing Contracts

The CLI emits human-readable output by default and structured JSON on commands with `--json`. Current JSON-facing surfaces include:

- `status --json`: project status facade with the same high-level shape used by query-style consumers.
- `project learn --json`: run result with `project_key`, `status`, `mode`, run artifact paths, validation state, applied pages/items, changed files, and pending-index status when applicable.
- `project packet --json`: read-only Project Memory packet for curation input. This command is implemented and tested in `src/commands/project.ts` and `tests/commands/project.test.ts`, though it is more of an internal/operator diagnostic than a Makefile alias.
- `ingest --json`, `ingest status --json`, `ingest jobs --json`, and `ingest jobs resolve --json`: job start, inspection, listing, and resolution contracts.
- `memory query --json`: detached query contract. `docs/adr/0048-core-owns-query-mcp-consumes-via-contract.md` says core owns query logic and detached MCP consumes it through the CLI/JSON contract rather than importing core source.
- `memory index session --json` and `memory index project --json`: embedding/indexing result contracts with selected/indexed/failed/pending/degraded fields.
- `memory inbox create --json`, `memory inbox intake --json`, candidate inspection, Session Memory inspection, and manual session commands expose structured operator/readback payloads.

## Side-Effect Boundaries

Read-only or side-effect-light commands are `status`, `schema check`, `project list`, `project packet`, candidate/session inspection, `ingest jobs`, and most non-JSON/human formatting paths. `memory query` is side-effect-light rather than purely read-only because it may create or update cached query embeddings.

Write commands are explicit:

- `bootstrap` writes the project shell.
- `schema build` writes generated schema context unless `--dry-run`.
- `project learn` may update Project Memory and run artifacts; `--dry-run` previews without committing writes.
- `project reset <project-key> --clean --confirm <project-key>` clean-rebootstraps a project shell and preserves the root memory database, per `tests/commands/project.test.ts`.
- `ingest` writes ingest jobs and launches detached workers; `ingest worker` leases rows, invokes provider runtime, writes Session Memory outputs/candidates/handoffs, and finalizes tombstones.
- `ingest jobs resolve` mutates failed jobs to completed unless `--dry-run`.
- `memory inbox create`, `memory inbox intake`, `memory index session`, `memory index project`, manual `session` write commands, `install --apply`, `uninstall`, and hook `capture codex-hook` all write state or provider hook files.

## Known Conflicts and Gaps

Older ADR text in `docs/adr/0017-use-learn-ingest-query-session-cli-verbs.md` says `project ingest <key>` replaces narrow update semantics. Current `README.md`, `docs/CLI.md`, `src/commands/project.ts`, and `tests/commands/project.test.ts` supersede that: there is no active `myelin project ingest`; Experience Log processing is top-level `myelin ingest <key>`, and Project Memory runtime-inbox intake happens inside `project learn` or explicit `memory inbox intake`.

`README.md` still maps `make init PROJECT=<key>` to `myelin project onboard <key>` / `make onboard PROJECT=<key>`, but the inspected `Makefile` has no `onboard` target and `src/commands/project.ts` registers no `project onboard` command. Treat onboarding references as stale until code or docs are reconciled.

`src/commands/project.ts` and tests expose `project list`, `project packet`, and `project reset`; `src/commands/memory.ts` and tests expose `memory index project`. These are useful operator/admin surfaces but are not all reflected in the quick-start Makefile and some are not prominent in `docs/CLI.md`.

`src/commands/project.ts` accepts `project learn --recreate`, but `docs/CLI.md` does not list that option. Treat the implementation and command tests as the current surface for this flag until the reference is updated.
