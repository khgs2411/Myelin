# Schema, Config, And Runtime

Myelin's schema, config, and runtime layer turns authored repository rules into deterministic per-project state, selects provider-backed LLM runners, and keeps project paths, JSON state, and run artifacts inside explicit repository boundaries.

## Schema Context

The active schema slice is intentionally thin and global-only. `schema/global.md` is the prose guidance, and `schema/rules/*.json` contains hand-authored typed rules for source classification, memory scopes, and page taxonomy. `schema/schema-context.md` describes the generated contract, but the implementation in `src/schema/compiler.ts` is the safest source for the exact current shape.

`myelin schema build <project>` compiles root `schema/` into `projects/<key>/state/schema-context.json`. The generated context includes:

- `schema_version: "0"` and `built_at`.
- `inputs`, a map from schema-relative file paths to sha256 hashes, used for freshness checks.
- `source_classification.required_fields`, `source_kind`, `ownership`, and `action`, copied from `schema/rules/source-classification.json`.
- `memory_scopes.scopes`, `phase_0_active`, and `phase_0_deferred`, copied from `schema/rules/memory-scopes.json`.
- `page_taxonomy.categories`, copied from `schema/rules/page-taxonomy.json`.
- required provenance markers: `file_path_line`, `commit_pointer`, `source_snippet`, and `inference_label`.
- current CLI vocabulary compiled by `src/schema/compiler.ts`.

The compiler validates typed rule files with Zod validators in `src/schema/validators.ts`, then projects them into the smaller agent-facing `SchemaContext` type in `src/schema/types.ts`. `schema build` writes by default, and `--dry-run` returns stable JSON without mutating state; this behavior is wired in `src/commands/schema.ts` and backed by ADR 0033. `schema check` is read-only: it verifies that the project exists, validates an existing generated context if present, and reports stale inputs when the stored `inputs` hash map differs from the authored schema files. ADR 0039 records that repair should remain a separate command rather than being folded into check.

`project learn` depends on this context before curation work. `src/runtime/project-run-infrastructure.ts` calls `ensureProjectLearnSchemaContext()`, which builds the context when it is missing, rebuilds stale or invalid context before learning, and fails if a non-dry-run rebuild still cannot pass `checkSchema()`. `src/project/project-memory-curator-service.ts` invokes this before source reconciliation, runtime inbox intake, packet construction, and agent-authored documentation work.

## Typed Rules

Typed schema rules are JSON, not YAML. ADR 0027 chose JSON to keep validation deterministic in TypeScript and aligned with generated JSON state; ADR 0029 keeps Zod as the runtime validator. The current rule files are:

- `schema/rules/source-classification.json`: requires each ingested source to resolve `source_kind`, `ownership`, `destination`, `update_targets`, and `action`. `destination` and `update_targets` are contextual values, not fixed enums.
- `schema/rules/memory-scopes.json`: defines scopes such as `project_wiki`, `project_state`, `project_session`, `practice`, `personal`, `mixed`, and `none`; Phase 0 marks only `project_wiki`, `project_state`, and `none` active.
- `schema/rules/page-taxonomy.json`: defines wiki categories by reusable knowledge value, including `product-behavior`, `operating-workflows`, `decisions`, `current-state`, `practices-provenance`, `open-questions`, and `concepts`.

The current repository has design history for project-local schema, schema candidates, global apply flags, and cross-project schema promotion, but ADR 0049 and `schema/global.md` make those deferred past Phase 0. Future agents should not assume `schema candidates`, `schema apply`, project-local overrides, `--include-global`, or `--global` behavior exists merely because older ADRs describe it.

## Runtime Config

Runtime configuration is loaded by `src/runtime/config.ts`. Precedence is:

1. root `myelin.config`
2. root `.env`
3. process environment

Empty environment values are ignored. `DEFAULT_PROVIDER` accepts `codex` or `claude`; invalid provider names throw. `myelin.config` sets Codex as the default provider, gives pipeline work `PIPELINE_CODEX_MODEL=gpt-5.5` with medium reasoning, query work `QUERY_CODEX_MODEL=gpt-5.4-mini` with xhigh reasoning, and ingest work `INGEST_CODEX_MODEL=gpt-5.4-mini` with medium reasoning. Claude profiles are also present for pipeline and query. Auto Session Memory maintenance is enabled in the checked-in config with a 100-event threshold and a 500-item index limit.

The same config module owns embedding and ingest runtime limits. Session Memory embeddings default to Gemini embeddings (`gemini-embedding-2`), 1536 dimensions, batch size 50, and embedding format version 1. Ingest defaults and caps are enforced in code: default batch size 100, maximum batch size 500, default worker concurrency 1, maximum concurrency 16, default worker start delay 750 ms, default LLM timeout 10 minutes, and default prompt limit 180,000 characters for ingest-specific runtime config.

