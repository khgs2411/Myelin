# V2 TypeScript Core Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully migrate the core llm-wiki runtime from Python/Bash to Bun/TypeScript while keeping `/mcp` detached as the agent interface and optimizing for the V2 brain product over V1 compatibility.

**Architecture:** The core repo becomes Bun/TypeScript-first. Root TypeScript code owns project discovery, config, state, query planning, pipeline orchestration, validation, measurement, inbox handling, and operator commands. The migration may redesign directory and data structures where the current Python/Bash layout is no longer the right shape. Existing Python/Bash files are reference material during the migration, not compatibility wrappers to keep indefinitely. Breaking V1 behavior is acceptable when it advances the V2 brain. `/mcp` remains ignored and detached; integration happens through stable files, commands, environment variables, schemas, and JSON contracts.

**Tech Stack:** Bun, TypeScript, root `src/runtime/*`, root `src/cli.ts`, Bun tests, existing markdown/state artifacts, and existing LLM stage instruction files. SQLite memory, Gemini embeddings, `sqlite-vec`, Codex hooks, and MCP facade changes are deferred until the core migration is complete.

---

## Scope

This slice ports the current core runtime to TypeScript:

- root Bun package and TypeScript config
- runtime helpers for fs, JSON, config, projects, state, artifacts, and process execution
- TypeScript-native directory/data layout decisions for pipeline stages, runtime modules, schemas, and durable generated outputs
- TypeScript query planner/query engine behavior selected from the current implementation or redesigned for V2 value
- TypeScript inbox/gap-note/auto-update primitives
- TypeScript pipeline stage runner and orchestration for compile/update/lint/measure/ask/status/init
- TypeScript validation and metadata helpers currently in `agents/update/_shared`, `agents/update/06-validate`, `agents/query`, and `scripts`
- V2 CLI vocabulary that names product concepts directly
- Make targets retained only as convenience aliases where useful
- targeted parity or golden checks only for behavior selected as worth preserving

This slice deliberately does not implement:

- SQLite memory tables
- memory event/candidate/session storage
- Gemini embeddings
- `sqlite-vec`
- Codex hook installation
- detached MCP facade changes
- automatic practice or personal preference promotion

## Current Core Baseline

The root product core is currently Python/Bash:

- `agents/query/*.py`
- `agents/_shared/*.py`
- `agents/update/_shared/*.py`
- `agents/update/06-validate/*.py`
- `agents/update/**/run.sh`
- `scripts/*.sh`
- `scripts/*.py`
- root `tests/` with pytest
- root `Makefile`

The Python layer is thin enough to port. The current stage instruction markdown and JSON configs are useful reference assets, but their directory structure is not sacred. The migration should choose a TypeScript-native structure deliberately, then provide migration/adaptation for existing project data and operator workflows.

`/mcp` is TypeScript/Bun already, but it is detached by design:

- `/mcp/` remains ignored.
- `/mcp` is not a workspace member.
- core repo code must not import `/mcp` source.
- `/mcp` must not become owner of core product logic.

## File Map

- Create: `package.json` - private root package with Bun scripts.
- Create: `tsconfig.json` - root compiler settings.
- Create: `src/runtime/fs.ts`
- Create: `src/runtime/json.ts`
- Create: `src/runtime/config.ts`
- Create: `src/runtime/projects.ts`
- Create: `src/runtime/state.ts`
- Create: `src/runtime/artifacts.ts`
- Create: `src/runtime/process.ts`
- Create: `src/query/planner.ts`
- Create: `src/query/engine.ts`
- Create: `src/inbox/items.ts`
- Create: `src/pipeline/stages.ts`
- Create: `src/pipeline/compile.ts`
- Create: `src/pipeline/update.ts`
- Create: `src/pipeline/validate.ts`
- Create: `src/pipeline/measure.ts`
- Create: `src/cli.ts`
- Create: Bun tests under `src/**/*.test.ts` or `tests-ts/**/*.test.ts`.
- Modify: `Makefile` to call Bun entrypoints for normal commands.
- Modify: `README.md` and `AGENTS.md` to document the TypeScript runtime and detached MCP boundary.
- Do not modify: `/mcp` unless a separate MCP-interface task is explicitly scoped.

