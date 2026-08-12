# Chunk 05: Provider Hooks And Detached Invocation

**Plan Set:** ../plan.md
**Approved Source:** ../spec.md
**Status:** Ready for Review
**Depends on:** Chunks 02 and 04
**Enables:** Chunk 08

## Goal

Make every Myelin-owned provider hook and detached worker use the shared absolute command-invocation contract while preserving the registered target repository as cwd and retaining the existing internal environment/capture-suppression contracts. No spawned process may depend on ambient PATH.

## Source Artifacts And Constraints

- Installed contexts invoke the absolute launcher recorded in `install.json`.
- Source/test contexts may explicitly invoke `bun <myelin-root>/src/cli.ts`.
- Provider hooks write the absolute installed launcher into their shim.
- Detached ingest and maintenance work keeps the target repo as cwd where provider-backed inspection requires it.
- `MYELIN_ROOT` is propagated as an internal absolute value and validated through the Chunk 01 context.
- Preserve existing capture-disable and worker-specific environment variables.
- Preserve the exported pure `isProcessAlive(pid: number): boolean` signature in `src/ingest/runtime.ts`; Chunk 06 may consume it while this chunk changes spawn behavior.
- `src/install/codex.ts` ownership logic is fixed by Chunk 04; this chunk changes only generated invocation shape.

## Relationships

- Depends on context/argv contracts from Chunk 01 via Chunk 02 and stable provider ownership from Chunk 04.
- Can run in parallel with Chunk 06 because this chunk owns spawn/hook surfaces and no status files.
- Supplies the background-entrypoint acceptance evidence required by Chunk 08.

## File Responsibility Map

### Create

- `src/commands/maintenance.ts` — internal Session/Project maintenance worker routes through the normal CLI boundary.
- `tests/commands/maintenance.test.ts`

### Modify

- `src/install/codex.ts` — generated shim invokes the absolute launcher and preserves arguments.
- `src/commands/register.ts` — register the internal maintenance worker routes through the central bootstrap established by Chunks 01/02.
- `src/ingest/runtime.ts` — detached ingest argv comes from the shared resolver.
- `src/maintenance/auto-memory-maintenance.ts` — Session maintenance spawn uses shared absolute invocation.
- `src/maintenance/auto-project-memory-maintenance.ts` — Project maintenance spawn uses shared absolute invocation.
- `tests/install/codex.test.ts`
- `tests/commands/ingest.test.ts`
- `tests/ingest/runtime.test.ts`
- `tests/maintenance/auto-memory-maintenance.test.ts`
- `tests/maintenance/auto-project-memory-maintenance.test.ts`

### Delete

- `src/maintenance/worker.ts` — superseded direct-script entrypoint.
- `src/maintenance/project-memory-worker.ts` — superseded direct-script entrypoint.

### Test

- The modified suites above, `tests/commands/maintenance.test.ts`, and Chunk 01 command-invocation tests.

## Behavioral And Contract Changes

- Codex shim argv starts with the absolute recorded launcher, then `capture codex-hook`, and forwards provider arguments exactly.
- Source/test shim fixtures may use explicit Bun source argv only when their context says source/test.
- Detached ingest and both maintenance spawners call the shared invocation resolver; none run `myelin` by name or independently join `src/cli.ts`.
- Spawn cwd remains the registered target repo, not Myelin root.
- Spawn environment carries absolute `MYELIN_ROOT`, the existing capture-disable marker, and current job/run identifiers without exposing this as a public operator override.
- Internal maintenance worker routes receive the resolved worker context and fail closed rather than falling back to cwd; the old direct-script entrypoints no longer exist.

## Implementation Tasks

- [ ] Update Codex shim fixture expectations to assert absolute launcher argv, exact argument forwarding, and no direct source path in installed mode.
- [ ] Add source/test invocation fixtures that assert explicit Bun source argv remains supported.
- [ ] Replace detached ingest argv construction with the shared resolver while preserving job id, target cwd, stdio/log, and environment behavior.
- [ ] Keep `isProcessAlive(pid: number): boolean` behavior and export stable while editing `src/ingest/runtime.ts`, with its existing liveness tests retained.
- [ ] Replace Session and Project maintenance spawn argv construction with the same resolver.
- [ ] Add internal `myelin maintenance worker session <project-key>` and `myelin maintenance worker project <project-key>` routes that consume worker context and invoke the existing services.
- [ ] Register those routes through `src/commands/register.ts` without bypassing the central launch-context bootstrap, then remove the two direct worker scripts.
- [ ] Add negative tests for missing launcher/internal root, relative root, mismatched installed locator, and ambient PATH absence.
- [ ] Assert target cwd independently from Myelin root in every spawn test.
- [ ] Assert capture suppression and existing job/run environment values are unchanged.
- [ ] Review `src/install/codex.ts` diff to ensure no lifecycle ownership behavior from Chunk 04 was redesigned.

## Verification

- `bun test tests/install/codex.test.ts tests/commands/ingest.test.ts tests/commands/maintenance.test.ts tests/ingest/runtime.test.ts tests/maintenance/auto-memory-maintenance.test.ts tests/maintenance/auto-project-memory-maintenance.test.ts tests/runtime/command-invocation.test.ts`
  - Expected: hook and all worker paths use expected absolute argv, target cwd, and internal env.
- `rg -n "\[\"bun\"|src/cli\.ts|src/maintenance/.*worker\.ts|spawn\(" src/install/codex.ts src/ingest/runtime.ts src/maintenance`
  - Expected: production background argv is owned by the shared resolver; removed maintenance scripts are not referenced; explicit source argv is limited to the resolver/source-test path.
- `bun run typecheck`
  - Expected: all spawners use the same invocation/context types.
- `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Interactive CLI, capture hook, ingest worker, Session maintenance worker, and Project maintenance worker select the same Myelin root.
- No Myelin-owned background process relies on ambient PATH.
- Target-repository cwd and internal capture suppression are preserved.
- Provider hook installation remains idempotent and ownership-safe.

## Risks, Rollback, And Isolation

- Risk: changing cwd to Myelin root would break provider-backed target inspection. Tests must use different root and target paths and assert both.
- Risk: recursive capture if suppression env is dropped. Treat current capture-disable assertions as regression requirements.
- This chunk changes generated fixtures and spawn argv only; no real hooks or processes are launched in verification.

## Non-Goals

- Provider ownership/reconciliation changes.
- Status process-liveness or lock inspection.
- New worker types or scheduler behavior.
- Step 11 external-repo dogfood.

## Consistency Check

- Uses the Chunk 01 resolver rather than inventing per-worker executable rules.
- Respects the Chunk 04-to-05 sequential handoff for `src/install/codex.ts`.
- Takes `src/commands/register.ts` only after Chunk 02 and adds maintenance routes without changing the established context-propagation contract.
- Remains file-disjoint from Chunk 06 so approved parallelism is safe.
