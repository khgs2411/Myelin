# Runtime And Project Layout

Myelin's runtime is a Bun/TypeScript core that owns repository discovery, project shells, generated state, run artifacts, provider invocation, and the CLI contracts used by detached agent interfaces.

## Runtime Foundation

The root package is the runtime package. `package.json` declares the project as an ESM Bun package, exposes the `myelin` binary at `src/cli.ts`, and keeps normal verification on `bun test` plus `bun run typecheck`. `README.md` and `AGENTS.md` both describe the root `Makefile` as a thin convenience layer over `bun src/cli.ts`, not as the product runtime.

The live core is under `src/`, with the reusable runtime primitives concentrated in `src/runtime/`. Important files are:

- `src/runtime/fs.ts`: repository-root-safe path resolution, project-key validation, and parent-directory creation.
- `src/runtime/config.ts`: root configuration loading from `myelin.config`, then `.env`, then process environment.
- `src/runtime/projects.ts`: project discovery from `projects/<key>/state/project.json` and repo-path-to-project ownership resolution.
- `src/runtime/state.ts`: constrained helpers for JSON state files under `projects/<key>/state/`.
- `src/runtime/project-shell.ts`: project shell creation and repair.
- `src/runtime/layout.ts`: V2 layout migration from older project and artifact locations.
- `src/runtime/artifacts.ts`: command run directory creation under `projects/<key>/runs/`.
- `src/runtime/project-run-infrastructure.ts`: Project Memory curator run setup, schema-context freshness, and run artifact writing.
- `src/runtime/llm-client.ts`: provider invocation through operator-owned Codex or Claude Code CLIs.

The runtime direction is intentional, not incidental. ADR 0009 chooses Bun/TypeScript for the V2 core instead of new Python infrastructure, ADR 0012 starts shared runtime helpers in root `src/runtime/*` instead of a premature package split, and ADR 0047 frames the current core as a clean rewrite away from V1 assumptions.

## Repository Layout

The root repository layout used by current docs is:

```text
src/       Bun/TypeScript runtime, commands, project, memory, query, schema, capture, and ingest code
schema/    global authored schema inputs
projects/  per-project Project Memory shells
state/     generated repo-root SQLite serving state
docs/      current docs, ADRs, design material, and archive
tests/     Bun tests
vendor/    vendored runtime dependencies such as SQLite for vector extensions
```

`README.md`, `AGENTS.md`, and `docs/IMPLEMENTATION_ALIGNMENT.md` agree that `src/runtime/*` is a stable foundation worth building on. They also mark `state/` as generated serving state, not curated truth. Curated Project Memory belongs in markdown under project shells, while SQLite-backed recall and queue state belong in the generated state layer.

## Project Shell Contract

A project shell lives at `projects/<key>/`. `src/runtime/project-shell.ts` treats these paths as required for a normal shell:

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

`bootstrapProject` in `src/runtime/bootstrap.ts` creates or repairs this shell for an absolute repo path, writes `projects/<key>/state/project.json`, and rejects a repo path that is already registered to a different project key. Tests in `tests/runtime/bootstrap.test.ts` lock in three important behaviors: bootstrap creates an uncurated shell, rerunning bootstrap does not overwrite curated `wiki/index.md`, and older project shells are repaired without deleting preserved source material.

The optional `sources/` and `schema/` directories are not created for a clean new shell. `project-shell.ts` treats them as optional legacy directories: empty legacy directories can be removed, while non-empty preserved material is kept and indexed with an explanatory `index.md`. This keeps the clean shell small while still protecting source evidence.

`src/runtime/layout.ts` handles older V1/V2 transitional shapes. It creates the V2 shell directories, moves a root project `index.md` into `wiki/index.md`, moves root `changelog.md` into `log/changelog.md`, moves legacy `inbox/` under `sources/inbox/`, moves old `artifacts/<key>/runs/*` into `projects/<key>/runs/*`, and rewrites `state/update-state.json` `latest_run_dir` pointers from `artifacts/<key>/runs/...` to `projects/<key>/runs/...`. `tests/runtime/layout.test.ts` verifies those migrations preserve existing memory and artifacts.

## State And Generated Data

There are two state scopes with different meanings.

Project-local JSON state lives under `projects/<key>/state/`. `src/runtime/state.ts` only accepts JSON file names, rejects path separators, and routes writes through `projectPath(root, key, "state", name)`. Examples include:

- `project.json`: project registry entry, including `key`, optional `name`, lifecycle, and `repo_paths`.
- `bootstrap-state.json`: whether the shell is still uncurated and which setup items are missing.
- `schema-context.json`: generated schema context built by `myelin schema build <key>` and freshness-checked before `project learn`.
- Project Memory metadata such as `project-memory.json` and page metadata when curation creates or promotes markdown.

