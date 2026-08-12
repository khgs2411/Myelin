# Chunk 01: Launch Context And Invocation Contract

**Plan Set:** ../plan.md
**Approved Source:** ../spec.md
**Status:** Ready for Review
**Depends on:** None
**Enables:** Chunk 02

## Goal

Introduce one executable-boundary contract that separates the authoritative Myelin checkout from the caller's working directory, plus one resolver for absolute Myelin command argv. This chunk establishes and tests the contract without migrating every command or background consumer.

## Source Artifacts And Constraints

- Follow the `LaunchContext` type and precedence in `../spec.md`; do not add another root source or treat cwd as a root fallback.
- Follow ADR 0068 for the checkout-backed launcher and fixed locator contract.
- Preserve `MYELIN_ROOT` only as an internal hook/worker contract. Installed interactive invocation cannot use it to bypass the locator.
- Contributor source invocation remains `bun <myelin-root>/src/cli.ts`; installed invocation uses the absolute recorded launcher.
- This chunk does not write machine installation artifacts.

## Relationships

- Creates the stable context consumed by every command in Chunk 02.
- Creates a compile-safe central registration bridge that Chunk 02 takes over sequentially; existing command-module signatures remain unchanged in this chunk.
- Creates the invocation resolver later consumed by provider hooks and detached workers in Chunk 05.
- Defines locator-reading validation needed by the launcher lifecycle in Chunk 03, but does not own locator writes.

## File Responsibility Map

### Create

- `src/runtime/launch-context.ts` — `LaunchContext`, invocation/root-source vocabulary, locator reader interface, root validation, and deterministic resolution.
- `src/runtime/command-invocation.ts` — absolute argv resolution for installed versus source/test contexts.
- `src/commands/register.ts` — central `registerCommands(cli, context)` bootstrap that receives the resolved context while delegating to current registration functions unchanged.
- `tests/runtime/launch-context.test.ts` — precedence, validation, and caller-cwd contract tests.
- `tests/runtime/command-invocation.test.ts` — installed and source/test argv tests.
- `tests/commands/register.test.ts` — compile-safe central bootstrap and complete-context forwarding test.

### Modify

- `src/cli.ts` — capture caller cwd once, resolve or accept one context at the executable boundary, and call the central registration bridge.

### Test

- `tests/runtime/launch-context.test.ts`
- `tests/runtime/command-invocation.test.ts`
- `tests/runtime/runtime.test.ts`
- `tests/commands/register.test.ts`

## Behavioral And Contract Changes

- Add the exact approved `LaunchContext` fields and closed invocation/root-source unions.
- Resolution order is: complete test dependency; validated internal hook/worker environment; installed machine locator; absolute source entrypoint.
- Validate that roots and paths are absolute, the Myelin root is a directory with the expected checkout markers, and the locator schema is supported.
- Installed contexts validate any propagated internal root against the locator's `myelin_root`.
- Capture `callerCwd` before dispatch and do not change process cwd while resolving the root.
- Return actionable failures naming the invalid source and repair path; never retry resolution from cwd.
- Command argv is `[$absoluteLauncher, ...args]` for installed contexts and `[$absoluteBunExecutable, <root>/src/cli.ts, ...args]` for source/test contexts. The production Bun path derives from the current executable rather than ambient `PATH`; hook/worker contexts inherit the parent executable model explicitly.
- `registerCommands(cli, context)` is the compile-safe `01 → 02` bridge: in this chunk it holds the context at the registration boundary and invokes the existing heterogeneous registration functions without passing unsupported arguments. Chunk 02 changes that module and the command signatures together.

## Implementation Tasks

- [ ] Add failing tests for every resolution source, precedence edge, invalid/missing locator, relative paths, locator/internal-env mismatch, and caller-cwd preservation.
- [ ] Define `LaunchContext` and injectable filesystem/environment/entrypoint dependencies so tests do not touch the real home directory.
- [ ] Implement source-root derivation from the absolute `src/cli.ts` entrypoint path.
- [ ] Implement version-1 locator parsing sufficient for root and launcher resolution, leaving ownership mutation to Chunk 03.
- [ ] Implement installed, hook, worker, source, and test context validation with fail-closed diagnostics.
- [ ] Add the shared command-invocation resolver with an absolute production Bun executable derived from the current process and an injectable executable for deterministic tests.
- [ ] Create `registerCommands(cli, context)` as the typed central bootstrap; keep current module registrations unchanged internally so Chunk 01 compiles independently.
- [ ] Test that the bootstrap requires a complete context, registers the current command set, and does not mutate or reconstruct the context.
- [ ] Wire `src/cli.ts` to create one context and call the central bootstrap without yet rewriting command-local root use.
- [ ] Confirm no new `process.cwd()`-as-root or ambient `PATH` lookup is introduced.

## Verification

- `bun test tests/runtime/launch-context.test.ts tests/runtime/command-invocation.test.ts tests/runtime/runtime.test.ts tests/commands/register.test.ts`
  - Expected: all precedence, rejection, cwd-preservation, and argv cases pass.
- `bun run typecheck`
  - Expected: context and command-registration types compile without casts that weaken the closed unions.
- `rg -n "process\.cwd\(\)|MYELIN_ROOT|src/cli\.ts|registerCommands" src/runtime/launch-context.ts src/runtime/command-invocation.ts src/commands/register.ts src/cli.ts`
  - Expected: cwd is captured only as caller context; root selection and source argv appear only in their owning resolvers; the central bootstrap receives the complete context.
- `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Authoritative Myelin root is resolved once at the executable boundary.
- Caller cwd is preserved independently for later project resolution.
- Installed, source, hook, worker, and test contexts have deterministic roots.
- Background argv has a stable absolute invocation contract.

## Risks, Rollback, And Isolation

- Risk: entrypoint detection can differ under Bun tests. Keep entrypoint input injectable and test the production value separately from fixtures.
- Risk: incomplete context injection could create two roots. Require a complete injected context rather than merging partial overrides.
- Rollback is limited to the two new runtime modules, central registration bootstrap, and `src/cli.ts`; no persistent state changes occur.

## Non-Goals

- Migrating all command handlers.
- Writing the launcher, locator, or journal.
- Changing provider hooks or detached workers.
- Implementing status or Step 11 dogfood.

## Consistency Check

- Matches `LaunchContext`, root precedence, and executable-boundary rules in the approved spec.
- Preserves the roadmap boundary: Chunk 01 defines contracts; Chunk 02 migrates consumers.
- Leaves a compiling, explicitly typed registration bridge rather than relying on extra arguments, partial dependencies, or global mutable state.
- Introduces no competing configuration root, public environment override, or installation mutation.
