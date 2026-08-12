# Schema Config And Provider Boundary

Myelin's schema and provider boundary is the contract that turns authored global rules, local configuration, provider CLI selection, embeddings, and compatibility names into deterministic runtime behavior.

## Global schema context

Phase 0 ships a thin global-only schema. The authored inputs are `schema/global.md` and the hand-authored JSON rules under `schema/rules/`; project-local schema, typed overrides, and schema candidates are intentionally deferred by `docs/adr/0049-phase-0-ships-thin-global-only-schema.md`.

`src/schema/compiler.ts` compiles those global inputs into `projects/<key>/state/schema-context.json`. It records a sha256 for `schema/global.md` and each `schema/rules/*.json` input, validates the rules with Zod, and writes schema version `"0"` with source classification enums, active/deferred memory scopes, page taxonomy categories, required provenance forms, and the CLI vocabulary. `schema check` is read-only and reports invalid or stale generated context; `schema build` writes by default and supports `--dry-run` through `src/commands/schema.ts`.

The generated context shape is documented in `schema/schema-context.md`. The compiler's active command list is `bootstrap`, `project learn`, top-level `ingest`, `ingest status`, `memory query`, `status`, `schema check`, `schema build`, and `session close`.

## Typed rules

`schema/rules/source-classification.json` requires every consumed source to resolve `source_kind`, `ownership`, `destination`, `update_targets`, and `action`. The fixed enums cover source kinds such as `spec`, `design`, `plan`, `implementation-note`, `session-note`, `decision-candidate`, `troubleshooting`, and `unknown`; ownership values include `project:<project-key>`, `concept:<concept-key>`, `review-required`, and `reject`; actions include updating existing pages, creating a page plus index entry, log-only, reject, and needs-review.

`schema/rules/memory-scopes.json` defines `project_wiki`, `project_session`, `project_state`, `practice`, `personal`, `mixed`, and `none`. Phase 0 activates only `project_wiki`, `project_state`, and `none`; `project_session`, `practice`, and `personal` remain deferred in this schema context.

`schema/rules/page-taxonomy.json` names wiki categories by reusable knowledge value, not source-code shape: `product-behavior`, `operating-workflows`, `decisions`, `current-state`, `practices-provenance`, `open-questions`, and `concepts`.

## Config precedence

Root configuration lives in `myelin.config`. `src/runtime/config.ts` loads values in this order: `myelin.config`, then `.env`, then non-empty process environment variables. Later layers win. The parsed config exposes provider profiles, embedding config, ingest config, auto-memory-maintenance config, and the merged raw value map.

Provider and workload config is typed as `Provider = "codex" | "claude"` and `Workload = "pipeline" | "query" | "ingest"`. Workload profiles use keys like `PIPELINE_CODEX_MODEL`, `PIPELINE_CODEX_REASONING_EFFORT`, `QUERY_CLAUDE_MODEL`, and `INGEST_CODEX_MODEL`. `DEFAULT_PROVIDER` chooses the default backend when no per-call provider or model selector is supplied.

Embedding defaults are `EMBEDDING_PROVIDER=gemini`, `EMBEDDING_GEMINI_MODEL=gemini-embedding-2`, `EMBEDDING_DIMENSIONS=1536`, and `EMBEDDING_BATCH_SIZE=50`, with batch size capped at 500. Ingest defaults include `INGEST_BATCH_SIZE=100` with a max of 500, worker concurrency default 1 with a max of 16, 750 ms worker start delay, 10 minute LLM timeout, and a 180,000 character ingest prompt limit. Auto Session Memory maintenance is enabled only when `AUTO_MEMORY_MAINTENANCE=1`.

## LLM provider invocation

`src/runtime/llm-client.ts` is the shared JSON LLM boundary for non-file-authoring stages. It first honors `LLM_STUB_RESPONSES_DIR`, reading `<stageId>.json` or `<workload>.json` and validating `prompt_hash` when present. Live prompts have a 200,000 character limit.

Live model resolution is stronger than workload profile selection: explicit `modelOverride` wins, then `MODEL`, then the workload profile for the per-call provider or `DEFAULT_PROVIDER`. `MODEL=claude` selects Claude, `MODEL=claude/<id>` selects Claude with a model, `MODEL=codex` selects Codex, `MODEL=codex/<id>` selects Codex with a model, and any other `MODEL` value is treated as a Codex model id. Codex reasoning effort comes from the selected workload Codex profile unless overridden by `MODEL_REASONING_EFFORT`.

