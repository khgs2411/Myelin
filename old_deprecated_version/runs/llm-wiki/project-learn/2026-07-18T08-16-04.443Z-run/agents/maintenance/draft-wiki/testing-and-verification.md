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

The active agent-authored Project Memory path has mechanical safety and accountability gates rather than a content-quality schema gate. `tests/project/project-memory-agent-maintenance-service.test.ts` verifies that every pending source receives one known disposition, applied documentation outputs are listed in `touched_paths`, and every touched draft-wiki path traces to an applied source. `tests/project/project-memory-candidate-intake-service.test.ts` verifies deterministic, idempotent runtime-inbox normalization and its degraded/blocked outcomes. `tests/ingest/worker.test.ts` verifies that provider-created candidates require evidence-bearing fields and that the ingest prompt routes verified durable repository changes to project candidates.

`tests/project/project-memory-draft-promotion.test.ts` covers durable write safety: staged promotion, apply journals, recovery, drift detection, the required `index.md`, nested markdown paths, and stale canonical markdown removal in create mode. The active state records agent-authored content quality as `not_evaluated`; it must not be presented as a schema-evaluated trusted-quality verdict.

## Typecheck Expectations

Typechecking is a required confidence gate for implementation changes. The project uses TypeScript with `tsc --noEmit`; there is no separate build artifact required for normal validation. Because many contracts are expressed as typed vocabularies and discriminated statuses, `bun run typecheck` catches drift between command code, schema contracts, validators, and tests before runtime.

Important typed contract files include:

- `src/project/project-memory-agent-contracts.ts` for maintenance dispositions, maintenance reports, agent-authored run states, and retrieval readiness statuses.
- `src/ingest/worker-output.schema.json` and `src/ingest/worker.ts` for provider ingest-output and evidence-bearing candidate contracts.
- `src/project/project-memory-retrieval-contracts.ts` for lookup quality and retrieval-readiness vocabulary.

## High-Risk Areas Requiring Evidence

Trust claims should be conservative in these areas:

- Project Memory publication: the active agent-authored path verifies authoring completion, maintenance dispositions, allowed output roots, `index.md`, draft-promotion safety, and retrieval status. It does not evaluate documentation quality through the retired structured content-quality schema; provider-generated prose still needs repository and test evidence before it is treated as current understanding.
- Live provider behavior: default tests use stubs. Real Codex/Claude/file-authoring runs need run artifacts such as `input-packet.json`, curator output, rendered markdown, validation results, and apply journals before claiming success.
- Retrieval quality: Session Memory rows are durable SQLite memory records, while Project Memory retrieval rows are derived pointers back to canonical markdown. Query correctness depends on fresh section hashes and should degrade when the index is stale or markdown sections are missing.
- sqlite-vec and embedding availability: tests cover unavailable and stubbed paths, but live vector retrieval depends on local sqlite-vec loading and embedding credentials/configuration.
- Detached ingest and auto-maintenance: tests cover tombstone-backed leases, retry, locks, cooldowns, and stale worker refresh, but live process behavior still needs logs and job state evidence under project runtime state.
- Roadmap claims: `docs/ROADMAP.md` is current implementation intent and records prior verification counts and dogfood outcomes, but any status copied from it can drift. Verify current code and tests before treating roadmap statements as live truth.

## Practical Verification Pattern

For narrow code changes, run the focused Bun test file for the touched boundary, then `bun run typecheck`. For shared contract changes, also run related command or integration-style tests and the full `bun test`.

For Project Memory changes, do not stop at unit tests. Inspect the run artifacts and verify that accepted output was grounded in repository evidence, passed deterministic validation, rendered into useful markdown, survived the usefulness critique when create-mode applies, and wrote only expected wiki/state files through the apply journal.
