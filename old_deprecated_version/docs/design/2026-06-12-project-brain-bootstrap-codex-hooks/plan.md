# Project Brain Bootstrap And Codex Hook Capture Implementation Plan Set

**Spec:** `spec.md`
**Agenda:** `agenda.md`
**Context:** `../../../CONTEXT.md` updated with capture/bootstrap/install glossary
**ADRs:** `../../../docs/adr/0054-use-provider-agnostic-capture-adapters.md`, `../../../docs/adr/0055-use-global-install-with-per-repo-capture-opt-in.md`
**Status:** Chunk Plans Written

## Goal

Implement the first Myelin V2 brain creation and raw capture slice: a top-level `myelin bootstrap <key> --repo <path>` command creates a project memory shell and routing metadata, root SQLite stores provider-neutral raw Experience Log evidence, `myelin install` manages machine-level capture provider integration, and the first Codex adapter captures `SessionStart`, `UserPromptSubmit`, and `Stop` events for bootstrapped repos without mutating curated memory or interrupting active Codex sessions.

## Source Artifacts

- Design spec: `docs/design/2026-06-12-project-brain-bootstrap-codex-hooks/spec.md`
- Design agenda: `docs/design/2026-06-12-project-brain-bootstrap-codex-hooks/agenda.md`
- Context glossary: `CONTEXT.md`
- ADRs:
  - `docs/adr/0054-use-provider-agnostic-capture-adapters.md`
  - `docs/adr/0055-use-global-install-with-per-repo-capture-opt-in.md`
- External audit: sub-agent `019ebb76-cef9-76d0-a09d-30656c51dee9` returned `Ready for Development`, interpreted as ready for `$pmp-writing-plans`.
- Code paths inspected:
  - `package.json`
  - `Makefile`
  - `.gitignore`
  - `src/cli.ts`
  - `src/commands/registry.ts`
  - `src/commands/project.ts`
  - `src/commands/status.ts`
  - `src/runtime/fs.ts`
  - `src/runtime/layout.ts`
  - `src/runtime/projects.ts`
  - `src/runtime/runtime.test.ts`
  - `src/runtime/layout.test.ts`
  - `src/memory/db.ts`
  - `src/memory/db.test.ts`
  - `src/memory/migrations.ts`
  - `src/memory/sessions.ts`
  - `src/memory/sessions.test.ts`
  - `src/schema/compiler.ts`
  - `schema/global.md`
  - `schema/schema-context.md`
- Referenced task stubs verified present:
  - `.tasks/12-source-intake-and-layout/project-data-layout.md`
  - `.tasks/12-source-intake-and-layout/source-classification.md`
  - `.tasks/12-source-intake-and-layout/source-preservation.md`
  - `.tasks/04-capture-and-candidates/experience-log.md`
  - `.tasks/04-capture-and-candidates/event-collector.md`
  - `.tasks/04-capture-and-candidates/trigger-modes.md`
  - `.tasks/02-session-memory/session-event-contract.md`
  - `.tasks/03-project-memory/project-memory-taxonomy.md`
- Test/validation commands discovered:
  - `bun test`
  - `bun run typecheck`
  - `make test`
  - `make typecheck`
  - `bun src/cli.ts --help`
  - `bun src/cli.ts status <project-key>`
  - `bun src/cli.ts schema check <project-key>`
  - `bun src/cli.ts schema build <project-key>`

## Design Readiness Check

- Source artifact paths verified: Pass. Primary spec, agenda, context, ADRs, referenced task stubs, and inspected code paths exist.
- Missing or unavailable artifacts: `tests/fixtures/capture/codex/` does not exist yet. Impact: this is an intended future fixture directory owned by the Codex adapter chunk, not a blocker.
- Open agenda questions or risks: None blocking. All agenda questions are answered and the agenda state is `Complete`.
- Spec / agenda / context / ADR consistency: Pass. ADR 0054 covers provider-agnostic adapters; ADR 0055 covers global install, per-repo opt-in, and fail-open hooks. `CONTEXT.md` defines the relevant product terms.
- Parent / child spec consistency: Not applicable. No child specs or child agendas exist under this design folder.
- Accepted planning reconciliations:
  - `project onboard` still appears in CLI/schema convenience surfaces, while the design chooses top-level `myelin bootstrap`. This is a naming drift, not an unresolved product decision.
  - The Experience Log envelope is specified, but exact SQLite DDL, indexes, dedupe constraints, and tombstone fields are deliberately left to implementation planning.
  - `.gitignore` covers `state/memory.db` and WAL files, but not the JSONL fallback path `state/hook-errors.jsonl`.
