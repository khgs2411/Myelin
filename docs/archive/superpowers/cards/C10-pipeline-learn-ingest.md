# C10 — Pipeline (`project learn` / `project ingest`)

- **Wave:** 5 · **Depends on:** C06, C07, C09 · **Parallel with:** C08
- **Implements:** Task 10 of the Phase-0 plan · **ADR:** 0053
- **Contract:** see `README.md` (shared)

## Scope
Lean stage runner that executes existing LLM stage-instruction files as data through the provider abstraction (C06). Phase-0 scope (ADR 0053): `learn` = sense → impact → propose → apply → validate (structural); `ingest` = ingest → apply → validate. Validate failure surfaces and stops (no auto-reconcile). Acceptance/reconcile/self-correct/measure deferred. Internal stage semantics provisional; V1 artifact shapes are NOT acceptance criteria.

## Files
- Create: `src/pipeline/{stages,llm-stage,apply,validate}.ts`, `src/commands/project-learn.ts`, `src/commands/project-ingest.ts`.
- **Reads** stage instructions from `stages/<stage-id>/{instructions.md,config.json}` (migrated there by C05) as data; does not read from `legacy/`.
- `project learn` verifies schema freshness first (C07) and stops on schema-validation failure; auto-applies routine updates with provenance; forces review/dry-run for risky changes.

## Acceptance (gate)
- A dry/fixture `learn` + `ingest` completes on `trygga`.

## Trello
- **Title:** C10 — Pipeline learn/ingest
- **List:** Backlog until C06+C07+C09 Done, then Intake (Wave 5, parallel with C08).
