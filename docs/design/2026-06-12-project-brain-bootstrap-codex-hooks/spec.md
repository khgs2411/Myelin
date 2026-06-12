# Project Brain Bootstrap And Codex Hook Capture Design

Status: Finalized design. Ready for user review before implementation planning.

## Goal

Design the first V2 brain creation path for Myelin: turn a local software repository into a project-rooted memory shell, then capture live Codex session inputs as raw project evidence without prematurely curating or inventing memory.

The first target project is `class-kit` at `/Users/liadgoren/Repositories/class-kit` because it is actively changing and can prove whether hook capture handles real session input. `wizepal` remains useful later as a static comparison fixture.

## Current Context

The canonical design in `MYELIN.md` defines five memory types:

- Project Memory: curated project truth.
- Session Memory: project-scoped continuity.
- Practice Memory: cross-project operating guidance.
- Personal Memory: durable user/agent working preferences.
- Experience Log: raw captured evidence, not truth.

It also defines four read/storage layers:

- `repo/`: implementation truth.
- `raw/` and `sources/`: preserved source material.
- `wiki/`: synthesized, human-readable Project Memory.
- `state/`: machine-readable metadata, routing, provenance, freshness, and SQLite serving state.

The relevant roadmap items are:

- `.tasks/12-source-intake-and-layout/project-data-layout.md`
- `.tasks/12-source-intake-and-layout/source-classification.md`
- `.tasks/12-source-intake-and-layout/source-preservation.md`
- `.tasks/04-capture-and-candidates/experience-log.md`
- `.tasks/04-capture-and-candidates/event-collector.md`
- `.tasks/04-capture-and-candidates/trigger-modes.md`
- `.tasks/02-session-memory/session-event-contract.md`
- `.tasks/03-project-memory/project-memory-taxonomy.md`

Existing code already provides part of the substrate:

- `src/runtime/layout.ts` defines the V2 project layout.
- `src/runtime/projects.ts` discovers projects from `projects/<key>/state/project.json`.
- `src/commands/project.ts` has `project migrate-layout`; `project onboard` is registered but not implemented.
- `src/memory/migrations.ts` and `src/memory/sessions.ts` provide an early SQLite session substrate.
- `src/commands/session.ts` exposes manual session commands, but the current event kinds are not yet the target hook event contract.

Durable decisions recorded during this design:

- ADR 0054 records that capture uses provider-agnostic adapters.
- ADR 0055 records that capture is installed globally, saved per bootstrapped repo, and fails open.

## V1 Boundary

Question 0 result: the active root V1 Python/Bash codebase is already gone from the current tree.

Evidence:

- No root `agents/`, `scripts/`, `pyproject.toml`, or `legacy/` directory exists now.
- Git history shows `legacy/` was deleted in commit `cc5532e` (`symphony: C12 — Delete legacy + final verify`).
- `SYSTEM_DESIGN.md` and `V1_SPEC.md` were deleted when historical docs moved under `docs/archive/`.
- `mcp/.deprecated/python-mcp/` still contains the old Python MCP reference, isolated under `.deprecated`.
- ADR 0047 says V1 was to be quarantined and rewritten cleanly; ADR 0015 says V2 compatibility is not a default constraint.

Design implication:

- Use `MYELIN.md`, `CONTEXT.md`, ADRs, and selected roadmap tasks as design authority.
- Treat archived docs and old code in git history as historical evidence only.
- Treat current `stages/` instructions as provisional V2 pipeline data that may still carry V1 assumptions; do not let them define the new brain bootstrap or hook capture design.
- Do not reintroduce V1 command vocabulary such as `compile` or `update` except as documented compatibility aliases.
- If the command name `bootstrap` is used, it means V2 project brain bootstrap: create the project memory shell and routing metadata for a local repo. It must not imply the old V1 bootstrap pipeline.

## User-Facing Behavior

The first product behavior should be:

1. The operator runs `myelin install --apply` once as machine-level environment setup.
2. Global provider capture hooks are installed, but events from unregistered repos are not saved.
3. The operator runs `myelin bootstrap <key> --repo <path>` per repo to opt that repo into Myelin capture.
4. Myelin preserves raw/source evidence separately from synthesized memory.
5. Provider hooks capture selected session inputs by project into the Experience Log/raw evidence layer for bootstrapped projects only.
6. Captured inputs do not directly mutate `wiki/` Project Memory.
7. Later curation can promote evidence into Project, Session, Practice, or Personal Memory.

For `class-kit`, the desired early outcome is not a polished wiki. It is a project brain shell plus a trustworthy input stream from the live Codex session.

## Technical Design

The design has two initial input streams:

### Repo Bootstrap Input