Codex runs as `codex exec --skip-git-repo-check --sandbox read-only`, optionally with `--output-schema`, `--model`, and `-c model_reasoning_effort=...`, with the prompt on stdin. Claude runs as `claude -p --output-format json`, optionally with `--model`, and receives the prompt as an argument. `CODEX_BIN` and `CLAUDE_BIN` can replace the executable names.

Both providers must return JSON objects. Codex parsing tolerates fenced JSON, prose-wrapped balanced JSON, and a referenced JSON file path. Claude parsing expects a JSON wrapper with `result` or `final_message` containing the JSON payload.

## File-authoring agents

File-authoring work is a separate boundary in `src/runtime/file-authoring-agent.ts`. These agents currently require Codex, run with `--sandbox workspace-write`, and execute in a run-local workspace. The target repository is copied into `target-repo/` under that workspace, excluding `.git` and the current project's run outputs, and the prompt appends: read from `target-repo/`; write only to explicit output roots.

The wrapper snapshots workspace files before and after the provider run and fails if changed files are outside the allowed output roots. It writes `file-authoring-agent-result.json` with provider mode, provider/model metadata, sandbox, cwd, target repo snapshot path, allowed roots, discovered outputs, and any error. `FILE_AUTHORING_STUB_OUTPUTS_DIR` provides fixture output mode for tests.

## Embeddings and vector contracts

Embeddings are deliberately separate from the text-generation provider boundary. `src/runtime/config.ts` currently supports only `EmbeddingProvider = "gemini"` and creates an active embedding contract with provider, model, dimensions, purpose, and `formatVersion = 1`. Purposes are `retrieval_document` and `retrieval_query`.

`src/memory/embedding-provider-factory.ts` prefers `EMBEDDING_STUB_RESPONSES_DIR` when configured; otherwise it creates a Gemini embedding provider using `GOOGLE_API_KEY`, falling back to `GEMINI_API_KEY`. `src/memory/embedding-provider.ts` calls Gemini `embedContent` or `batchEmbedContents`, supplies `outputDimensionality`, formats document text with title plus text, formats query text as a search query task, and rejects dimension mismatches.

`memory index session` and `memory index project` load this config, select the `retrieval_document` contract, and use `EMBEDDING_BATCH_SIZE` unless an operator passes `--batch-size`. `src/query/engine.ts` loads the same config for queries, selects the document contract for stored vectors, creates the embedding provider, and returns a degraded `memory_scope: "none"` response when the query path cannot initialize.

## SQLite runtime for vector extensions

`src/memory/sqlite-runtime.ts` owns the SQLite dynamic-library selection needed for `sqlite-vec`. Runtime resolution is: `MYELIN_SQLITE_DYLIB_PATH` from process env, `SQLITE_DYLIB_PATH` from process env, the same keys from `.env`, the same keys from `myelin.config`, a vendored Apple Silicon macOS dylib at `vendor/sqlite/darwin-arm64/libsqlite3.dylib`, Homebrew SQLite paths on macOS, then Bun's default SQLite behavior. `docs/adr/0057-vendor-sqlite-runtime-for-vector-extensions.md` makes the vendored runtime the product contract for Apple Silicon macOS, with host SQLite only a fallback.

## Compatibility contracts

The product name is Myelin, but several compatibility contracts intentionally retain older names. `AGENTS.md` states that `LLM_WIKI_*` variables and the `mcp__llm-wiki__*` MCP namespace are compatibility/env contracts kept unchanged under ADR 0050, not current product naming. Detached MCP consumers are also kept outside the root package graph; core query behavior lives in `src/query/`, and consumers use the `myelin memory query --json` CLI/JSON contract.

`docs/adr/0051-preserve-multi-provider-byo-runner-abstraction.md` is the active provider-boundary decision: Myelin shells out to the operator's authenticated Codex or Claude CLI in headless mode, preserving a bring-your-own-subscription runner abstraction. Gemini is not a text-generation runner here; the current `MODEL=gemini` behavior falls through to Codex model selection, while Gemini is used for embeddings.

## Known gaps and conflicts

- `schema/global.md` still says `project ingest <key>` processes queued source/inbox material, but `AGENTS.md` says there is no active `project ingest <key>` command and the compiler's command list omits it. Treat the top-level `ingest <key>` plus `project learn <key>` wording as the current contract until the schema guidance is updated.
- Phase 0 schema is global-only. Project-local schema, override records, schema candidates, `--include-global`, and multi-project schema apply remain deferred by ADR 0049.
- Provider config supports only Codex and Claude for LLM invocation. Gemini is an embedding provider, not a live LLM runner in the current implementation.
- The SQLite vendored runtime is only host-independent for the currently vendored `darwin-arm64` dylib. Other platforms need their own runtime before claiming the same support.