- Blockers: None.

## Unresolved Decision Ownership

| Item | Type | Owning Chunk | Must Resolve Before | Notes |
| --- | --- | --- | --- | --- |
| Reconcile stale `project onboard` vocabulary with top-level `myelin bootstrap` | Reconciliation | `01-bootstrap-project-memory-shell.md` | Implementation steps in owning chunk | Includes `src/commands/project.ts`, Makefile/docs/schema surfaces where appropriate. |
| Define concrete `experience_events`, `hook_errors`, and tombstone schema | Deferred implementation decision | `02-experience-log-storage.md` | Implementation steps in owning chunk | Must settle columns, indexes, invalid-row minimums, dedupe behavior, and migration versioning before adapter writes. |
| Ensure fallback hook error log is gitignored | Reconciliation | `02-experience-log-storage.md` | Implementation steps in owning chunk | If JSONL fallback remains `state/hook-errors.jsonl`, add ignore coverage before capture can be enabled. |
| Define exact install preview output, non-interactive exit behavior, and backup manifest shape | Deferred implementation decision | `03-provider-install-lifecycle.md` | Implementation steps in owning chunk | Must preserve no-surprise install and unrelated user hooks. |
| Decide whether scripted `--provider` is repeatable or single-provider per invocation | Deferred implementation decision | `03-provider-install-lifecycle.md` | Implementation steps in owning chunk | Resolved in the chunk as single-provider v0 with a tested non-interactive multi-provider failure path for future supported providers. |
| Ensure hook capture writes to the Myelin checkout even when Codex runs from another repo cwd | Data integrity / integration | `03-provider-install-lifecycle.md`, `05-codex-capture-adapter.md` | Implementation steps in owning chunks | Shim must pass the active Myelin checkout root, and capture command must use it instead of `process.cwd()`. |
| Define fixture filenames and redaction rules | Deferred implementation decision | `05-codex-capture-adapter.md` | Implementation steps in owning chunk | Fixture path is `tests/fixtures/capture/codex/`. |

## Approved Chunks

| Chunk | Purpose | Depends On | Enables | Status |
| --- | --- | --- | --- | --- |
| [`01-bootstrap-project-memory-shell.md`](plans/01-bootstrap-project-memory-shell.md) | Add top-level `myelin bootstrap <key> --repo <path>` to create an idempotent Project Memory Shell and project routing metadata without inventing curated memory. | None | `02-experience-log-storage.md`, `04-capture-routing-and-errors.md`, `06-class-kit-verification.md` | Written |
| [`02-experience-log-storage.md`](plans/02-experience-log-storage.md) | Add root SQLite migrations and helpers for provider-neutral Experience Log rows, hook errors, dedupe, invalid rows, tombstones, and local-only fallback log coverage. | None | `04-capture-routing-and-errors.md`, `05-codex-capture-adapter.md` | Written |
| [`03-provider-install-lifecycle.md`](plans/03-provider-install-lifecycle.md) | Add provider-agnostic `myelin install`, `myelin install --apply`, `myelin uninstall`, provider detection, preview/apply selection behavior, Codex shim ownership, backups, and safe merge/removal logic. | None | `05-codex-capture-adapter.md`, `06-class-kit-verification.md` | Written |
| [`04-capture-routing-and-errors.md`](plans/04-capture-routing-and-errors.md) | Add the provider-neutral capture facade that normalizes provider events, resolves bootstrapped projects by `cwd`, drops unbootstrapped repos, preserves malformed bootstrapped-project events, and fails open with error logging. | `01-bootstrap-project-memory-shell.md`, `02-experience-log-storage.md` | `05-codex-capture-adapter.md`, `06-class-kit-verification.md` | Written |
| [`05-codex-capture-adapter.md`](plans/05-codex-capture-adapter.md) | Implement the Codex adapter for `SessionStart`, `UserPromptSubmit`, and `Stop`, including docs-based fixtures, provider-neutral event mapping, and no transcript parsing. | `02-experience-log-storage.md`, `03-provider-install-lifecycle.md`, `04-capture-routing-and-errors.md` | `06-class-kit-verification.md` | Written |
| [`06-class-kit-verification.md`](plans/06-class-kit-verification.md) | Run the first end-to-end manual verification against `/Users/liadgoren/Repositories/class-kit`: install global Codex hook integration, bootstrap `class-kit`, capture safe test events, verify SQLite rows/errors/no wiki mutation, and either write redacted real fixture files or create an explicit follow-up record with owner and reason. | `01-bootstrap-project-memory-shell.md`, `02-experience-log-storage.md`, `03-provider-install-lifecycle.md`, `04-capture-routing-and-errors.md`, `05-codex-capture-adapter.md` | Later ingestion/session/practice-memory designs | Written |