A future `myelin bootstrap <key> --repo <path>` command should create the minimum project-owned memory shell for a local repo:

- project registration in `projects/<key>/state/project.json`
- canonical directories: `sources/`, `wiki/`, `schema/`, `state/`, `log/`, and `runs/`
- uncurated `wiki/index.md` placeholder that names the project key/repo path and states that Project Memory has not been curated yet
- initial raw/source preservation area
- initial schema context if required by existing schema commands
- initial state metadata that says what exists, what is missing, and what has not yet been curated

Repo bootstrap should not invent project facts beyond basic identity and repo path unless it preserves evidence for those facts.

Bootstrap should be idempotent. Rerunning the same key and repo path should update missing bootstrap artifacts without clobbering existing project memory shell data. If the repo path is already registered to another project key, bootstrap should fail loudly rather than reassign ownership.

Bootstrap should require an explicit slug-like project key and an absolute canonical repo path. The repo path should be resolved before storing so hook routing can compare `cwd` against stable registered paths.

### Codex Hook Input

Codex hooks should provide the first live session input layer through a provider-specific capture adapter. Codex is the first supported capture provider, not the product's driving abstraction.

Myelin core should talk to a provider-agnostic capture facade:

- install/check provider capture integration
- normalize provider-native events into the Experience Log envelope
- route events to a project
- report provider capture health

Codex-specific hook files, hook installers, and hook payload normalization should live under a Codex provider/adapter boundary. A future Claude Code or Gemini provider should implement the same capture facade using its native session/capture surfaces without changing Myelin's core Experience Log or memory-promotion logic.

Current Codex manual evidence:

- Hooks can run command handlers on lifecycle events.
- Project-local hooks can live in `.codex/hooks.json` or `.codex/config.toml`, but only load when the project `.codex/` layer is trusted.
- Commands run with the session `cwd`.
- Relevant events include `SessionStart`, `UserPromptSubmit`, `Stop`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `PreCompact`, `PostCompact`, `SubagentStart`, and `SubagentStop`.
- Only command handlers run today; `prompt` and `agent` handlers are parsed but skipped.
- Multiple matching command hooks for the same event run concurrently.

Initial hook capture should be conservative:

- capture high-signal lifecycle/session events first
- avoid model calls
- avoid curated memory writes
- write durable raw events with project/session association
- fail open and preserve invalid bootstrapped-project events as raw evidence when possible

The first hook events are:

- `SessionStart` for session association
- `UserPromptSubmit` for user-provided task/context capture, subject to privacy rules
- `Stop` for turn-boundary capture and minimal assistant-answer evidence

The user prompt is often context, not the durable knowledge itself. The assistant's final answer after reading the project can be important raw evidence for later Project, Session, Practice, or Personal Memory promotion. `Stop` capture must therefore remain raw Experience Log evidence, not immediate curation.

Tool-level events such as `PreToolUse` and `PostToolUse` are useful later, but can become high-volume and should not be the first default unless the design explicitly limits them. Myelin should also avoid building on `transcript_path` parsing because Codex documents the transcript format as unstable for hooks.

## Data / State

The first implemented subset is Project Memory shell plus raw Experience Log only. The design should still name all five memory types as target scopes, but Session, Practice, and Personal Memory should not become first-class implemented stores in this slice.

Working decision:

- Experience Log starts SQLite-first as raw serving evidence. Full hook payload text can live in the gitignored repo-root SQLite database, with stable event IDs for later curation.
- Session Memory is derived later from high-signal Experience Log events for one project.
- Project Memory starts as a shell: project registration, layout, index/placeholders, and explicit missing/uncurated state. Curated Project Memory content comes later.
- Practice Memory and Personal Memory are target scopes for later candidates, not first-slice curated stores.
- `state/` stores metadata, routing, freshness, and generated indexes, not curated truth.
- File preservation under `raw/` or `projects/<key>/sources/` is reserved for source-like payloads that later ingestion promotes or preserves deliberately. Hook capture itself does not need file-first auditability.
- Experience Log rows are transient raw inputs. A later ingestion workflow should delete processed raw rows and write tombstone records so raw inputs do not compound forever while traceability remains.

Project routing decision:

- Global provider hooks may fire from any Codex session.
- Myelin stores an event only when the hook `cwd` is inside a registered project `repo_paths` entry in `projects/<key>/state/project.json`.
- Unknown repos do not auto-create projects and do not write Experience Log events.
- Unknown repo events are no-ops: they are dropped without an Experience Log row or hook error entry.
- `myelin bootstrap class-kit --repo /Users/liadgoren/Repositories/class-kit` must run before `class-kit` hook capture is useful.
- Installation is machine-level setup; bootstrap is per-repo opt-in. The preferred order is install first, then bootstrap each repo that should save events.

