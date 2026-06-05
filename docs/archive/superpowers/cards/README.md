# Myelin Phase-0 Cards

Source-of-truth for the Phase-0 work items. Each `Cnn-*.md` mirrors a Trello card; **Symphony polls Trello, not these files** — these are our versioned record + the paste source for card descriptions/contracts. Each card implements one task of `docs/superpowers/plans/2026-06-02-v2-phase-0-clean-typescript-core.md`.

## Wave order (Symphony has no DAG — gate by intake-list membership)

Symphony dispatches every card in the **Todo** (intake) list in parallel. To honor dependencies, keep cards in **Planning** and promote to **Todo** wave-by-wave only when prerequisites are Done.

| Wave | Cards | Notes |
|---|---|---|
| 1 | C01 → C02 → C03 | Serial chain; promote one at a time. |
| 2 | **C04** | Gate — validates runtime on real data before breadth. |
| 3 | C05 ‖ C06 | Parallel. |
| 4 | C07 ‖ C09 | Parallel. |
| 5 | C08 ‖ C10 | Parallel. |
| 6 | C11 | Docs + Make + rename. |
| 7 | C12 | Delete `legacy/` + final verify. |

Critical path: C01→C02→C03→C04→C05→C07→C10→C11→C12.

## Parallel-merge convention

Parallel cards run in isolated Symphony workspaces (separate branches). To avoid merge conflicts:
- **Command registration is modular** — each command self-registers from its own module under `src/commands/`; nothing but a trivial loader edits `src/cli.ts`.
- Cards append `package.json` deps independently; a one-line resolve at merge is acceptable.
- If a wave still needs shared-file wiring, add a short serialized "integration" pass after it.

## Shared Symphony contract

Every card uses the same contract (paste as a Trello card comment); only the card title differs:

```
SYMPHONY_CONTRACT_V2
{
  "version": 2,
  "machine_id": "local_macbook",
  "project_id": "myelin",
  "profile": "implement",
  "push_remote": "on_ready",
  "base_branch": "master",
  "plan_artifacts": {
    "spec_path": "docs/superpowers/specs/2026-06-01-v2-project-rooted-agent-memory-design.md",
    "plan_path": "docs/superpowers/plans/2026-06-02-v2-phase-0-clean-typescript-core.md"
  }
}
```

## Symphony board (live operating map)

- **Board:** Symphony (`6a0190d7e33ef2ab6264f922`) — the shared ops board the `myelin` project inherits (`projects/myelin.yaml` has no `tracker`, so it uses the shared board; routing is by the contract `project_id`).
- **Project:** `project_id: myelin`, `machine_id: local_macbook`, `base_branch: master`, `push_remote: on_ready`, `profile: implement`.
- **List roles:** `Planning` = staged/parked (not yet intake) · `Todo` = intake/dispatch · `In Progress` = running · `Ready` = review · `Done` = done · `Blockers` = blocked.
- **Labels:** every card carries `myelin` (lime, project) + `Feature` (work-type).
- **Reviewer:** registered for this repo via `make register-symphony-reviewer`.

## Run

1. Cards C01–C12 are live in **Planning** with the contract comment + labels attached.
2. To start, promote Wave 1 to **Todo** — **C01 only** (Wave 1 is the serial C01→C02→C03 chain; promote one at a time). Symphony claims from `Todo`.
3. After **C04** (the gate) is Done, promote each later wave when its deps are Done: 3 = C05‖C06, 4 = C07‖C09, 5 = C08‖C10, 6 = C11, 7 = C12.
4. Do not move a card to `Todo` until you intend it to dispatch.
