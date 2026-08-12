# External Boundaries And Integrations

External boundaries in Myelin are deliberately contract-based: provider hooks, provider CLIs, detached ingest workers, and the detached MCP server integrate through commands, JSON, env vars, and project layout rather than source imports.

## Boundary Principles

Myelin keeps core product behavior in the root Bun/TypeScript runtime under `src/`. The detached MCP server is the agent-facing interface, but it is not part of the root package graph and must not own query or memory logic. ADR 0011 says MCP integration happens through documented file layouts, schemas, JSON outputs, commands, `LLM_WIKI_ROOT`, and explicit project selection, with no core imports from MCP source (`docs/adr/0011-keep-mcp-detached-as-agent-interface.md`). ADR 0048 tightens this for query: core query logic lives once in `src/query/`, and detached MCP should consume `myelin memory query --json` rather than duplicating a query engine (`docs/adr/0048-core-owns-query-mcp-consumes-via-contract.md`).

The compatibility names are intentional. The product name is Myelin, but `LLM_WIKI_*` env vars and the `mcp__llm-wiki__*` MCP namespace remain compatibility contracts under ADR 0050; `AGENTS.md` calls out that these are not Myelin product vocabulary. The root package stays private and exposes the `myelin` binary through `package.json`; detached MCP consumers use the CLI/JSON contract, not root package imports.

## Agent-Facing Query Contract

The canonical product design describes three semantic MCP facades: `query` for explanatory knowledge, `how` for prescriptive operating guidance, and `status` for structured current state (`MYELIN.md`). Supporting MCP tools such as `enrich_gap`, `flag_stale_answer`, and `create_inbox_item` are non-primary surfaces. Facades require an explicit `project_key` unless the server is scoped by `LLM_WIKI_PROJECT`.

The implemented core contract is the CLI response from `myelin memory query <key> <question> --json`. `src/commands/memory.ts` accepts `--limit`, `--layer session|project|auto`, `--max-inline-chars`, `--branch current|<name>`, `--json`, and `--debug`. `src/query/memory-query-service.ts` returns an envelope with `answer`, `confidence`, `memory_scope`, `citations`, `candidate_ids`, `degraded`, `degraded_reason`, and `source_tools`; debug mode can include per-layer diagnostics. In the current implementation, `--layer project` uses Project Memory retrieval, while default and `auto` route to Session Memory rather than a full multi-layer router. `AGENTS.md` also notes that MCP exposure and full Current Briefing integration are deferred.

`myelin status [project-key] --json` is the implemented skeleton of the future `status` facade (`docs/CLI.md`, `src/commands/status.ts`). It is read-only and reports project identity, state, and latest-session signals, but the broader current-briefing model is still future work.

## Capture Provider Installation

Capture providers are provider-specific adapters behind a provider-neutral contract. ADR 0054 states that Codex hooks are only one capture implementation, and future providers such as Claude Code or Gemini should implement the same capture contract without refactoring Experience Log, project routing, or promotion logic (`docs/adr/0054-use-provider-agnostic-capture-adapters.md`).

`myelin install` currently supports only the Codex provider. `src/install/types.ts` defines `ProviderName = "codex"`, and `src/install/install-service.ts` rejects any other `--provider`. Preview mode produces a plan; `--apply` writes global Codex hook integration under the provider root, defaulting to `~/.codex`. `src/install/codex.ts` creates or merges `hooks.json` entries for `SessionStart`, `UserPromptSubmit`, and `Stop`, writes `.myelin/shim/codex-hook`, backs up existing hooks, and writes `.myelin/install-manifest.json`. The shim sets `MYELIN_ROOT` and executes `bun <myelin-root>/src/cli.ts capture codex-hook`.

Uninstall is also Codex-only. `myelin uninstall --provider codex` removes Myelin hook entries from `hooks.json`, deletes the shim directory, and removes the install manifest. The install command accepts `--provider`, while uninstall does not accept `--apply` (`src/commands/install.ts`).

## Capture Runtime Behavior

Global installation does not mean global persistence. ADR 0055 defines the boundary: hooks are installed at the machine/provider level, but saved capture is enabled only for bootstrapped repositories; unbootstrapped repo events are dropped as no-ops, and hook failures fail open so Myelin does not interrupt agent sessions (`docs/adr/0055-use-global-install-with-per-repo-capture-opt-in.md`).

The implemented hook command is `myelin capture codex-hook` (`src/commands/capture.ts`). It reads JSON from stdin, ignores all work when `MYELIN_CAPTURE_DISABLED=1`, and catches all errors so Codex hook execution succeeds even if capture fails. `src/capture/providers/codex.ts` normalizes Codex hook payloads into provider-neutral events:

- `SessionStart` becomes `session.start`.
- `UserPromptSubmit` with a string `prompt` becomes `user.prompt`.
- `Stop` with non-empty `last_assistant_message` becomes `assistant.response`.
- unsupported or incomplete payloads become invalid events rather than thrown errors.