Repo-root `state/memory.db` is different. It is the SQLite serving layer for Session Memory, Experience Log, candidates, embeddings, handoffs, and other generated memory-layer rows keyed by project. `MYELIN.md` and ADR 0066 both treat this SQLite file as generated serving state that must not be confused with curated markdown. Clean project shell reset may delete `projects/<key>/`, but it must preserve `state/memory.db`.

The JSON helpers in `src/runtime/json.ts` write stable, sorted JSON. `tests/runtime/runtime.test.ts` verifies deterministic formatting so generated state remains reviewable.

## Run Artifacts

Command-scoped run artifacts live under:

```text
projects/<key>/runs/<command>/<timestamp-run-id>/
```

`src/runtime/artifacts.ts` creates the run root, a command-specific index, and a timestamped run directory with its own `index.md`. Run IDs are ISO timestamps with colons replaced by hyphens, such as `2026-06-23T10-00-00.000Z-run`. Both run IDs and command names are validated so `../` paths are rejected.

`src/runtime/project-run-infrastructure.ts` specializes this for Project Memory learning. `createProjectCuratorRun` places Project Memory curator artifacts under `projects/<key>/runs/project-learn/<run-id>/`; `writeRunArtifact` writes JSON artifacts; `writeMarkdownArtifact` writes markdown artifacts; and both resolve artifact paths inside the run directory. `tests/runtime/project-run-infrastructure.test.ts` verifies stable artifact JSON, markdown artifact writing, path-escape rejection, schema-context creation, and Codex invocation with `--sandbox read-only` for pipeline curator stages.

The current CLI reference says `myelin project learn <key>` may invoke provider CLIs, runs deterministic runtime-inbox intake before packet construction, writes run artifacts under `projects/<key>/runs/`, and may update Project Memory outputs unless `--dry-run` stops writes. `docs/IMPLEMENTATION_ALIGNMENT.md` notes an implementation gap: current Project Memory curator work is aligned around pre-write validation and artifacts, but the broader markdown apply/product semantics remain in transition.

## Write Boundaries

Myelin's write boundaries are code-enforced in the runtime layer:

- `resolveInside` in `src/runtime/fs.ts` rejects paths that escape the repository root.
- `projectPath` validates project keys before constructing `projects/<key>/...` paths.
- `statePath` in `src/runtime/state.ts` only permits single JSON filenames under project state.
- `artifacts.ts` validates run IDs and command names before creating run directories.
- `project-run-infrastructure.ts` resolves artifacts inside the run directory, and tests reject `../escaped.json` and `../escaped.md`.

Provider-backed stages also have behavioral boundaries. `MYELIN.md` requires Codex-backed stages to run with `--sandbox read-only` and return JSON on stdout rather than writing artifacts directly. Runtime code then owns deterministic artifact writes and validation.

Clean project reset is intentionally scoped. `src/project/project-reset-service.ts` finds the registered project, requires a repo path, deletes only `projects/<key>/`, reruns bootstrap, and checks that an existing root `state/memory.db` still exists afterward. ADR 0066 explains the reason: project shell files such as wiki pages, project-local state, sources, runs, and retrieval state are replaceable during an explicit clean reset, while root SQLite memory continuity is preserved unless the operator asks for a memory wipe.

## Detached MCP Boundary

The MCP interface is not part of the root package graph. ADR 0011 keeps MCP detached as the agent interface, integrated through file layouts, commands, JSON outputs, environment contracts, and explicit project selection. ADR 0048 assigns query behavior to root `src/query/` and says detached MCP should consume `myelin memory query --json` rather than importing or duplicating core query logic.

This means future agents should not add a local MCP checkout to the root package graph, should not import MCP source into `src/`, and should keep product behavior in the core runtime or documented CLI/JSON contracts.

## Practical Read Path

For runtime and layout work, read in this order:

1. `README.md`, `AGENTS.md`, and `MYELIN.md` for the live product and operator contract.
2. `src/runtime/fs.ts`, `src/runtime/project-shell.ts`, `src/runtime/bootstrap.ts`, `src/runtime/layout.ts`, and `src/runtime/artifacts.ts` for layout and write-boundary mechanics.
3. `src/runtime/config.ts`, `src/runtime/projects.ts`, and `src/runtime/state.ts` for config, project registry, and state helpers.
4. `src/runtime/project-run-infrastructure.ts` and `src/project/project-reset-service.ts` for project-learn artifacts and clean reset behavior.
5. `tests/runtime/*.test.ts` and `tests/project/project-reset-service.test.ts` for behavior that should not regress.
6. ADR 0009, 0011, 0012, 0048, and 0066 for the architectural reasons behind the runtime and boundary shape.

## Known Gaps

- `docs/IMPLEMENTATION_ALIGNMENT.md` says Project Memory curator apply semantics are still in transition: run artifacts and validation exist, but the product-level markdown apply flow should not be extended blindly.
- Some metadata still reflects older wiki/compiler assumptions. Treat it as migration material unless current code, docs, or ADRs confirm it as active product semantics.
- MCP consumption through the CLI/JSON contract is an architectural boundary, but detached MCP changes live outside this root snapshot.