## Dependency Order

1. `01-bootstrap-project-memory-shell.md`
2. `02-experience-log-storage.md`
3. `03-provider-install-lifecycle.md`
4. `04-capture-routing-and-errors.md`
5. `05-codex-capture-adapter.md`
6. `06-class-kit-verification.md`

Chunks 1, 2, and 3 can be planned and implemented mostly independently after roadmap approval. Chunk 4 depends on the bootstrap project registry and storage contracts. Chunk 5 depends on routing/storage plus install/shim contracts. Chunk 6 is intentionally last because it touches the real global Codex environment and the live `class-kit` repo.

## Shared Contracts

- Command names:
  - `myelin bootstrap <key> --repo <absolute-path>`
  - `myelin install`
  - `myelin install --apply`
  - `myelin install --apply --provider <name>`
  - `myelin uninstall`
- Project registry:
  - `projects/<key>/state/project.json`
  - `key`
  - `repo_paths`
  - optional `name`
- Project layout:
  - `projects/<key>/sources/`
  - `projects/<key>/wiki/`
  - `projects/<key>/schema/`
  - `projects/<key>/state/`
  - `projects/<key>/log/`
  - `projects/<key>/runs/`
- Experience Log envelope:
  - `id`
  - `project_key`
  - `occurred_at`
  - `hook_event_name`
  - `event_kind`
  - `cwd`
  - `provider`
  - `provider_session_id`
  - `turn_id`
  - `raw_text`
  - `raw_payload_json`
  - `source`
  - `status`
- Initial provider-neutral event kinds:
  - `session.start`
  - `user.prompt`
  - `assistant.response`
- Initial provider/source values:
  - `provider=codex`
  - `source=codex-hook`
- Initial Codex mapping:
  - `SessionStart -> session.start`
  - `UserPromptSubmit -> user.prompt`
  - `Stop -> assistant.response` only when `last_assistant_message` is non-empty
- Install ownership:
  - provider root `~/.codex/` for Codex
  - Myelin state under provider root `.myelin/`
  - shim under `~/.codex/.myelin/shim/`
  - backups under `~/.codex/.myelin/backups/`
  - shim exports `MYELIN_ROOT=<active checkout>` before invoking `capture codex-hook`
- Safety invariants:
  - hooks fail open
  - unbootstrapped repos are no-op drops
  - malformed bootstrapped-project events are saved as `status=invalid` when possible
  - hooks do not call models
  - hooks do not mutate curated `wiki/` memory
  - raw prompt/answer data remains local and gitignored

## Spec Coverage Map

