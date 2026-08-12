# Runtime, Providers, and Project Layout

Myelin's runtime layer centralizes local configuration, safe filesystem boundaries, project registration, provider-backed subprocess calls, and command run artifacts for the Bun/TypeScript CLI.

## Runtime Helpers

Core runtime helpers live under `src/runtime/`. `src/runtime/fs.ts` defines the root boundary: `resolveInside()` rejects path traversal outside the repository root, `projectPath()` constrains project paths to `projects/<key>/`, and project keys must match an alphanumeric key with optional `_` or `-`. `src/runtime/json.ts` writes deterministic JSON, and `src/runtime/state.ts` limits project state helpers to JSON files under `projects/<key>/state/`.

Subprocess execution goes through `src/runtime/process.ts`. `runProcess()` wraps `Bun.spawn`, captures stdout, stderr, and exit code, supports stdin, merges caller env over `process.env`, and returns exit code `124` with a timeout message when a positive `timeoutMs` kills the process. `runProcessChecked()` is the throwing wrapper for callers that need stdout only on success. Tests in `tests/runtime/runtime.test.ts` cover output capture, checked failures, and timeout behavior.

SQLite runtime selection is separate from normal config loading. `src/memory/sqlite-runtime.ts` calls `Database.setCustomSQLite()` at most once and resolves a SQLite dynamic library in this order: `MYELIN_SQLITE_DYLIB_PATH` or `SQLITE_DYLIB_PATH` from process env, then the same keys from `.env`, then `myelin.config`, then the vendored Apple Silicon macOS dylib, then Homebrew SQLite paths on macOS. `docs/adr/0057-vendor-sqlite-runtime-for-vector-extensions.md` records the product reason: vector indexing needs a SQLite build that supports loadable extensions, so the vendored runtime is the preferred contract and Homebrew is a fallback.

## Config Precedence

`src/runtime/config.ts` loads root `myelin.config`, then root `.env`, then non-empty process environment variables. Later sources override earlier ones, so process env wins over `.env`, and `.env` wins over `myelin.config`. The parser is simple dotenv-style `KEY=value`; blank lines and `#` comments are ignored.

The runtime config exposes:

- `defaultProvider`: `DEFAULT_PROVIDER`, currently `codex` or `claude`.
- Per-workload model profiles for `pipeline`, `query`, and `ingest`, with keys such as `PIPELINE_CODEX_MODEL`, `QUERY_CLAUDE_MODEL`, and `INGEST_CODEX_REASONING_EFFORT`.
- Provider-specific embedding contracts for Ollama Nomic, Ollama Qwen, and Gemini, plus the shared Ollama URL, batch size, and optional stub response directory. Each provider owns its model and dimensions.
- Ingest batching, worker concurrency, start delay, LLM timeout, and prompt character limit.
- Optional auto Session Memory maintenance scheduling knobs.

`myelin.config` in this snapshot sets `DEFAULT_PROVIDER=codex`, uses separate pipeline/query/ingest Codex models and reasoning efforts, defines Claude model profiles, enables auto memory maintenance, and leaves embedding provider credentials as local `.env` or environment concerns. `EMBEDDING_PROVIDER=auto` tries `ollama_nomic`, `ollama_qwen`, then `gemini`; all three contracts default to 768 dimensions. The selected provider owns its model and dimensions: when an index command finds a dimension mismatch, it rebuilds the derived vector table and requeues affected rows for the selected contract rather than treating old vectors as compatible. Tests in `tests/runtime/runtime.test.ts` verify precedence, provider-specific dimensions, default embedding contracts, ingest limits, and auto-maintenance defaults.

## Provider Abstraction

The provider runner is implemented in `src/runtime/llm-client.ts`. `invokeLlm()` chooses a profile from config for a workload, accepts per-call `provider` and `modelOverride`, and lets `MODEL` override normal profile selection. Supported runner providers are Codex and Claude. A bare unknown `MODEL` value is treated as a Codex model name; `docs/adr/0051-preserve-multi-provider-byo-runner-abstraction.md` explicitly notes that Gemini is not wired as an LLM runner.

Codex invocation uses:

```text
codex exec --skip-git-repo-check --sandbox read-only ...
```

It sends the prompt on stdin, can pass `--output-schema`, appends `--model` when selected, and maps Codex reasoning effort through `-c model_reasoning_effort="..."`. Claude invocation uses:

```text
claude -p --output-format json ...
```

It passes the prompt as an argument and parses either `result` or `final_message` from Claude's JSON wrapper. Both paths require JSON object output; the Codex parser also recovers fenced JSON, prose-wrapped balanced JSON, and a referenced absolute JSON file. `LLM_STUB_RESPONSES_DIR` bypasses external CLIs with canned `<stage>.json` responses and optional prompt-hash verification, which keeps tests deterministic.