## Migration Rules

### Complete Port, Not Thin Wrapper

Normal operation must end on TypeScript entrypoints. Temporary wrappers may call old Python/Bash only while a specific command is being ported and tested. Final acceptance cannot depend on Python/Bash for core commands.

### Prefer V2 Shape Over Compatibility

Do not preserve weak V1 behavior merely because it exists. This is a large refactor and it may deliberately change command behavior, directory/data structures, and pipeline semantics. Preserve useful project knowledge, raw sources, provenance, and operator intent. If a layout, artifact, or state shape changes, document the reason and provide migration only for data that still matters to the V2 brain.

### Keep MCP Detached

The detached MCP interface communicates through:

- `LLM_WIKI_ROOT`
- optional `LLM_WIKI_PROJECT`
- explicit `project_key`
- project/state files
- inbox schemas
- generated artifacts
- documented JSON contracts

No source imports cross the `/mcp` boundary.

### Required Migration Records

Before retiring or replacing V1 surfaces, write a migration record that states:

- what was preserved, migrated, adapted, retired, or left as legacy reference
- why retired behavior is not valuable to V2
- where preserved provenance now lives
- how to inspect the last useful V1 run state when needed

The migration must not silently lose curated wiki pages, raw source evidence, original inbox items, source provenance, freshness/stale signals, pending or terminal inbox state, session summaries, changelog history, operator-owned project config, or detached MCP contracts.

### Milestone Gates

This is one large migration, but implementation must stop at these gates unless the gate passes:

| Gate | Required proof |
| --- | --- |
| Gate A: Inventory and layout | V1 keep/drop/redesign matrix exists; runtime layout doc exists; schema transition is decided. |
| Gate B: TypeScript foundation | Root Bun package, runtime primitives, tests, and typecheck pass without `/mcp` joining the package graph. |
| Gate C: Schema-first runtime | Schema check/build/candidates/apply work with Zod validation and generated schema context. |
| Gate D: Query/learn command surface | `memory query`, `project learn`, `project ingest`, and status commands use schema context and fail closed where required. |
| Gate E: Pipeline parity where valuable | Preserved V1 behavior has Bun tests or smoke tests; dropped behavior is recorded with rationale. |
| Gate F: Retirement | Normal core commands no longer require Python/Bash or `.venv`; legacy escape hatches are explicit. |

Do not advance to a later gate while an earlier gate has unresolved critical findings.

## Tasks

### Task 0: Inventory And Parity Map

**Files:**

- Create: `docs/v2-migration-inventory.md`
- Update: this plan when the inventory changes command or layout decisions.

- [ ] Map each Python/Bash entrypoint to its TypeScript target:
  - `scripts/init_project.sh`
  - `scripts/compile.sh`
  - `scripts/update.sh`
  - `scripts/status.sh`
  - `scripts/ask.sh`
  - `scripts/measure*.sh`
  - `scripts/measure_routes.py`
  - `scripts/apply_commit.sh`
  - `scripts/*pending*.sh`
  - `scripts/prune_artifacts.sh`
  - `agents/query/*.py`
  - `agents/update/_shared/*.py`
  - `agents/update/06-validate/*.py`
  - `agents/update/**/run.sh`
- [ ] Mark stage instruction markdown/config JSON as data assets to keep.
- [ ] Create a keep/drop/redesign matrix for every mapped entrypoint and V1 behavior.
- [ ] Classify each item as:
  - preserve with parity
  - preserve as data/reference only
  - redesign for V2
  - retire after replacement
  - retire immediately