| Spec Requirement | Covered By | Notes |
| --- | --- | --- |
| V1 boundary and no V1 vocabulary revival | `01-bootstrap-project-memory-shell.md` | Owns bootstrap vocabulary and stale `project onboard` reconciliation. |
| Project Memory Shell creation | `01-bootstrap-project-memory-shell.md` | Creates project registration, dirs, uncurated `wiki/index.md`, and missing-state metadata. |
| Idempotent bootstrap and repo ownership collision behavior | `01-bootstrap-project-memory-shell.md` | Same key/path rerun is safe; same repo under another key fails loudly. |
| Root SQLite-first Experience Log | `02-experience-log-storage.md` | Defines schema, migrations, helpers, indexes, and local-only storage. |
| Invalid event preservation and hook error fallback | `02-experience-log-storage.md`, `04-capture-routing-and-errors.md` | Storage defines persistence; routing decides when invalid events/error logs are written. |
| Tombstone lifecycle after ingestion | `02-experience-log-storage.md` | Implements table/contract now; ingestion worker behavior remains later work. |
| Provider-agnostic capture facade | `04-capture-routing-and-errors.md` | Core boundary consumed by provider adapters. |
| Global provider install and safe user config mutation | `03-provider-install-lifecycle.md` | Includes preview/apply, multi-provider prompt semantics, backups, ownership markers, shim, uninstall. |
| Codex-specific hook adapter | `05-codex-capture-adapter.md` | Owns Codex payload mapping and fixtures. |
| Project routing from hook `cwd` | `04-capture-routing-and-errors.md` | Uses `projectForRepoPath` and bootstrapped `repo_paths`. |
| First `class-kit` proof | `06-class-kit-verification.md` | Manual verification after all contracts land. |
| Regression that hooks do not mutate curated memory | `05-codex-capture-adapter.md`, `06-class-kit-verification.md` | Adapter tests plus end-to-end verification. |

## Verification Strategy

- Use `bun test` as the primary repo-wide unit/regression command. Expected signal: all Bun tests pass.
- Use `bun run typecheck` as the TypeScript contract check. Expected signal: `tsc --noEmit` completes without errors.
- Use focused Bun tests during implementation:
  - bootstrap/layout/project registry tests near `src/runtime` and `src/commands`
  - memory migration/storage tests near `src/memory`
  - capture facade and Codex adapter tests near the new capture modules
  - CLI install/uninstall tests that use temp provider roots, not the real `~/.codex`
- Use CLI smoke checks before manual verification:
  - `bun src/cli.ts --help` shows `bootstrap`, `install`, and `uninstall`
  - `bun src/cli.ts install` previews without writing
  - `bun src/cli.ts bootstrap class-kit --repo /Users/liadgoren/Repositories/class-kit` creates or updates the project shell
- Manual `class-kit` verification is last because it can touch user-level Codex state. The chunk plan must require explicit user approval immediately before any real `~/.codex` mutation, must use the final install chunk's backup/ownership behavior, and must confirm no curated `wiki/` writes happen from hooks.

## Risks And Sequencing Notes

- Experience Log schema must land before capture adapters write events. Otherwise each adapter will invent its own persistence assumptions.
- Global install/uninstall must be tested against temporary provider roots before any real `~/.codex` write is attempted. Chunk 03 must treat this as an acceptance criterion, not an optional check.
- The existing CLI registry is intentionally small; adding richer install prompts may require a focused parsing/helper module rather than bloating `src/cli.ts` or `src/commands/registry.ts`.
- The design calls the fallback file `state/hook-errors.jsonl`. If implementation chooses a different gitignored fallback path, update the spec/agenda before execution proceeds.
- The first implementation should support only `codex` as a capture provider while keeping the provider-neutral shape explicit.
- `tests/fixtures/capture/codex/` is a future path. Creating it in the Codex adapter chunk is expected.
- Manual `class-kit` fixture capture should avoid writing sensitive raw payloads to tracked files; only redacted fixture files should enter the working tree. If no safe real fixture can be written, chunk 06 must write a follow-up record with the owner, reason, and required next capture conditions.

## Execution Handoff

Recommended next skill after chunk plans are written: `$pmp-executing-plans`.

Execution should load:

- `docs/design/2026-06-12-project-brain-bootstrap-codex-hooks/plan.md`
- the selected chunk plan files under `docs/design/2026-06-12-project-brain-bootstrap-codex-hooks/plans/`
- `docs/design/2026-06-12-project-brain-bootstrap-codex-hooks/spec.md`
- `docs/design/2026-06-12-project-brain-bootstrap-codex-hooks/agenda.md`
- `CONTEXT.md`
- `docs/adr/0054-use-provider-agnostic-capture-adapters.md`
- `docs/adr/0055-use-global-install-with-per-repo-capture-opt-in.md`

Recommended execution modes:

- execute one chunk
- execute selected chunks
- execute all chunks in dependency order

Execution must stop on unclear plan steps, failed verification, code/spec conflict, missing dependencies, real provider config mutation without approval, or user-requested changes.

## User Approval

Roadmap approved by the user before chunk plan files were created. Chunk plans have now been written under `plans/`.
