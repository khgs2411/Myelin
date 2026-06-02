# Myelin

Myelin is a local-first knowledge compiler for software repositories.

It turns source code, documentation, and session notes into a maintained project wiki with provenance, freshness tracking, validation reports, and query surfaces. The goal is simple: future development sessions should start from durable project memory instead of repeatedly rediscovering the same codebase.

## Why Myelin Exists

AI coding agents and human maintainers both lose time when project context lives only in chat history, scattered notes, or broad source scans. That context gets stale, repeated, and hard to trust.

Myelin treats the source repository as the authority, then compiles a smaller knowledge layer around it:

- concise wiki pages for architecture, systems, modules, integrations, and runbooks
- machine-readable state for routing, provenance, freshness, and validation
- inbox workflows for new findings, gap notes, and corrections
- stable outputs that can be queried by agents or inspected by humans

The result is a repo-aware second brain that stays tied to implementation truth.

## How It Works

Myelin separates project knowledge into four layers:

- `repo/`: the implementation truth
- `raw/`: incoming source material and preserved originals
- `wiki/`: synthesized, human-readable understanding
- `state/`: machine-readable metadata, routing, provenance, and freshness

The compiler reads the repository, ranks important domains, proposes wiki updates, applies changes, validates the result, and advances freshness only after the validation gate passes.

Incremental updates use inbox items. When a query exposes stale or missing knowledge, that gap can be written into the project inbox and drained later through the lighter update pipeline.

## Quick Start

Initialize a project wiki:

```bash
make init PROJECT=my_project NAME="My Project" PATH=/path/to/project
```

Run a full compile:

```bash
make compile PROJECT=my_project AUTO=1
```

Drain queued inbox gaps:

```bash
make update PROJECT=my_project AUTO=1
```

Resume a gated run after approval:

```bash
make compile-continue PROJECT=my_project
make update-continue PROJECT=my_project
```

Re-run validation against the latest run:

```bash
make lint PROJECT=my_project
```

Measure wiki quality against acceptance questions:

```bash
make measure PROJECT=my_project
```

Inspect project status or prune old artifacts:

```bash
make status PROJECT=my_project
make prune PROJECT=my_project
```

## Expected Workflow

1. Register a repository with `make init`.
2. Build the first maintained wiki with `make compile`.
3. Use the generated `projects/<key>/index.md` as the starting point for future sessions.
4. Add gap notes or corrections to `projects/<key>/inbox/`.
5. Run `make update` to fold queued knowledge into canonical pages.
6. Review `projects/<key>/state/latest/` for validation, ranking, and measurement outputs.

## Repository Layout

- `AGENTS.md`: execution contract for agents working in this repository
- `SYSTEM_DESIGN.md`: architecture rationale and product model
- `V1_SPEC.md`: filesystem and pipeline contract
- `agents/update/`: compile and update pipeline stages
- `agents/query/`: query routing and synthesis logic
- `projects/`: one maintained wiki space per registered project
- `raw/`: unclassified intake
- `concepts/`: cross-project knowledge
- `schemas/`: source classification and structured contracts
- `scripts/`: operational runners
- `templates/`: scaffold templates for project pages and state
- `tests/`: pytest suite

## MCP Package Surface

The `mcp/` directory is the separately maintained TypeScript/npm package surface for the MCP server. The published runtime is `topsyde-llm-wiki-mcp` and should run through `bunx`.

Query behavior can still span both layers:

- application query engine: `agents/query/`
- MCP adapter package: `mcp/src/index.ts`

When a change affects MCP responses, review the root application diff and the `mcp/` package diff deliberately.

## Stable Outputs

Each project publishes stable read-side products under:

```text
projects/<key>/state/latest/
```

Timestamped pipeline artifacts live under:

```text
artifacts/<key>/runs/
```

The stable products are intended for day-to-day use. The timestamped artifacts are kept for auditability, debugging, and provenance.

## V2 Layout Migration

Project memory is moving to `projects/<key>/{sources,wiki,schema,state,log,runs}/`. Run the reusable adapter per project:

```bash
bun src/cli.ts project migrate-layout <project-key>
```

The adapter also copies global pipeline instruction assets from `legacy/agents/update/*/{instructions.md,config.json}` into `stages/<stage-id>/`, which is the V2 read path for pipeline stage data.

## Status

Myelin is early-stage infrastructure. It is designed for local-first use, explicit provenance, and operator-controlled updates. The public repository is open source under the Apache License 2.0.

The project favors conservative maintenance over speculative automation: source stays authoritative, durable pages are preferred over chat-only memory, and validation gates freshness advancement.

## Contributing

Contributions are welcome through issues and pull requests. Please read:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md)

The `master` branch is protected. Changes should be proposed through pull requests.
