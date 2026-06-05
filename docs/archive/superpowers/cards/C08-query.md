# C08 — Query (deterministic + optional LLM)

- **Wave:** 5 · **Depends on:** C04, C06, C07 · **Parallel with:** C10
- **Implements:** Task 8 of the Phase-0 plan · **ADRs:** 0048, 0052
- **Contract:** see `README.md` (shared)

## Scope
Adapt `mcp/src/query-planner.ts` + `query-engine.ts` into `src/query/` (deterministic routing base). Consume `schema-context.json` for taxonomy/scopes/provenance. Layer the LLM router/synthesizer as **optional** stages via the provider abstraction (C06). `memory query` fails closed when schema context is missing/invalid; suggests `schema build|check`; side-effect-light. Core owns query; the detached MCP later calls `myelin memory query --json` (ADR 0048).

## Files
- Adapt/create: `src/query/{planner,engine}.ts`, `src/commands/memory-query.ts` + tests.

## Acceptance (gate)
- Schema-aware routing + deterministic fail-closed behavior covered by tests.
- `--json` emits the Facade Response Contract.

## Trello
- **Title:** C08 — Query (deterministic + optional LLM)
- **List:** Backlog until C04+C06+C07 Done, then Intake (Wave 5, parallel with C10).
