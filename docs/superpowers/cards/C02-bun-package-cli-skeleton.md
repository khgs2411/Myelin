# C02 — Bun package + `myelin` CLI skeleton

- **Wave:** 1 (serial) · **Depends on:** C01 · **Parallel with:** none
- **Implements:** Task 2 of the Phase-0 plan
- **Contract:** see `README.md` (shared)

## Scope
Stand up the root Bun/TypeScript package and a `myelin` CLI that dispatches V2 verbs (stubs OK). Command registration is modular (each command in its own `src/commands/` module; `src/cli.ts` is a trivial loader).

## Files
- Create: `package.json` (`"private": true`, bin `myelin` → `src/cli.ts`), `tsconfig.json`, `src/cli.ts`.
- CLI verbs (stubs): `status`, `memory query`, `project learn|ingest|onboard`, `session close`, `schema check|build`.
- Do not add `/mcp` as a workspace member.

## Acceptance (gate)
- `bun install && bun run typecheck` PASS.
- `myelin status` prints a real (minimal) response.

## Trello
- **Title:** C02 — Bun package + myelin CLI skeleton
- **List:** Backlog until C01 Done, then Intake.