Minimum Experience Log event envelope:

- `id`
- `project_key`
- `occurred_at`
- `hook_event_name`
- `event_kind`
- `cwd`
- `provider`
- `provider_session_id`
- `turn_id`, when available
- `raw_text`, for prompt/assistant-answer text when relevant
- `raw_payload_json`
- `source`, such as `codex-hook`
- `status`, such as `valid` or `invalid`

This is a structured core plus raw payload. It should be enough for query/curation without requiring future agents to parse every raw hook JSON blob, while preserving fidelity.

The first slice should not include `summary_text`. Summaries are ingestion outputs, not raw capture fields. Once a future ingestion workflow successfully processes an Experience Log row into memory, candidate, or preserved source state, the raw row should be removed and replaced with a tombstone record rather than kept indefinitely.

Processed Experience Log tombstones should preserve enough traceability for debugging, auditability, and duplicate prevention without retaining raw prompt/answer text. The tombstone table should record at least the original event id or dedupe identity, `project_key`, processed timestamp, and references to ingestion outputs.

An Experience Log row is eligible for deletion/tombstoning only after ingestion creates a durable output reference or explicit terminal decision, such as a memory candidate, source preservation record, session summary, curated memory update, or rejected/no-action record. A no-op or failed ingestion attempt must not delete the raw row.

Initial provider-neutral `event_kind` values:

- `session.start`
- `user.prompt`
- `assistant.response`

Provider-native event names stay in `hook_event_name`, and provider-specific fields stay in `raw_payload_json`. Myelin core should not need a field schema per provider for the first Experience Log slice.

Initial Codex adapter mapping:

- `SessionStart` maps to `session.start`.
- `UserPromptSubmit` maps to `user.prompt`.
- `Stop` maps to `assistant.response` only when `last_assistant_message` is non-empty.

Prompt/response pairing should use provider-supplied `turn_id` when available. `turn_id` is nullable because not every provider or event may supply it. Myelin should not invent its own turn ids in the first slice; if `turn_id` is missing, later ingestion can fall back to project/session/time ordering.

Session identity should remain provider-owned in this slice. Experience Log rows should store `provider` and `provider_session_id`; the Codex adapter maps Codex's native `session_id` into `provider_session_id`. `SessionStart` must not create Myelin `sessions` rows yet. Myelin Session Memory can be derived later from Experience Log evidence.

The first provider identifier is `codex`. More specific origin details belong in `source`, such as `codex-hook`.

## Integrations

Codex hook integration should use global `~/.codex/hooks.json` because Myelin is a cross-project memory system intended to work from any repo and any Codex session on this machine. The global hook should route events into the Myelin repo/folder location and then detect the active project from the hook `cwd`.

Myelin should provide a `myelin install` command that installs capture integrations for selected providers. The command should auto-detect supported provider roots such as `~/.codex/` and, once supported, other provider roots such as a Claude Code configuration directory. The first implementation can support only Codex, but the command and internal shape must stay provider-agnostic.

`myelin install` should preview by default and require `--apply` to write. Plain `myelin install` should preview all detected providers without opening a selection prompt. For Codex, it should show whether `~/.codex/` was detected, whether `~/.codex/hooks.json` exists, and the exact create/merge action it would take. With `--apply`, it should create or safely merge the Myelin hook entries without clobbering unrelated user hooks. Because this writes outside the Myelin repo, implementation will require explicit operator approval.

When `--apply` is used and multiple supported providers are detected, the default terminal flow should open an interactive provider-selection prompt. The prompt should allow selecting any subset of detected supported providers and then show a final summary before writing. Explicit flags should support scripted and non-interactive usage: `--provider <name>` bypasses provider selection and installs Myelin only for that provider. The first implementation can support only `codex`, but the CLI contract should already allow future providers without redesigning the command.

If multiple supported providers are detected and the command is non-interactive, `myelin install --apply` must fail before writing unless `--provider <name>` is provided. The failure should print the detected providers and the explicit flag needed to continue.

Myelin should provide a stable user-level shim for hook scripts to call, rather than embedding database writes inside `hooks.json` commands. `myelin install --apply` should write a small shim under Myelin-owned provider state, such as `~/.codex/.myelin/shim/`, and configure `hooks.json` to invoke that shim. The shim routes to the active Myelin checkout and Codex capture adapter. This keeps the hook config stable even if internal repo scripts move.

Install lifecycle should be based on Myelin-owned artifacts:

- `myelin install` previews provider integration changes.
- `myelin install --apply` creates or updates Myelin-owned hook entries and shim artifacts idempotently.
- `myelin uninstall` uses the same discovery/removal logic as update, but stops after removing Myelin-owned entries and artifacts.
- Unrelated user hooks must be preserved.

