# Runtime And Provider Boundary

Myelin's runtime boundary keeps repository access, generated artifacts, provider-backed model calls, and agent-authored files behind small TypeScript helpers with explicit filesystem and JSON contracts.

## Runtime Helpers

The core runtime helpers are intentionally narrow. `src/runtime/fs.ts` defines `repoRoot`, `resolveInside`, `projectPath`, and project-key validation; callers use these helpers so generated paths stay under the configured Myelin root and project keys remain simple path-safe identifiers. `resolveInside` throws when a joined path would escape the root, and `projectPath` applies the same guard under `projects/<key>/`.

JSON state is written through `src/runtime/json.ts`. `writeJson` creates parent directories, serializes with stable sorted object keys, writes a process-scoped temporary file, and renames it into place. `readJsonIfExists` returns `null` only for missing files; invalid JSON still fails loudly. Tests in `tests/runtime/runtime.test.ts` cover traversal rejection, deterministic JSON output, and the distinction between missing and malformed JSON.

Process execution is centralized in `src/runtime/process.ts`. `runProcess` wraps `Bun.spawn`, merges caller-provided environment values over `process.env`, optionally writes stdin, captures stdout and stderr, and converts timeouts into exit code `124`. `runProcessChecked` is the stricter helper for commands where non-zero exit status should throw.

## Configuration And Provider Selection

`src/runtime/config.ts` loads `myelin.config`, then `.env`, then process environment values; later sources override earlier ones. The live LLM providers are `codex` and `claude`, selected by `DEFAULT_PROVIDER`, per-call provider overrides, or `MODEL`. Workload profiles are separated for `pipeline`, `query`, and `ingest`, with per-provider variables such as `PIPELINE_CODEX_MODEL`, `QUERY_CLAUDE_MODEL`, `INGEST_CODEX_REASONING_EFFORT`, and `MODEL_REASONING_EFFORT`.

The config layer also owns non-provider runtime bounds: ingest batch size is capped at 500, ingest worker concurrency at 16, default ingest timeout is 10 minutes, and default ingest prompt limit is 180,000 characters. Auto Session Memory maintenance is off by default and only becomes active when `AUTO_MEMORY_MAINTENANCE=1`. Embedding configuration is separate from LLM runner selection: the only embedding provider type is `gemini`, with default model `gemini-embedding-2`, 1536 dimensions, batch size 50, and optional `EMBEDDING_STUB_RESPONSES_DIR`.

ADR 0051 is the important product constraint: Myelin preserves a BYO-subscription runner abstraction for Codex and Claude, but Gemini is not wired as a live LLM runner. In the current implementation, unqualified or unknown `MODEL` values are interpreted as Codex model names rather than as new providers.

## JSON LLM Invocation

`src/runtime/llm-client.ts` is the provider-facing boundary for JSON-returning LLM work. `invokeLlm` applies the configured workload profile, enforces a 200,000-character prompt limit, supports `LLM_STUB_RESPONSES_DIR`, runs the selected vendor CLI, parses a JSON object response, and returns estimated character-based token usage when provider usage is unavailable.

Codex invocations use:

```text
codex exec --skip-git-repo-check --sandbox read-only -
```

The command may add `--output-schema`, `--model`, and Codex reasoning-effort config. The read-only sandbox is deliberate: pipeline/query stages must return JSON on stdout instead of writing artifacts directly. Claude invocations use:

```text
claude -p --output-format json [--model <model>] <prompt>
```

The parser expects Claude's wrapper JSON and extracts `result` or `final_message`, then parses the inner JSON object. Codex parsing is more defensive because provider output can include fenced JSON, prose-wrapped JSON, or a referenced JSON file path. Tests in `tests/runtime/llm-client.test.ts` verify read-only Codex dispatch, Claude wrapper parsing, model override behavior, prompt-hash-checked stubs, ingest profile dispatch, and JSON recovery.

## Run Artifacts And Schema Context

`src/runtime/project-run-infrastructure.ts` owns the generic project-learn run plumbing. `createProjectCuratorRun` creates timestamped directories under `projects/<key>/runs/project-learn/<run-id>`, where run ids look like `2026-06-23T10-00-00.000Z-run`. `writeRunArtifact` and `writeMarkdownArtifact` write only inside that run directory by resolving artifact paths through `resolveInside`.

The same module keeps schema freshness in front of learning work. `ensureProjectLearnSchemaContext` checks `projects/<key>/state/schema-context.json`, builds it when missing or stale, rechecks after non-dry-run rebuilds, and hashes the stable JSON context. `invokeProjectCurator` is only a thin pipeline-workload wrapper around `invokeLlm`; product-specific prompting and artifact semantics remain in callers.

