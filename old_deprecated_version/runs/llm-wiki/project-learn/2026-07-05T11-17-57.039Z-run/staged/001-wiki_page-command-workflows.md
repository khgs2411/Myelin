# Command Workflows

CLI commands and operator workflows

## Overview

Operators create or refresh Project Memory with project learn <key>, query memory through memory query <key> <question>, and rebuild retrieval serving rows through memory index project <key>.

The Makefile wraps these V2 commands, but new automation should call bun src/cli.ts or the myelin binary with Myelin vocabulary rather than old compile/update terms.

The CLI layer is the dogfood interface inside this repository; MCP wrapping is intentionally later and should expose stable CLI behavior to agents in other projects.

Provenance:

- Evidence: repo_citation:src/commands/project.ts
- Evidence: repo_citation:src/commands/memory.ts
- Repo: src/commands/project.ts:1 - project learn and reset commands
- Repo: src/commands/memory.ts:1 - memory query and index commands

## Operational Details

project reset <key> --clean --confirm <key> is the explicit clean rebootstrap path that deletes the project shell and preserves root state/memory.db unless a separate memory wipe exists.

memory inbox create and memory inbox intake provide the runtime candidate intake path, turning source items into project candidates for later evidence-backed learning.

top-level ingest <key> drains captured Experience Log rows into Session Memory and candidate outputs, while project ingest is reserved for project-memory source/inbox material.

Provenance:

- Evidence: repo_citation:src/commands/project.ts
- Evidence: repo_citation:src/commands/memory.ts
- Repo: src/commands/project.ts:1 - project learn and reset commands
- Repo: src/commands/memory.ts:1 - memory query and index commands

## Evidence And Boundaries

src/commands/project.ts owns project packet, project learn, project reset, and project-list command behavior.

src/commands/memory.ts owns memory query, inbox create/intake, candidate inspection, and memory indexing command surfaces.

AGENTS.md and docs/CLI.md describe the product vocabulary that command implementations should preserve.

Provenance:

- Evidence: repo_citation:src/commands/project.ts
- Evidence: repo_citation:src/commands/memory.ts
- Repo: src/commands/project.ts:1 - project learn and reset commands
- Repo: src/commands/memory.ts:1 - memory query and index commands

Page provenance:

- Evidence: repo_citation:src/commands/project.ts
- Evidence: repo_citation:src/commands/memory.ts
- Repo: src/commands/project.ts:1 - project learn and reset commands
- Repo: src/commands/memory.ts:1 - memory query and index commands