Ownership and backups:

- Myelin-owned hook entries are identified by command/path markers that route through the Myelin shim.
- Myelin install state lives under `.codex/.myelin/` in the provider config root.
- Backups of modified provider config files live under `.codex/.myelin/backups/` so install does not dirty unrelated machine locations.
- `hooks.json` should be backed up before every write.

## Permissions / Security

Hook capture can see sensitive user prompts and tool context. Default design should be conservative:

- use global hooks only with explicit installation and visible routing behavior
- record high-signal events, not all tool calls
- store full captured prompt and assistant-answer text locally by default for the first slice
- keep the raw capture store local-only and gitignored
- make the local-only/raw-retention behavior explicit in onboarding and status output
- do not run LLMs from hooks
- do not mutate curated memory from hooks

The starting privacy model is local-first rather than redacted-first: Myelin may store raw `UserPromptSubmit.prompt` and `Stop.last_assistant_message` because the data stays on the operator's machine. This is only acceptable if the raw storage path is excluded from git and not promoted into curated memory without an explicit later curation step.

For the first slice, the gitignored repo-root SQLite database is the local raw store. Experience events should live in shared tables partitioned by `project_key`, not in one table per project. The user does not need to manually audit raw hook logs; later ingestion/curation agents inspect the Experience Log through Myelin tools and decide what deserves preservation, promotion, or rejection.

## Error Handling

Hook failures should not corrupt project memory.

Failure policy:

- Myelin hooks must fail open and never interrupt an ongoing Codex agent session.
- Hook write, routing, validation, or DB errors should be recorded for later inspection.
- Hook errors should write to a `hook_errors` table in the root SQLite DB when possible.
- If SQLite write fails or is the source of the failure, the final fallback is a gitignored JSONL file such as `state/hook-errors.jsonl`.
- Missing Myelin inputs are less important than preserving the user's active work with the agent.
- Unbootstrapped repos are not errors. Hooks from repos with no matching Myelin project entry are discarded as no-ops.
- Malformed events from a bootstrapped project should still be saved to the Experience Log when possible. They should keep the raw payload, set `status` to `invalid`, and leave unparseable structured fields empty rather than being dropped or treated as curated errors.
- Invalid event rows require only `project_key`, `occurred_at`, `source`, `status=invalid`, and `raw_payload_json` once project routing has succeeded. Myelin should opportunistically extract `hook_event_name` and `cwd` when present, but must not require them for invalid-event preservation.

Duplicate handling decision:

- Prefer provider-native event identity when available, such as `provider + provider_session_id + turn_id + hook_event_name`.
- Use a conservative fallback content hash only when provider identity is missing.
- If dedupe is uncertain, keep the event rather than risk losing raw evidence.

Remaining implementation details:

- the exact `experience_events` table shape

## Testing Strategy

Future implementation planning should cover:

- unit tests for event envelope validation
- project detection tests for repo root and subdirectory `cwd`
- SQLite/file write tests for raw event persistence
- docs-based JSON fixtures for `SessionStart`, `UserPromptSubmit`, and `Stop`
- real captured, redacted fixtures from `class-kit` after first manual hook verification
- provider capture fixtures stored under `tests/fixtures/capture/codex/`
- manual verification in `class-kit` with installed global Codex hooks
- regression checks that hooks do not write curated `wiki/` memory

## Planning Boundary Guidance

This spec is broad enough to guide several future plans. Implementation should be split smaller:

- V1 boundary cleanup/documentation, if any remaining live V1 references are found.
- Project brain bootstrap shell for `class-kit`.
- Raw event envelope and Experience Log storage.
- Codex hook adapter for `SessionStart`, `UserPromptSubmit`, and `Stop`.
- Project routing and trust/setup verification.
- Later promotion from raw events into Session or Project Memory.

Do not bundle full wiki generation, Current Briefing generation, Practice/Personal promotion, vector indexing, or broad `project learn` redesign into the first implementation plan.

## Acceptance Criteria

The design is ready for implementation planning when:

- the V1 boundary is explicit
- the first implemented memory/storage subset is agreed
- the first hook events are agreed
- the event envelope is specified enough for validation
- the storage destination for hook inputs is decided
- the `class-kit` bootstrap path is decided
- privacy and failure behavior are decided

## Assumptions

- `class-kit` is the first active project brain target.
- `wizepal` remains useful later as a static fixture, but not the first hook-capture target.
- Hooks are available in the user's Codex environment, and global hooks require explicit user-level installation.
- V1 code should not shape new design except as historical warning/evidence.

## Design Agenda

The resolved design agenda and decision trail are in `agenda.md`.