## Provider And Model Selection

LLM invocation is centralized in `src/runtime/llm-client.ts`. `invokeLlm()` first honors `LLM_STUB_RESPONSES_DIR` for deterministic tests, then resolves provider/model selection from config and environment. A direct `MODEL` or `modelOverride` wins over workload profiles:

- `MODEL=claude` selects Claude.
- `MODEL=claude/<id>` selects a Claude model.
- `MODEL=codex` selects Codex with the configured Codex reasoning effort for the workload.
- `MODEL=codex/<id>` selects a Codex model with that reasoning effort.
- Any other `MODEL` value is treated as a Codex model id.

Without a direct model selector, Myelin picks the configured profile for the requested workload (`pipeline`, `query`, or `ingest`) and the override provider or default provider. `MODEL_REASONING_EFFORT` overrides Codex reasoning effort globally for the invocation.

Codex runs as `codex exec --skip-git-repo-check --sandbox read-only` for JSON-only LLM stages, with optional `--output-schema`, `--model`, and `model_reasoning_effort`. Claude runs as `claude -p --output-format json`. ADR 0051 records the boundary: Myelin uses the operator's authenticated vendor CLI in headless mode, currently Codex and Claude only. Gemini is an embedding provider, not an LLM runner in this slice.

`invokeLlm()` requires JSON object output. Codex parsing accepts direct JSON, fenced JSON, balanced JSON inside surrounding text, or a referenced JSON file path when recoverable. Claude parsing expects the CLI wrapper JSON and then parses `result` or `final_message` as the inner JSON object. Prompts over 200,000 characters fail before invocation.

## Repo-Safe Runtime Primitives

`src/runtime/fs.ts` is the basic path-safety boundary. `resolveInside(root, ...)` rejects paths that escape the repository root, `projectPath()` validates project keys, and `assertProjectKey()` permits only alphanumeric, underscore, and dash keys that start with an alphanumeric character. Bootstrap uses a stricter lowercase key check in `src/runtime/bootstrap.ts` and requires repo paths to be absolute.

State files go through `src/runtime/state.ts`. `statePath()` only accepts a single JSON filename, rejects nested path separators, and writes under `projects/<key>/state/`. JSON IO in `src/runtime/json.ts` uses sorted keys for stable output and writes via a temporary file plus rename. This keeps generated state deterministic and reduces partial-write risk.

Process execution goes through `src/runtime/process.ts`, which wraps `Bun.spawn`, supports stdin, merges environment overrides, captures stdout/stderr, and returns exit code 124 on timeout. `runProcessChecked()` is the throwing convenience wrapper for commands that must succeed.

## Project Shells And Run Artifacts

Project layout is normalized by `src/runtime/layout.ts` and `src/runtime/project-shell.ts`. A V2 project shell has `wiki/`, `state/`, `log/`, and `runs/`; legacy top-level `index.md`, `changelog.md`, inbox, and old artifact-run locations can be moved during migration. `repairProjectShell()` creates required markdown indexes and `state/bootstrap-state.json`, and can remove empty legacy `sources/` or `schema/` directories.

Run artifacts live under `projects/<key>/runs/`. `src/runtime/artifacts.ts` builds timestamped run ids like `<iso-with-colons-replaced>-run`, validates run ids and command names, creates command-specific run indexes, and writes an `index.md` in each run directory. `src/runtime/project-run-infrastructure.ts` specializes this for `project-learn` runs, writing JSON artifacts with stable JSON and markdown artifacts with a trailing newline.

Agent-authored Project Memory documentation uses a separate writable runner in `src/runtime/file-authoring-agent.ts`, not the JSON-only `invokeLlm()` contract. It copies a sanitized target repo snapshot into a run-local workspace, skips secrets and generated/heavy directories such as `.env`, `.git`, `.codex`, `.agents`, `.tmp`, `node_modules`, root `state`, and project run folders, then allows Codex workspace-write only inside explicit output roots. After execution it verifies changed files stayed inside those roots and records `file-authoring-agent-result.json`. ADR 0067 records the intended boundary: file-authoring agents may write run-local drafts, while Myelin owns canonical promotion into wiki and state.

## Current Gaps And Watchpoints

- `schema/schema-context.md` includes some CLI vocabulary that has drifted from the compiler and current project contract, notably around `project ingest`; prefer `src/schema/compiler.ts` and the root AGENTS guidance for the current compiled command list.
- The implementation is Phase 0 global-only. Do not document project-local schema, schema candidates, or schema apply as shipped behavior until code lands.
- The provider abstraction is deliberately BYO-CLI and currently supports Codex and Claude for LLM stages. Gemini-related config is for embeddings, not model-running.
- Config values in `myelin.config` are operational defaults, not immutable product guarantees; environment variables can override them at runtime.
