# llm-wiki

`llm-wiki` is a local-first knowledge layer for codebases.

Scope: software repositories only — services, apps, libraries, games, SDKs, CLI tools, infrastructure. Non-repo use cases (journaling, research over non-code sources, book companions) are explicitly out of scope.

It exists to stop agents from re-learning the same repo context every session. The wiki should become the first place an agent reads, not the repo itself.

## What This Repo Contains

- `AGENTS.md`: canonical agent contract
- `V1_SPEC.md`: v1 filesystem and workflow contract
- `SYSTEM_DESIGN.md`: product and architecture rationale
- `agents/bootstrap/`: bootstrap agents, stage instructions, and shared bootstrap helpers
- `raw/`: unclassified intake
- `projects/`: one wiki space per tracked project
- `concepts/`: cross-project knowledge
- `scripts/`: operational runners

## Core Model

- repo = implementation truth
- wiki = compiled understanding
- state = machine-readable routing, provenance, and freshness
- raw = incoming source material

## Main Commands

Initialize a project shell:

```bash
make init PROJECT=my_project PATH=/path/to/project
```

Bootstrap a real wiki:

```bash
make bootstrap PROJECT=my_project
```

Ingest project-local source material:

```bash
make ingest PROJECT=my_project
```

Apply an approved proposal:

```bash
make ingest-apply PROJECT=my_project RUN=artifacts/runs/<timestamp>-ingest-my_project
```

Trusted fast path (skip manual approval):

```bash
make ingest PROJECT=my_project AUTO=1
```

Ingest unclassified raw inbox items:

```bash
make ingest-global
```

Validate a project wiki:

```bash
make lint PROJECT=my_project
```

## Bootstrap Pipeline

`make bootstrap PROJECT=<key>` runs a staged compiler pipeline:

1. broad orientation
2. knowledge compiler
3. query expander
4. validation
5. reconciliation if validation fails

Bootstrap is not considered successful unless validation passes.

Each stage can also be run directly:

```bash
make bootstrap-orient PROJECT=my_project
make bootstrap-domains PROJECT=my_project
make bootstrap-expand PROJECT=my_project
make bootstrap-validate PROJECT=my_project
make bootstrap-reconcile PROJECT=my_project
```

Later stages reuse the latest recorded bootstrap run, so you can resume from stage 3 or rerun stages 4 and 5 without restarting from stage 1.

## Expected Flow

1. run `make init`
2. run `make bootstrap`
3. review the wiki in your editor or Obsidian
4. drop new specs, plans, or notes into an inbox
5. run `make ingest`

## Editing Surface

The system is filesystem-first. Obsidian is useful as a browsing and evaluation surface, but it is not a hard dependency.

## Doc Roles

- `README.md`: operational entry point
- `AGENTS.md`: execution rules
- `V1_SPEC.md`: hard v1 contracts
- `SYSTEM_DESIGN.md`: why the system exists and how the pieces fit

Bootstrap stage behavior is defined under `agents/bootstrap/`. Each stage owns:

- `instructions.md`
- `agent.json`
- `run.sh`