`src/capture/facade.ts` routes a normalized event by `cwd`. It resolves the bootstrapped project through `projectForRepoPath`, drops events without a registered project, records git branch/commit/worktree context through `src/capture/git-context.ts`, and writes Experience Log rows to the root SQLite database. If SQLite recording fails, it records hook errors to `state/hook-errors.jsonl` when possible and still returns `failed-open`. After storing an event, capture may ask `AutoMemoryMaintenanceService` to schedule bounded maintenance, but scheduler failures are swallowed to preserve fail-open hook behavior.

## Bootstrap And Per-Repo Opt-In

`myelin bootstrap <project-key> --repo <absolute-path>` is the per-repository opt-in command (`docs/CLI.md`, `src/commands/bootstrap.ts`). It requires an absolute repo path, validates the project key with `^[a-z0-9][a-z0-9_-]*$`, rejects repo paths already registered to another project, and writes the project shell under `projects/<project-key>/`.

`src/runtime/bootstrap.ts` delegates shell creation and repair to `src/runtime/project-shell.ts`. The shell guarantees `wiki/`, `state/`, `log/`, and `runs/`; creates top-level navigation files; writes `state/project.json` with `key`, `name`, and sorted `repo_paths`; and writes `state/bootstrap-state.json` with missing markers for `curated_project_memory` and `experience_log_capture_verification` when the project is still uncurated. Empty legacy `sources/` and `schema/` directories may be removed; non-empty legacy directories are preserved and get an index file. This is a shell, not invented Project Memory content.

## Provider CLI Integration

Myelin uses a bring-your-own-subscription provider runner. ADR 0051 preserves Codex and Claude Code as the wired LLM backends and explicitly defers Gemini as an LLM runner, although Gemini can be an embedding provider (`docs/adr/0051-preserve-multi-provider-byo-runner-abstraction.md`). `src/runtime/config.ts` loads `myelin.config`, then `.env`, then process environment, with process environment taking precedence. The supported LLM providers are `codex` and `claude`; workload profiles exist for `pipeline`, `query`, and `ingest`.

`src/runtime/llm-client.ts` invokes Codex as `codex exec --skip-git-repo-check --sandbox read-only ... -`, passing the prompt on stdin and parsing JSON from stdout. It invokes Claude as `claude -p --output-format json`, parsing JSON from the `result` or `final_message` wrapper. `MODEL`, provider-prefixed selectors such as `codex/<id>` and `claude/<id>`, `MODEL_REASONING_EFFORT`, `CODEX_BIN`, `CLAUDE_BIN`, workload model env vars, and `LLM_STUB_RESPONSES_DIR` are part of the runtime boundary. Codex-backed stages must remain read-only and JSON-on-stdout to avoid provider sessions writing artifacts directly.

Embedding is a separate boundary. Config supports `EMBEDDING_PROVIDER=gemini`, `EMBEDDING_GEMINI_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_BATCH_SIZE`, and `EMBEDDING_STUB_RESPONSES_DIR`. Session and Project Memory retrieval indexing use this embedding contract; it is not the same as the LLM provider runner.

## Detached Ingest Workers

Top-level `myelin ingest <project-key>` is the Experience Log to Session Memory pipeline, not Project Memory refresh. `docs/CLI.md` and `AGENTS.md` both state there is no active `myelin project ingest`; `project learn` performs deterministic Project Memory runtime-inbox intake, while top-level `ingest` starts detached provider-backed workers.

ADR 0056 defines the ingest boundary: Myelin owns job state, queue selection, tombstone-backed leases, and terminal bookkeeping, while a detached provider session runs from the target repository cwd to process Experience Log rows into Session Memory and downstream handoff inputs (`docs/adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`). `src/ingest/runtime.ts` resolves the first registered `repo_paths` entry as the target repo, warns but does not block when the branch is not `master`, writes logs under `projects/<key>/logs/ingest-<job-id>.log`, and launches `bun <myelin-root>/src/cli.ts ingest worker <job-id>` with `MYELIN_ROOT`, `MYELIN_INGEST_JOB_ID`, `MYELIN_INGEST_PROJECT`, and `MYELIN_CAPTURE_DISABLED=1`. Disabling capture in the worker prevents ingest sessions from recursively capturing their own processing.

`src/commands/ingest.ts` exposes `--provider codex|claude`, `--limit`, `--batch-size`, and JSON status/admin commands. Detached worker status can be refreshed by PID liveness; if a PID disappears before the job reaches a terminal status, the job is marked failed with a `detached_worker_exited` error.

## Known Gaps

- The detached MCP package is outside this snapshot, so this page documents the root-side contract and ADR intent, not an implemented MCP adapter.
- `myelin memory query --layer auto` is accepted by the CLI but currently behaves like the default Session Memory query path rather than a complete multi-layer `query` facade.
- Install/capture provider extensibility is designed, but only Codex installation and Codex hook normalization are implemented.
- Status and query are facade seeds; full MCP exposure, Current Briefing integration, and complete routing across Project, Session, Practice, and Personal Memory are deferred.
