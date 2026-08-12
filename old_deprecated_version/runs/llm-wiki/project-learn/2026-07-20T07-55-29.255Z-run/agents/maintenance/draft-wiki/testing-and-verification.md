# Testing and Verification

Testing and verification in Myelin combine fast Bun unit tests, TypeScript typechecking, contract tests around durable memory boundaries, and explicit quality gates for Project Memory documentation.

## Standard Verification Commands

The root package is a Bun/TypeScript CLI package. `package.json` defines `bun run typecheck` as `tsc --noEmit` and exposes the CLI through `bun src/cli.ts`. The Makefile keeps the operator-facing verification aliases thin:

- `make test` runs `bun test`.
- `make typecheck` runs `bun run typecheck`.
- `make schema-check PROJECT=<key>` validates generated schema context.
- `make schema-build PROJECT=<key>` rebuilds generated schema context.

Current snapshot verification from this documentation pass:

- `bun test` passed: 451 tests, 0 failures, 1894 expectations, across 87 files.
- `bun run typecheck` passed: `tsc --noEmit`.

These checks prove the checked-in TypeScript contracts compile and the local deterministic test suite passes. They do not, by themselves, prove live provider behavior, embedding service availability, or the usefulness of newly generated Project Memory content.

## Test Suite Organization

Tests live under `tests/` and mirror the runtime boundaries in `src/`.

- `tests/commands/` covers CLI behavior and JSON/human output contracts for `bootstrap`, `capture`, `ingest`, `install`, `memory`, `project`, `schema`, `session`, and `status`.
- `tests/project/` is the densest Project Memory safety area: curator contracts, output schema, evidence-map construction, packet construction, prompt budgeting, markdown rendering/apply, section targeting, source-consumption reconciliation, draft promotion, rendered quality, usefulness critique, reset, and producer boundaries.
- `tests/memory/` covers SQLite schema migrations, Session Memory records, candidates, handoffs, embeddings, vector indexing, query embedding cache, Project Memory retrieval rows, sqlite-vec availability, and retrieval maintenance queues.
- `tests/ingest/` covers Experience Log leasing, tombstone finalization, worker output application, provider failure handling, detached job runtime, and reconciliation context.
- `tests/query/` covers the query facade, Project Memory query hydration from canonical markdown, stale-section degradation, and Session Memory quality fixtures.
- `tests/runtime/`, `tests/capture/`, `tests/inbox/`, `tests/schema/`, `tests/status/`, `tests/session/`, `tests/bootstrap/`, `tests/install/`, and `tests/maintenance/` cover the supporting runtime and operator flows.

Fixture strategy is mostly local and deterministic. Examples include capture payload fixtures under `tests/fixtures/capture/codex/`, query quality fixtures under `tests/query/fixtures/`, stub embedding/provider behavior in memory tests, and file-authoring stubs used by Project Memory learn tests. This keeps the default suite fast and offline.

## Contract Tests That Matter

The highest-risk contracts are tested at the boundary where weak output would otherwise become durable memory.

`src/project/project-memory-curator-validator.ts` is the pre-write gate for curator output. Its tests in `tests/project/project-memory-curator-validator.test.ts` verify that Myelin rejects wrong project keys, unsafe wiki paths, missing evidence, unknown packet references, protected state writes, stale section mutations, overly broad operations, degraded packet writes, missing no-op decisions, and repo-groundable claims without repo citations or explicit inference.

Create-mode Project Memory has extra gates. The validator requires answer domains, line-precise repo citations, evidence-map support, inspected orientation surfaces, a full documentation page set, and rendered section payloads. `tests/project/project-memory-create-contract-regression.test.ts` specifically rejects the old June 30 role-shaped output as shallow, even if it claims trusted quality.

`src/project/project-memory-rendered-quality.ts` evaluates the markdown that would actually be published. Its tests prove that quality is derived from rendered sections, body depth, citation presence, repeated boilerplate detection, and answerability questions such as where `state/memory/memory.db` lives and how Project Memory retrieval rows differ from Session Memory rows.

`src/project/project-memory-usefulness-critique.ts` adds an independent first-create critique contract. It accepts only `pass`, `review_only`, or `fail`, references the evidence-map artifact, and reviews rendered markdown rather than hidden curator reasoning. Tests also ensure `blocked` is not a model critique verdict.

`tests/project/project-memory-markdown-applier.test.ts` covers durable write safety: staged promotion, apply journals, recovery, drift detection, create-mode trusted writes, shallow draft skips, section-scoped patching, and refusal to apply maintenance without trusted Project Memory state.

## Typecheck Expectations

Typechecking is a required confidence gate for implementation changes. The project uses TypeScript with `tsc --noEmit`; there is no separate build artifact required for normal validation. Because many contracts are expressed as typed vocabularies and discriminated statuses, `bun run typecheck` catches drift between command code, schema contracts, validators, and tests before runtime.

Important typed contract files include:

- `src/project/project-memory-quality-contract.ts` for answer domains, content quality statuses, retrieval readiness statuses, and trusted-quality evaluation.
- `src/project/project-memory-curator-contracts.ts` and `src/project/project-memory-curator-output-schema.ts` for curator output vocabulary and structured-output schema.
- `src/project/project-memory-usefulness-critique-schema.ts` for the independent critique schema.
- `src/project/project-memory-retrieval-contracts.ts` for lookup quality and retrieval-readiness vocabulary.

## High-Risk Areas Requiring Evidence

Trust claims should be conservative in these areas:

- Project Memory quality: a passing schema is insufficient. Trust requires rendered markdown depth, repo-grounded citations, answer-domain coverage, answerability, and usefulness critique evidence.
- Live provider behavior: default tests use stubs. Real Codex/Claude/file-authoring runs need run artifacts such as `input-packet.json`, curator output, rendered markdown, validation results, and apply journals before claiming success.
- Retrieval quality: Session Memory rows are durable SQLite memory records, while Project Memory retrieval rows are derived pointers back to canonical markdown. Query correctness depends on fresh section hashes and should degrade when the index is stale or markdown sections are missing.
- sqlite-vec and embedding availability: tests cover unavailable and stubbed paths, but live vector retrieval depends on local sqlite-vec loading and embedding credentials/configuration.
- Detached ingest and auto-maintenance: tests cover tombstone-backed leases, retry, locks, cooldowns, and stale worker refresh, but live process behavior still needs logs and job state evidence under project runtime state.
- Roadmap claims: `docs/ROADMAP.md` is current implementation intent and records prior verification counts and dogfood outcomes, but any status copied from it can drift. Verify current code and tests before treating roadmap statements as live truth.

## Practical Verification Pattern

For narrow code changes, run the focused Bun test file for the touched boundary, then `bun run typecheck`. For shared contract changes, also run related command or integration-style tests and the full `bun test`.

For Project Memory changes, do not stop at unit tests. Inspect the run artifacts and verify that accepted output was grounded in repository evidence, passed deterministic validation, rendered into useful markdown, survived the usefulness critique when create-mode applies, and wrote only expected wiki/state files through the apply journal.