## File-Authoring Agents

File-authoring work has a different boundary because the model is allowed to create files. `src/runtime/file-authoring-agent.ts` runs those agents in a run-local `workspaceDir`, snapshots the target repository into `workspaceDir/target-repo`, creates declared output roots, runs the agent, and then compares before/after workspace file hashes. Any changed file outside the declared output roots makes the agent result `failed`.

Live file-authoring currently requires Codex. It runs:

```text
codex exec --skip-git-repo-check --sandbox workspace-write -
```

with cwd set to the isolated agent workspace. The injected instructions tell the agent where the target repository snapshot is and require writes only to the explicit output roots. The result file is always `file-authoring-agent-result.json` and records schema version, project key, stage id, live/stub mode, provider, model, sandbox, cwd, target snapshot path, allowed output roots, discovered outputs, and any error.

`FILE_AUTHORING_STUB_OUTPUTS_DIR` switches file-authoring into fixture mode by copying fixture outputs for the stage into the workspace before the same allowed-root verification runs. Tests in `tests/runtime/file-authoring-agent.test.ts` cover fixture mode, live Codex command shape, escaped output-root rejection, and failure on stray writes.

## Bootstrap And Project Shell Safety

`src/runtime/bootstrap.ts` validates project onboarding before writing shell files. A project key must match lower-case path-safe syntax, the repo path must be absolute and exist, and one repo path cannot be registered to multiple project keys. Bootstrap writes `projects/<key>/state/project.json` through stable JSON and delegates shell repair to `src/runtime/project-shell.ts`.

`project-shell.ts` maintains the required project directories `wiki`, `state`, `log`, and `runs`; creates index/readme/changelog placeholders when missing; moves older root-level `index.md` and `changelog.md` into their newer canonical locations when safe; and preserves non-empty legacy `sources` directories by adding an index rather than deleting source material. Empty legacy `schema` or `sources` directories can be removed during repair. `tests/runtime/bootstrap.test.ts` verifies idempotent bootstrap, legacy repair, preserved source material, and duplicate repo-path rejection.

## Install Hooks

Install support is provider-specific and currently Codex-only. `src/install/install-service.ts` rejects any `--provider` other than `codex` and requires an explicit provider for non-interactive apply when multiple providers are detected. `src/install/codex.ts` can preview, apply, and uninstall Codex hook integration under the provider root, defaulting to `~/.codex`.

Applying the Codex install merges Myelin hook groups into `hooks.json` for `SessionStart`, `UserPromptSubmit`, and `Stop`, writes `.myelin/shim/codex-hook`, writes `.myelin/install-manifest.json`, and backs up an existing hooks file before modification. The shim sets `MYELIN_ROOT` and executes:

```text
bun <myelin-root>/src/cli.ts capture codex-hook
```

Uninstall removes only Myelin-owned hook entries and Myelin's shim/manifest, leaving unrelated hooks in place. `tests/install/codex.test.ts` and `tests/install/install-service.test.ts` cover preview behavior, idempotent apply, legacy Myelin hook replacement, unrelated hook preservation, uninstall behavior, and explicit-provider enforcement.

## Detached MCP Contract

MCP remains a consumer boundary rather than part of core runtime ownership. `.mcp.json` points the `llm-wiki` MCP server at `bunx topsyde-llm-wiki-mcp@latest` and passes `LLM_WIKI_ROOT` for the local repo. ADR 0011 states that MCP is the agent-facing interface and must stay detached: core code must not import MCP source, MCP code must not own product behavior, and integration happens through stable file layouts, schemas, commands, JSON outputs, `LLM_WIKI_ROOT`, and explicit project selection.

ADR 0048 applies that rule specifically to query: `src/query/` owns query logic once, and detached MCP consumers should call the core CLI contract, `myelin memory query --json`, instead of duplicating or importing query internals. The root AGENTS contract keeps the compatibility names `LLM_WIKI_*` and `mcp__llm-wiki__*` even though the product vocabulary is Myelin.

## Current Boundary Gaps

The main gap is asymmetry between provider layers: JSON-returning LLM stages are multi-provider across Codex and Claude, but file-authoring agents are Codex-only because they rely on Codex workspace sandboxing. Another intentional gap is Gemini: it is configured for embeddings, not as a live text-generation runner. The detached MCP query migration is also contractually specified by ADR 0048, but the ADR notes that MCP-side changes live outside the Phase 0 core slice.