- [ ] Record why each retired behavior is not valuable to V2.
- [ ] Record which tests, smoke tests, or migration checks protect each preserved behavior.
- [ ] Explicitly classify:
  - current low-confidence gap-note behavior
  - enrich-gap auto-update behavior
  - auto-update lockfile/log behavior
  - proposal/apply/reconcile artifact shapes
  - bounded reconcile behavior
  - current query planner behavior
  - current measurement behavior
  - current pending approval behavior

### Task 0.5: Design The TypeScript-Native Layout

**Files:**

- Create or update: `docs/runtime-layout.md`
- Update this plan if the layout decision changes the file map.

- [ ] Use Karpathy's LLM Wiki pattern as the source taxonomy: raw sources, maintained wiki, schema/instructions, index, and chronological log.
- [ ] Decide the TypeScript code layout for:
  - runtime primitives
  - query
  - inbox
  - pipeline orchestration
  - validation
  - measurement
  - command modules
- [ ] Decide the data layout for:
  - raw source/evidence preservation
  - maintained markdown wiki
  - global schema/instruction contracts
  - project-local schema/instruction contracts
  - content-oriented index
  - chronological log/session layer
  - stage configs
  - stage instructions
  - schemas
  - generated artifacts
  - project state
- [ ] Use this target project layout unless implementation finds a stronger shape:
  - `projects/<key>/sources/`
  - `projects/<key>/wiki/`
  - `projects/<key>/schema/`
  - `projects/<key>/state/`
  - `projects/<key>/log/`
  - `projects/<key>/runs/`
- [ ] Treat old global artifacts as migration reference material, not the target project-owned layout.
- [ ] Keep curated Project Memory as markdown plus metadata JSON.
- [ ] Do not move curated Project Memory into SQLite in this migration.
- [ ] Define the V2 treatment for existing surfaces:
  - `projects/<key>/wiki/`
  - `projects/<key>/index.md`
  - `projects/<key>/state/*.json`
  - `projects/<key>/state/latest/`
  - `projects/<key>/inbox/`
  - `projects/<key>/wiki/sessions/`
  - `projects/<key>/changelog.md`
  - `raw/`
  - `artifacts/<key>/runs/`
  - `agents/update/**/instructions.md`
  - `agents/update/**/config.json`
  - `agents/update/**/run.sh`
  - `agents/**/*.py`
  - `scripts/*`
- [ ] For each existing surface, choose preserve, migrate, adapt, retire, or ignore with rationale.
- [ ] Explicitly classify each current `agents/update/**` asset as:
  - move into new layout
  - keep as durable data
  - convert to TypeScript/module config
  - retire after parity