Provider command details are covered by `tests/runtime/llm-client.test.ts` and `tests/runtime/project-run-infrastructure.test.ts`: Codex runs in read-only sandbox, pipeline and ingest use their own profiles, Claude parses wrapper output, `MODEL` and provider overrides control resolution, and curator calls go through the pipeline workload rather than an older runner path.

## Project Discovery and Shell Layout

Project ownership is explicit. `src/runtime/projects.ts` discovers projects by scanning `projects/` and reading `projects/<key>/state/project.json`; entries without that file are ignored. Legacy and deprecated projects are excluded unless `includeLegacy` is requested. `projectForRepoPath()` resolves the current working directory against registered absolute `repo_paths`, so hooks and commands can map a repo checkout back to a Myelin project only after bootstrap.

Bootstrap flows through `src/commands/bootstrap.ts` to `src/bootstrap/bootstrap-service.ts` and `src/runtime/bootstrap.ts`. `myelin bootstrap <project-key> --repo <absolute-path>` requires an absolute existing repo path, rejects a repo path already registered to another active project, repairs the project shell, and writes or updates `projects/<key>/state/project.json` with sorted `repo_paths`.

The current shell repaired by `src/runtime/project-shell.ts` creates:

```text
projects/<key>/
  readme.md
  index.md
  wiki/index.md
  state/index.md
  state/bootstrap-state.json
  state/project.json
  log/index.md
  log/changelog.md
  runs/index.md
```

It does not create empty `sources/` or `schema/` directories during fresh bootstrap. Those names are treated as optional legacy directories: empty ones are removed, and non-empty ones are preserved with an `index.md`. This matches `tests/bootstrap/bootstrap-service.test.ts`, but it is slightly narrower than the broader layout description in `MYELIN.md`, which lists `sources/` and `schema/` as optional directories created only when preserved sources or project-local schema exist.

`src/runtime/layout.ts` handles migration from older layout shapes. It moves root `index.md` into `wiki/index.md`, root `changelog.md` into `log/changelog.md`, root `inbox/` into `sources/inbox/`, old `artifacts/<key>/runs/*` into `projects/<key>/runs/`, rewrites `state/update-state.json.latest_run_dir` from the old artifacts path to the new project path, and then runs project-shell repair. `tests/runtime/layout.test.ts` covers that preservation path.

## Install and Capture Boundaries

Install support currently exists for Codex hooks only. `src/commands/install.ts` registers `myelin install [--provider <provider>] [--apply]` and `myelin uninstall [--provider <provider>]`; `src/install/install-service.ts` rejects any provider other than `codex`. Preview mode returns a plan without writes. Apply mode writes Codex hook entries, a shim, and an install manifest through `src/install/codex.ts`.

Codex install targets the provider root, defaulting to `$HOME/.codex`. It manages `hooks.json` for `SessionStart`, `UserPromptSubmit`, and `Stop`, writes `.myelin/shim/codex-hook`, stores `.myelin/install-manifest.json`, and backs up an existing hooks file before applying. The shim exports `MYELIN_ROOT` and executes `bun <myelinRoot>/src/cli.ts capture codex-hook`. Install and uninstall remove only Myelin-owned hook entries while preserving unrelated hooks, as covered by `tests/install/codex.test.ts`.

`docs/adr/0055-use-global-install-with-per-repo-capture-opt-in.md` defines the boundary: provider hooks are global, but capture should save only for repositories bootstrapped into Myelin. Unbootstrapped repos are no-ops, and hook failures must fail open so Myelin does not interrupt the primary coding workflow.

## Run Artifacts

Run artifacts are project-local and command-scoped. `src/runtime/artifacts.ts` resolves runs under `projects/<key>/runs/`, validates run IDs and optional command names, creates index files, and supports `projects/<key>/runs/<run-id>/` or `projects/<key>/runs/<command>/<run-id>/`.

Project-learn uses the command-scoped form. `src/runtime/project-run-infrastructure.ts` creates `projects/<key>/runs/project-learn/<timestamp>-run/`, returns both absolute and root-relative paths, and provides `writeRunArtifact()` and `writeMarkdownArtifact()`. Both artifact writers resolve paths inside the run directory, so attempts such as `../escaped.json` fail instead of writing outside the run. It also ensures schema context freshness before learning by building or checking `projects/<key>/state/schema-context.json`.

This boundary matters for provider stages: project-learn writes input packets, prompt-budget files, summaries, and other generated material as run artifacts, while provider-backed curator calls are expected to return structured JSON on stdout. The LLM stage does not directly own canonical wiki writes.

## Known Gaps

- `projectLayout()` still includes `sources` and `schema` paths because migration and optional legacy preservation need them, but fresh bootstrap intentionally avoids creating empty directories. Future docs should keep this distinction explicit.
- The LLM runner abstraction is only wired for Codex and Claude. Embedding providers are a separate boundary with Ollama Nomic, Ollama Qwen, and Gemini implementations.
- Install provider detection is minimal in the current service: tests simulate multiple detected providers, but production install behavior still applies Codex-only planning and rejects non-Codex provider names.
