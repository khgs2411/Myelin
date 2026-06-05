# C06 — Provider abstraction (`src/runtime/llm-client.ts`)

- **Wave:** 3 · **Depends on:** C04 (gate; code dep is C03, but it stays in Backlog until C04 is Done) · **Parallel with:** C05
- **Implements:** Task 6 of `docs/superpowers/plans/2026-06-02-v2-phase-0-clean-typescript-core.md`
- **ADRs:** 0051 (BYO multi-provider runner), 0052 (adapt MCP TypeScript)
- **Contract:** see `README.md` (shared)

## Scope

Reimplement the bring-your-own-subscription runner in TypeScript: Codex (`codex exec --skip-git-repo-check --sandbox read-only -`, prompt on stdin, JSON parse + referenced-file recovery) and Claude Code (`claude -p --output-format json [--model]`, parse `result`/`final_message`). Preserve `DEFAULT_PROVIDER` + `MODEL`/per-call override, per-workload model profiles (pipeline vs query) and Codex reasoning-effort tiers from `myelin.config`. Preserve stub mode (`LLM_STUB_RESPONSES_DIR`). Keep a clean provider seam; no Gemini this slice.

## Files

- Create: `src/runtime/llm-client.ts`
- Tests: `src/runtime/llm-client.test.ts`

## Acceptance (gate)

- Stubbed tests cover codex + claude dispatch, default/override/profile resolution, read-only sandbox flags, and JSON recovery.
- `bun test && bun run typecheck` pass.
- Touches only `src/runtime/llm-client*`; does **not** edit `src/cli.ts` shared registration (avoids parallel-merge conflict with C04/C05). If wiring is needed, expose a module export for a later integration step.

## Trello

- **Title:** C06 — Provider abstraction (llm-client)
- **List:** Backlog until C04 is Done (the gate), then promote to Intake for Wave 3.
- **Description:** the Scope + Acceptance above; note "implements Task 6 — see `plan_path`".
- **Labels:** none (use `Plan Required` only if you want a re-plan; we already have the plan).