- [ ] Preserve existing project knowledge, raw sources, and provenance through a migration/adaptation path when they still matter.
- [ ] Document why the chosen layout is better than mirroring the old Python/Bash tree.
- [ ] Define how project-local schemas inherit from or specialize the global schema without duplicating global rules.
- [ ] Allow project-local schemas to extend or narrow global schema rules by default.
- [ ] Require a typed override record with an explicit reason to weaken or replace a global schema rule.
- [ ] Queue schema candidates by default when `project learn` discovers project-local conventions.
- [ ] Auto-apply only narrow additive project-local schema conventions with high confidence.
- [ ] Store schema candidates as generated project state JSON, for example `projects/<key>/state/schema-candidates.json`.
- [ ] Store global schema candidates as generated root state JSON, for example `state/schema-candidates.json`.
- [ ] Do not use SQLite for schema candidates in this migration slice.
- [ ] Create or document root `state/` ownership and `.gitignore` policy before writing global generated state.
- [ ] Generate globally unique schema candidate ids.
- [ ] Store `project_key` on every schema candidate.
- [ ] Use schema candidate statuses: `pending`, `applied`, `rejected`, `superseded`, and `failed`.
- [ ] Make `schema candidates <key>` list project-local candidates by default.
- [ ] Add `schema candidates <key> --include-global` for relevant global schema candidates.
- [ ] Require `schema apply <candidate-id> --global` when applying global schema candidates.
- [ ] Do not generate global schema candidates from `project learn`.
- [ ] Reserve global schema candidates for explicit cross-project workflows, operator intent, or later Practice/Personal promotion logic.
- [ ] Defer global schema candidate generation commands until cross-project Practice/Personal promotion exists.
- [ ] Make project-local `schema apply` rebuild that project's schema context.
- [ ] Make global `schema apply --global` rebuild schema context for all registered projects or fail/roll back.
- [ ] Place global authored schema under root `schema/`.
- [ ] Place project-local authored schema under `projects/<key>/schema/`.
- [ ] Migrate or classify existing root `schemas/source-classification.md` as source material for the new root `schema/` authored guidance.
- [ ] Fold the source-classification rules currently repeated in `AGENTS.md` into the global schema model.
- [ ] Ensure `schemas/` and `schema/` do not remain two active authored schema roots.
- [ ] Support markdown guidance files for human/agent-readable schema intent.
- [ ] Support typed JSON rule files for enforceable schema contracts.
- [ ] Do not use YAML for typed schema rules by default.
- [ ] Treat typed schema JSON as hand-authored source files.
- [ ] Do not introduce a higher-level schema-rule generator in this slice.
- [ ] Validate typed schema JSON with Zod validators in TypeScript.
- [ ] Do not make JSON Schema the primary validator in this slice.
- [ ] Include typed rules for page taxonomy, review gates, allowed memory scopes, required provenance fields, CLI vocabulary, and validation requirements.
- [ ] Generate compiled agent-facing schema context under project state, for example `projects/<key>/state/schema-context.json`.
- [ ] Treat compiled schema context as generated state, not hand-edited source.
- [ ] Regenerate schema context when global or project-local schema inputs change.
- [ ] Verify schema-context freshness during `project learn`.
- [ ] Avoid rewriting schema context when inputs are unchanged.
- [ ] Update or document `.gitignore` so new authored schema files, TypeScript source, tests, and docs are not accidentally hidden, while generated state is intentionally tracked or ignored.

