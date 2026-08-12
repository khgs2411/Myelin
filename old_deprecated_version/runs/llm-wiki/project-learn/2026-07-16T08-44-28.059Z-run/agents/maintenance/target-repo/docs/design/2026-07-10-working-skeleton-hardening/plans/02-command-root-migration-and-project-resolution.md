# Chunk 02: Command Root Migration And Project Resolution

**Plan Set:** ../plan.md
**Approved Source:** ../spec.md
**Status:** Ready for Review
**Depends on:** Chunk 01
**Enables:** Chunks 03, 05, 06, 07, and 08

## Goal

Route every interactive command through the resolved `LaunchContext`, remove command-local Myelin-root inference, and make omitted project-key resolution use only the preserved caller cwd. An unrelated cwd must fail instead of silently selecting the first registered project.

## Source Artifacts And Constraints

- Use the Chunk 01 context as authoritative; command handlers must not reconstruct it.
- Preserve existing command behavior except for the approved root/cwd and ambiguous-project corrections.
- Keep existing narrow dependency injection used by tests.
- `src/commands/install.ts` receives context wiring only in this chunk; parser and lifecycle changes belong sequentially to Chunks 03 and 04.
- `src/status/status-service.ts` loses first-project fallback only; the operational status rewrite belongs to Chunk 06.

## Relationships

- Depends on the executable-boundary contract from Chunk 01.
- Takes sequential ownership of `src/commands/register.ts`; it changes the bridge and command signatures in the same chunk so every intermediate commit can typecheck.
- Hands `src/commands/install.ts` to Chunk 03 after context migration.
- Hands project resolution and `src/status/status-service.ts` to Chunk 06 after removing the unsafe fallback.
- Unblocks all installed-command and external-cwd acceptance work.

## File Responsibility Map

### Create

- None.

### Modify

- `src/runtime/fs.ts` — stop presenting `process.cwd()` as a default authoritative root.
- `src/commands/register.ts` — pass the complete Chunk 01 context into each migrated command registration dependency.
- `src/commands/bootstrap.ts`
- `src/commands/capture.ts`
- `src/commands/ingest.ts`
- `src/commands/install.ts`
- `src/commands/memory.ts`
- `src/commands/project.ts`
- `src/commands/schema.ts`
- `src/commands/session.ts`
- `src/commands/status.ts`
- `src/status/status-service.ts` — remove discovery of the first project as an omitted-key fallback.

### Test

- `tests/commands/bootstrap.test.ts`
- `tests/commands/capture.test.ts`
- `tests/commands/ingest.test.ts`
- `tests/commands/install.test.ts`
- `tests/commands/memory.test.ts`
- `tests/commands/project.test.ts`
- `tests/commands/schema.test.ts`
- `tests/commands/session.test.ts`
- `tests/commands/status.test.ts`
- `tests/commands/register.test.ts`
- `tests/status/status-service.test.ts`
- `tests/runtime/runtime.test.ts`

## Behavioral And Contract Changes

- All checkout-owned paths derive from `context.myelinRoot`.
- The central registration bridge passes context through supported typed dependency objects; no extra ignored arguments, global context, or partial dependency merging is allowed.
- Repo/project inference receives `context.callerCwd`, not Myelin root and not a newly sampled cwd.
- An explicit project key remains authoritative.
- An omitted key succeeds only when caller cwd maps unambiguously to one active registered project.
- Missing or ambiguous identity is an actionable command error; no first discovered project is selected.
- Existing subprocesses retain their current cwd behavior until the dedicated invocation migration in Chunk 05.

## Implementation Tasks

- [ ] Add or update command tests to inject a complete context with distinct Myelin root and caller cwd.
- [ ] Add registered-external-repo, explicit-key-from-unrelated-cwd, unrelated-cwd-without-key, and ambiguous-cwd cases.
- [ ] Change command-registration dependency types to require or receive the shared context.
- [ ] Update `src/commands/register.ts` and the affected registration signatures together, preserving a compiling bridge throughout the migration.
- [ ] Extend `tests/commands/register.test.ts` to prove the exact same context object reaches every migrated command dependency.
- [ ] Replace command-local `repoRoot()`/`process.cwd()` root selection in all nine command modules.
- [ ] Keep caller cwd only where project lookup or explicitly required subprocess context needs it.
- [ ] Remove the first-project fallback from the current status service without implementing the new status schema.
- [ ] Preserve test-specific service overrides and existing public CLI argument behavior.
- [ ] Verify `src/commands/install.ts` contains no lifecycle/parser expansion and is ready for sequential handoff.

## Verification

- `bun test tests/commands tests/status/status-service.test.ts tests/runtime/runtime.test.ts`
  - Expected: all command suites pass with distinct root/cwd fixtures; unrelated cwd without a key fails.
- `rg -n "repoRoot\(\)|process\.cwd\(\)" src/commands src/status/status-service.ts`
  - Expected: no command handler uses either expression to infer Myelin root; any remaining cwd use is justified caller/subprocess behavior.
- `bun run typecheck`
  - Expected: every command registration satisfies the shared context contract.
- `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Commands can distinguish Myelin root from the invoking repository.
- Registered external cwd supports omitted project keys.
- Unrelated cwd never silently selects the first project.
- Every interactive command uses one authoritative root.

## Risks, Rollback, And Isolation

- Risk: broad mechanical edits can alter unrelated command dependencies. Keep changes limited to root/cwd inputs and prove each command with its existing suite.
- Risk: some tests rely implicitly on cwd. Replace that reliance with explicit contexts instead of restoring root guessing.
- Rollback is code-only. No installer or provider state is mutated.

## Non-Goals

- Install parser or lifecycle behavior.
- Provider selection or removal.
- Background invocation migration.
- Operational status schema and rendering.

## Consistency Check

- Preserves the approved distinction between Myelin root and caller cwd.
- Preserves the roadmap's sequential ownership handoff for `src/commands/install.ts`.
- Preserves the explicit `src/commands/register.ts` handoff from Chunk 01 and completes context consumption without reopening root precedence.
- Does not pull Chunk 03 installation work or Chunk 06 status-model work forward.

## Execution Notes

### 2026-07-10: Accepted Local Drift

- **Planned shape:** Remove `src/runtime/fs.ts`'s default `process.cwd()` root during Chunk 02.
- **Current repository evidence:** The only remaining no-argument callers after command/status migration are `src/maintenance/worker.ts` and `src/maintenance/project-memory-worker.ts`, which Chunk 05 removes.
- **Why equivalent:** Every interactive command and status path now uses the shared `LaunchContext`; retaining the default temporarily only keeps the untouched direct maintenance scripts compiling until their owning chunk.
- **Implementation used:** Keep the default in Chunk 02, remove all command/status callers, and let Chunk 05 remove the final callers before deleting the default.
- **Verification:** Command/status/runtime suites passed; `rg` found no `repoRoot()`, `process.cwd()`, or `MYELIN_ROOT` root guessing in `src/commands` or `src/status/status-service.ts`; typecheck passed.