### Task 1: Add Root TypeScript Package

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`

- [ ] Add `"private": true`.
- [ ] Add scripts:
  - `typecheck`
  - `test`
  - `cli`
  - `compile`
  - `update`
  - `lint`
  - `measure`
  - `ask`
  - `status`
- [ ] Treat `compile`, `update`, `ask`, and `status` package scripts as compatibility/convenience aliases only; the primary operator vocabulary is the V2 CLI command surface.
- [ ] Do not include `/mcp` as a workspace member.
- [ ] Run:

```bash
bun install
bun run typecheck
```

Expected: PASS.

### Task 2: Port Runtime Primitives

**Files:**

- Create: `src/runtime/fs.ts`
- Create: `src/runtime/json.ts`
- Create: `src/runtime/config.ts`
- Create: `src/runtime/projects.ts`
- Create: `src/runtime/state.ts`
- Create: `src/runtime/artifacts.ts`
- Create: `src/runtime/process.ts`

- [ ] Port root/path helpers, safe path resolution, deterministic JSON IO, config loading, project discovery, state reads/writes, artifact path helpers, and subprocess helpers.
- [ ] Tests cover missing files, safe-path rejection, project discovery, config precedence, deterministic JSON, and artifact path generation.
- [ ] Run:

```bash
bun test
bun run typecheck
```

Expected: PASS.

### Task 3: Implement Schema Runtime And CLI

**Files:**

- Create: `src/schema/*`
- Create: schema command modules under `src/commands/schema*`
- Create tests for schema validation, context build, candidates, and apply.

- [ ] Implement `schema check`.
- [ ] Implement `schema build`.
- [ ] Implement `schema candidates`.
- [ ] Implement `schema apply`.
- [ ] Build and validate `schema-context.json`.
- [ ] Validate hand-authored JSON schema rules with Zod.
- [ ] Support global and project-local schema layers.
- [ ] Enforce project-local extend/narrow/override semantics.
- [ ] Add tests proving future `project learn` behavior can stop when schema validation fails.
- [ ] Keep `schema check <key>` read-only.
- [ ] Do not implement automatic schema fixing inside `schema check`.

Expected: schema context exists before query and learn command implementations.

### Task 4: Port Query Runtime On Schema Context

**Files:**

- Create: `src/query/planner.ts`
- Create: `src/query/engine.ts`
- Create tests using schema-context-aware query behavior.

- [ ] Use schema context for taxonomy, memory scopes, freshness rules, and provenance expectations.
- [ ] Treat current `agents/query/*.py` behavior as reference material only.
- [ ] Preserve detached interface contracts that still matter.
- [ ] Do not recreate V1 routing assumptions when schema context says otherwise.
- [ ] Make `memory query` fail closed when schema context is missing or invalid.
- [ ] Missing/invalid schema responses must suggest `schema build <key>` or `schema check <key>`.
- [ ] Do not fall back to unschematized query behavior.
- [ ] Do not auto-run `schema build` from `memory query`.
- [ ] Keep `memory query` side-effect-light.

Expected: TypeScript query behavior is schema-aware from the start.

### Task 5: Port Inbox And Auto-Update Primitives

**Files:**

- Create: `src/inbox/items.ts`
- Create: `src/inbox/auto-update.ts`
- Port tests from current inbox, gap emission, enrich-gap auto-update, flag-stale-answer, and auto-update wrapper tests where applicable.

- [ ] Preserve inbox item schema and filename conventions.
- [ ] Preserve low-confidence gap-note behavior.
- [ ] Preserve auto-update lockfile semantics and detached update log paths.
- [ ] Do not change `/mcp`; this task ports core primitives and documented contracts only.

### Task 6: Port Validation And Metadata Helpers

**Files:**

- Create: `src/pipeline/validate.ts`
- Create: `src/pipeline/metadata.ts`
- Port behavior from `agents/update/06-validate/structural.py`, semantic context helpers, and brain metadata helpers.

- [ ] Preserve structural rule names and finding shapes.
- [ ] Preserve ingest-mode relaxations.
- [ ] Preserve latest metadata product generation.
- [ ] Port current pytest expectations into Bun tests.

### Task 7: Port Pipeline Stage Runner

**Files:**

- Create: `src/pipeline/stages.ts`
- Create: `src/pipeline/llm-client.ts`
- Create: `src/pipeline/apply.ts`
- Create: `src/pipeline/reconcile.ts`

- [ ] Run existing stage instruction markdown/config JSON as data.
- [ ] Preserve Codex/Claude model selection behavior from `llm_client.py`.
- [ ] Preserve Codex read-only sandbox behavior for JSON-returning LLM stages.
- [ ] Preserve proposal/apply/reconcile artifact shapes.
- [ ] Preserve bounded reconcile behavior.

### Task 8: Design And Port V2 CLI

**Files:**

- Create/extend: `src/cli.ts`
- Create command modules under `src/commands/*`.
- Create or update: `docs/v2-cli.md`

- [ ] Design a V2 CLI vocabulary that names product concepts rather than V1 mechanics.
- [ ] Use the initial command mapping unless Task 0.5 finds a better vocabulary:
  - `compile` -> `project learn <key>`
  - `update` -> `project ingest <key>`
  - `ask` -> `memory query <key> "<question>"`
  - session continuity -> `session close <key>`
  - schema maintenance -> `schema check <key>`, `schema build <key>`, `schema candidates <key>`, `schema apply <candidate-id>`
- [ ] Implement these required first-slice commands:
  - `llm-wiki schema check <key>`
  - `llm-wiki schema build <key>`
  - `llm-wiki schema candidates <key>`
  - `llm-wiki schema apply <candidate-id>`
  - `llm-wiki memory query <key> "<question>"`
  - `llm-wiki project learn <key>`
  - `llm-wiki project ingest <key>`
  - `llm-wiki project onboard <key>` if project init remains available
  - `llm-wiki project status <key>`
- [ ] Keep project initialization in V2 as `llm-wiki project onboard <key>` unless Task 0 proves it should be retired; if retired, record the rationale and replacement path.
- [ ] Add first-slice command acceptance coverage:

| Command | Required acceptance proof |
| --- | --- |
| `llm-wiki schema check <key>` | Passes on valid authored schema; fails read-only with deterministic validation errors on invalid schema. |
| `llm-wiki schema build <key>` | Writes `projects/<key>/state/schema-context.json` by default; `--dry-run` produces preview output without writing. |
| `llm-wiki schema candidates <key>` | Lists project-local candidates from `projects/<key>/state/schema-candidates.json`; `--include-global` includes relevant root candidates. |
| `llm-wiki schema apply <candidate-id>` | Applies a project-local candidate, rebuilds schema context, updates candidate status, and fails or rolls back on validation failure. |
| `llm-wiki schema apply <candidate-id> --global` | Applies only global candidates, rebuilds all registered project schema contexts, and refuses global apply without `--global`. |
| `llm-wiki memory query <key> "<question>"` | Uses schema context when valid; fails closed with `schema build` / `schema check` guidance when schema context is missing or invalid. |
| `llm-wiki project learn <key>` | Rebuilds stale schema context, stops on invalid schema, auto-applies routine updates, and writes `projects/<key>/runs/<run-id>/applied-changeset.json`. |
| `llm-wiki project ingest <key>` | Processes queued source/inbox items and preserves pending, processed, needs-review, and rejected terminal-state behavior. |
| `llm-wiki project onboard <key>` | Creates or migrates a project using V2 layout/config rules while preserving operator-owned project config semantics. |
| `llm-wiki project status <key>` | Returns deterministic project/runtime status and does not depend on model synthesis. |

- [ ] Add direct Bun tests or smoke commands for each acceptance proof above.
- [ ] Treat `session close`, `practice promote`, and `personal promote` as deferred unless this migration explicitly implements their underlying storage/curation behavior.
- [ ] Deferred commands must return explicit degraded or not-implemented responses, not silent weak fallbacks.
- [ ] Implement `project learn` so it may read the live repo directly.
- [ ] Require durable Project Memory writes from `project learn` to include traceable evidence/provenance.
- [ ] Make routine `project learn` writes auto-apply by default.
- [ ] Provide review/dry-run controls for risky or manual workflows.
- [ ] Force review/dry-run for destructive deletes, decision-record supersession, low-confidence synthesis, conflicting sources, broad multi-area rewrites, and explicit `--review` / `--dry-run`.
- [ ] Always leave reviewable artifacts, provenance, and a rollback/review trail for applied learning changes.
- [ ] Write an applied changeset record for every auto-applied `project learn` run before reporting success.
- [ ] Store applied changeset records at `projects/<key>/runs/<run-id>/applied-changeset.json` unless Task 0.5 defines a stronger V2 run layout.
- [ ] Include in each applied changeset record:
  - command, project key, timestamps, and run id
  - schema-context id/hash used for the run
  - changed files and before/after hashes
  - source evidence used for each durable wiki or state change
  - risk classification and why auto-apply was allowed
  - validation results
  - rollback or review instructions
- [ ] If validation fails after an auto-applied write, stop in degraded or needs-review state and leave the changeset record for inspection.
- [ ] Map old commands to new concepts:
  - `init`
  - `compile`
  - `compile-continue`
  - `update`
  - `update-continue`
  - `lint`
  - `measure`
  - `measure-routes`
  - `measure-tokens`
  - `ask`
  - `status`
  - `dashboard`
  - `prune`
  - `obsidian`
  - `apply-pending`
  - `reject-pending`
- [ ] Mark each old command as:
  - replaced by a new V2 command
  - kept as Make alias
  - retired
- [ ] Implement the new V2 commands in TypeScript.
- [ ] Default CLI output should be human-readable.
- [ ] Add `--json` for machine-readable output.
- [ ] Treat detached MCP as the primary agent API; do not optimize core CLI defaults around agent consumption.
- [ ] Include schema command surface implemented in Task 3.
- [ ] Make `schema build <key>` write generated schema context by default.
- [ ] Add `schema build <key> --dry-run` to preview without writing.
- [ ] Make `schema apply <candidate-id>` rebuild generated schema context immediately after applying authored schema changes.
- [ ] Make `schema apply <candidate-id>` fail or roll back when schema rebuild/validation fails.
- [ ] Make `project learn <key>` verify schema-context freshness before learning.
- [ ] Make `project learn <key>` automatically rebuild stale schema context.
- [ ] Make `project learn <key>` stop when schema validation fails.
- [ ] Preserve stdout/stderr behavior only where it still matters to operator workflows or detached interface contracts.
- [ ] Replace generated file layouts when Task 0.5 defines a better V2 layout.

### Task 9: Convert Makefile To Convenience Aliases

**Files:**

- Modify: `Makefile`

- [ ] Make should call V2 CLI commands, not old product concepts by default.
- [ ] Keep old Make target names only where they are useful shortcuts.
- [ ] Retire Make targets that reinforce obsolete V1 concepts.
- [ ] Keep `/mcp` untouched.
- [ ] Keep a temporary explicit legacy escape hatch only if needed, named clearly.

### Task 10: Retire Python/Bash Runtime

**Files:**

- Modify or delete migrated Python/Bash files after parity is verified.
- Modify root tests to Bun equivalents or remove superseded pytest tests.
- Modify `pyproject.toml` only when no root Python runtime remains.

- [ ] Remove or quarantine old Python/Bash entrypoints after TypeScript parity.
- [ ] Keep stage markdown/config data assets.
- [ ] Ensure normal operation does not require `.venv`.
- [ ] Ensure old tests have Bun equivalents before removal.

### Task 11: Documentation And ADRs

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Create/update ADRs

- [ ] Document that core llm-wiki is Bun/TypeScript-first.
- [ ] Document that Python/Bash is retired or legacy-only after this slice.
- [ ] Document the V2 CLI vocabulary and old-command mapping.
- [ ] Document `/mcp` as detached agent interface.
- [ ] Document how to run TypeScript tests, typecheck, and operator commands.

### Task 12: Final Verification

- [ ] Run:

```bash
bun test
bun run typecheck
```

- [ ] Run operator smoke tests against a known project:

```bash
bun run cli -- project status <known-project>
bun run cli -- schema check <known-project>
bun run cli -- schema build <known-project> --dry-run
bun run cli -- schema candidates <known-project>
bun run cli -- memory query <known-project> "what is this project?"
```

- [ ] Run command-specific acceptance tests for every row in the Task 8 command acceptance matrix.
- [ ] Run Make alias smoke tests separately:

```bash
make status PROJECT=<known-project>
make ask PROJECT=<known-project> Q="what is this project?"
make lint PROJECT=<known-project>
```

- [ ] Run compile/update dry or fixture checks for the V2 behavior that still matters.
- [ ] Confirm an auto-applied `project learn` writes `projects/<key>/runs/<run-id>/applied-changeset.json`.
- [ ] Confirm `/mcp` remains ignored and detached.
- [ ] Confirm normal core commands do not require Python or `.venv`.
- [ ] Confirm every milestone gate has recorded proof.
- [ ] Confirm every retired V1 behavior has a recorded rationale.
- [ ] Confirm new authored docs, schema files, TypeScript source, and tests are not hidden by `.gitignore`.
- [ ] Report the next design/plan cycle for SQLite memory, vector search, and hooks.
- [ ] Include this explicit close-out note: "When this TypeScript core migration design/plan is fully implemented, confer back with the operator and start designing and planning the next part: SQLite memory, vector search, Codex hooks, and any remaining deferred MCP facade work."

## Self-Review

- Complete core TypeScript migration is in scope.
- SQLite memory is deferred until after the runtime port.
- `/mcp` remains detached and contract-based.
- Existing behavior is preserved only where it protects useful knowledge, provenance, operator intent, or detached interface contracts.
